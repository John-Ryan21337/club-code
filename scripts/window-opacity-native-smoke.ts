/**
 * Opt-in native whole-window opacity smoke.
 *
 * `yarn test:native-window-opacity` launches the installed Electron runtime
 * with a throwaway user-data profile and two disposable windows of its own. It
 * never touches Cafe Code's real profile, backend, providers or settings.
 *
 * The smoke checks what mocked unit tests cannot: that the operating system
 * compositor actually blends the window. A solid red backdrop window sits
 * behind a solid blue probe window; a real screen capture is sampled inside the
 * probe. An opaque probe reads pure blue, a translucent probe reads the
 * blue/red blend, and the opaque reset must return to pure blue again.
 *
 * This validates the *development* Electron runtime on the host platform only.
 * It is not evidence about a packaged Cafe Code artifact, so it must not by
 * itself add a platform to `VALIDATED_RELEASE_OPACITY_PLATFORMS`.
 */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readJsonFile } from "./json-file.ts";

const SMOKE_TIMEOUT_MS = 90_000;
const MAX_CHANNEL_DELTA = 24;

export interface WindowOpacitySmokeOptions {
  readonly outDir: string;
  readonly opacity: number;
}

export interface SampledColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export function parseWindowOpacitySmokeArgs(
  args: readonly string[],
  defaultOutDir: string,
): WindowOpacitySmokeOptions {
  let outDir = defaultOutDir;
  let opacity = 0.65;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--out") {
      const value = args[index + 1];
      if (!value) throw new Error("--out requires a directory path");
      outDir = value;
      index += 1;
    } else if (argument === "--opacity") {
      const value = Number(args[index + 1]);
      if (!Number.isFinite(value) || value < 0.65 || value > 0.9) {
        throw new Error("--opacity requires a finite value from 0.65 to 0.9");
      }
      opacity = value;
      index += 1;
    } else {
      throw new Error(`Unknown native window opacity smoke argument: ${argument}`);
    }
  }
  return { outDir: resolve(outDir), opacity };
}

/** Blue probe over a red backdrop: the expected composited colour channels. */
export function expectedBlend(opacity: number): SampledColor {
  return { r: Math.round(255 * (1 - opacity)), g: 0, b: Math.round(255 * opacity) };
}

export function channelDistance(sample: SampledColor, expected: SampledColor): number {
  return Math.max(
    Math.abs(sample.r - expected.r),
    Math.abs(sample.g - expected.g),
    Math.abs(sample.b - expected.b),
  );
}

function resolveElectronBinary(): string {
  const requireFromHere = createRequire(import.meta.url);
  const electronModule = requireFromHere("electron") as unknown;
  if (typeof electronModule !== "string") {
    throw new Error("Could not resolve the Electron binary path from the electron package.");
  }
  return electronModule;
}

const MAIN_SCRIPT = String.raw`
const { app, BrowserWindow, desktopCapturer, screen } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const outDir = process.env.CAFE_OPACITY_SMOKE_OUT;
const profileDir = process.env.CAFE_OPACITY_SMOKE_PROFILE;
const targetOpacity = Number(process.env.CAFE_OPACITY_SMOKE_OPACITY);
app.setPath("userData", profileDir);
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");

const steps = [];
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function pageFile(name, color) {
  const file = path.join(profileDir, name);
  const html =
    "<!doctype html><meta charset=utf-8><body style=" +
    JSON.stringify("margin:0;background:" + color) +
    "></body>";
  fs.writeFileSync(file, html);
  return file;
}

/** Average the pixels of a small square at the centre of the probe window. */
function sampleCapture(image, display, probeBounds, label) {
  const captureSize = image.getSize();
  const scale = captureSize.width / display.bounds.width;
  const centreX = Math.round((probeBounds.x + probeBounds.width / 2 - display.bounds.x) * scale);
  const centreY = Math.round((probeBounds.y + probeBounds.height / 2 - display.bounds.y) * scale);
  const half = 6;
  const bitmap = image.toBitmap();
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let y = centreY - half; y <= centreY + half; y += 1) {
    for (let x = centreX - half; x <= centreX + half; x += 1) {
      if (x < 0 || y < 0 || x >= captureSize.width || y >= captureSize.height) continue;
      const offset = (y * captureSize.width + x) * 4;
      b += bitmap[offset];
      g += bitmap[offset + 1];
      r += bitmap[offset + 2];
      count += 1;
    }
  }
  if (count === 0) throw new Error("probe centre fell outside the screen capture");
  const cropped = image.crop({
    x: Math.max(0, centreX - 40),
    y: Math.max(0, centreY - 40),
    width: 80,
    height: 80,
  });
  const cropPath = path.join(outDir, "compositor-" + label + ".png");
  fs.writeFileSync(cropPath, cropped.toPNG());
  const fullPath = path.join(outDir, "screen-" + label + ".png");
  fs.writeFileSync(fullPath, image.toPNG());
  return {
    r: Math.round(r / count),
    g: Math.round(g / count),
    b: Math.round(b / count),
    samplePixels: count,
    cropPath: cropPath,
    screenPath: fullPath,
    captureSize: captureSize,
  };
}

async function captureProbe(display, probeBounds, label) {
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: {
      width: Math.round(display.bounds.width * display.scaleFactor),
      height: Math.round(display.bounds.height * display.scaleFactor),
    },
  });
  const source =
    sources.find((candidate) => String(candidate.display_id) === String(display.id)) || sources[0];
  if (!source || source.thumbnail.isEmpty()) {
    throw new Error("desktopCapturer returned no usable screen thumbnail");
  }
  return sampleCapture(source.thumbnail, display, probeBounds, label);
}

/**
 * Second, independent read of the same pixels through Windows GDI. Chromium's
 * DXGI duplication path can hand back a stale frame on hosts without a live
 * desktop duplication pipeline, and a GDI BitBlt with CAPTUREBLT also includes
 * layered (translucent) windows, which a plain BitBlt drops.
 */
function captureProbeViaGdi(display, probeBounds, label) {
  if (process.platform !== "win32") return null;
  const shotPath = path.join(profileDir, "gdi-" + label + ".png");
  const script = [
    "Add-Type -AssemblyName System.Drawing,System.Windows.Forms",
    "$area = [System.Windows.Forms.SystemInformation]::VirtualScreen",
    "$bmp = New-Object System.Drawing.Bitmap($area.Width, $area.Height)",
    "$g = [System.Drawing.Graphics]::FromImage($bmp)",
    "$g.CopyFromScreen($area.X, $area.Y, 0, 0, $bmp.Size, [System.Drawing.CopyPixelOperation]0x40CC0020)",
    "$bmp.Save(" + JSON.stringify(shotPath).replace(/"/g, "'") + ", [System.Drawing.Imaging.ImageFormat]::Png)",
    "$g.Dispose(); $bmp.Dispose()",
  ].join("; ");
  const result = require("node:child_process").spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { shell: false, timeout: 30000, encoding: "utf8" },
  );
  if (result.status !== 0 || !fs.existsSync(shotPath)) {
    return { error: "gdi capture failed: " + String(result.stderr || result.error || result.status) };
  }
  const image = require("electron").nativeImage.createFromPath(shotPath);
  if (image.isEmpty()) return { error: "gdi capture produced an empty image" };
  return sampleCapture(image, display, probeBounds, "gdi-" + label);
}

async function run() {
  const display = screen.getPrimaryDisplay();
  const area = display.workArea;
  const backdropBounds = { x: area.x + 90, y: area.y + 90, width: 420, height: 320 };
  const probeBounds = { x: area.x + 150, y: area.y + 150, width: 280, height: 180 };
  const windowOptions = {
    frame: false,
    show: false,
    skipTaskbar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  };

  // Liveness precondition: sample the probe area before any window exists, so a
  // capture backend that only ever returns a stale desktop frame is reported as
  // "unobservable host" instead of being mistaken for a broken feature.
  const beforeAnyWindow = {
    desktopCapturer: await captureProbe(display, probeBounds, "baseline"),
    gdi: captureProbeViaGdi(display, probeBounds, "baseline"),
  };

  const backdrop = new BrowserWindow(
    Object.assign({}, backdropBounds, windowOptions, { backgroundColor: "#ff0000" }),
  );
  await backdrop.loadFile(pageFile("backdrop.html", "#ff0000"));
  backdrop.setAlwaysOnTop(true, "floating");
  backdrop.showInactive();
  await sleep(700);
  steps.push({
    step: "capture-liveness-backdrop",
    baseline: beforeAnyWindow,
    sample: await captureProbe(display, probeBounds, "backdrop-only"),
    gdiSample: captureProbeViaGdi(display, probeBounds, "backdrop-only"),
  });

  // A window created with a translucent opacity must never flash opaque, so the
  // constructor value is asserted before the window is ever shown.
  const probe = new BrowserWindow(
    Object.assign({}, probeBounds, windowOptions, {
      opacity: targetOpacity,
      backgroundColor: "#0000ff",
    }),
  );
  await probe.loadFile(pageFile("probe.html", "#0000ff"));
  steps.push({
    step: "startup-before-show",
    requested: targetOpacity,
    getOpacity: probe.getOpacity(),
    visible: probe.isVisible(),
  });
  probe.setAlwaysOnTop(true, "screen-saver");
  probe.showInactive();
  await sleep(900);
  steps.push({
    step: "startup-after-show",
    requested: targetOpacity,
    getOpacity: probe.getOpacity(),
    visible: probe.isVisible(),
  });
  steps.push({
    step: "compositor-translucent",
    requested: targetOpacity,
    getOpacity: probe.getOpacity(),
    sample: await captureProbe(display, probeBounds, "translucent"),
    gdiSample: captureProbeViaGdi(display, probeBounds, "translucent"),
  });

  probe.setOpacity(1);
  await sleep(700);
  steps.push({
    step: "compositor-opaque-reset",
    requested: 1,
    getOpacity: probe.getOpacity(),
    sample: await captureProbe(display, probeBounds, "opaque-reset"),
    gdiSample: captureProbeViaGdi(display, probeBounds, "opaque-reset"),
  });

  probe.setOpacity(targetOpacity);
  await sleep(400);
  steps.push({ step: "reapply-runtime", requested: targetOpacity, getOpacity: probe.getOpacity() });
  probe.setOpacity(1.5);
  steps.push({ step: "clamp-above-one", requested: 1.5, getOpacity: probe.getOpacity() });
  probe.setOpacity(-1);
  steps.push({ step: "clamp-below-zero", requested: -1, getOpacity: probe.getOpacity() });
  probe.setOpacity(1);
  steps.push({ step: "final-opaque", requested: 1, getOpacity: probe.getOpacity() });

  probe.destroy();
  backdrop.destroy();
  return {
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    isPackaged: app.isPackaged,
    capturedAt: new Date().toISOString(),
    display: { id: display.id, bounds: display.bounds, scaleFactor: display.scaleFactor },
    probeBounds: probeBounds,
    steps: steps,
  };
}

app.whenReady().then(async () => {
  let payload;
  try {
    payload = Object.assign({ ok: true }, await run());
  } catch (error) {
    payload = { ok: false, error: String((error && error.stack) || error), steps: steps };
  }
  fs.writeFileSync(path.join(outDir, "native-smoke.json"), JSON.stringify(payload, null, 2));
  app.exit(payload.ok ? 0 : 1);
});
`;

interface SmokeStep {
  readonly step: string;
  readonly requested?: number;
  readonly getOpacity?: number;
  readonly sample?: SampledColor;
  readonly gdiSample?: SampledColor | { readonly error: string } | null;
  readonly baseline?: {
    readonly desktopCapturer?: SampledColor;
    readonly gdi?: SampledColor | { readonly error: string } | null;
  };
}

function usableSample(
  value: SmokeStep["gdiSample"] | SampledColor | undefined,
): SampledColor | null {
  if (!value || typeof value !== "object" || "error" in value) return null;
  return value;
}

/**
 * A screen-capture backend that hands back the same frame for the translucent
 * and the opaque probe is not observing the live desktop, so its pixels prove
 * nothing. Only a backend whose two frames actually differ is used as evidence.
 */
export function selectLiveCaptureSource(
  translucent: SmokeStep | undefined,
  opaque: SmokeStep | undefined,
): {
  readonly source: "desktopCapturer" | "gdi";
  readonly translucent: SampledColor;
  readonly opaque: SampledColor;
} | null {
  const candidates = [
    ["desktopCapturer", usableSample(translucent?.sample), usableSample(opaque?.sample)],
    ["gdi", usableSample(translucent?.gdiSample), usableSample(opaque?.gdiSample)],
  ] as const;
  for (const [source, first, second] of candidates) {
    if (first && second && channelDistance(first, second) > 8) {
      return { source, translucent: first, opaque: second };
    }
  }
  return null;
}

/**
 * True when an opaque window that Electron reports as visible still does not
 * show up in any capture backend: the host session has no observable desktop
 * (headless, disconnected or locked), so no compositor claim can be made.
 */
export function isHostUnobservable(steps: readonly SmokeStep[]): boolean {
  const liveness = steps.find((step) => step.step === "capture-liveness-backdrop");
  if (!liveness?.baseline) return false;
  const pairs = [
    [usableSample(liveness.baseline.desktopCapturer), usableSample(liveness.sample)],
    [usableSample(liveness.baseline.gdi), usableSample(liveness.gdiSample)],
  ] as const;
  return pairs.every(([before, after]) => !before || !after || channelDistance(before, after) <= 8);
}

export function evaluateSmokeSteps(
  steps: readonly SmokeStep[],
  opacity: number,
): readonly string[] {
  const failures: string[] = [];
  for (const step of steps) {
    if (step.requested !== undefined && step.getOpacity !== undefined) {
      const expected = Math.min(1, Math.max(0, step.requested));
      if (Math.abs(step.getOpacity - expected) > 0.005) {
        failures.push(`${step.step}: getOpacity ${step.getOpacity} is not ${expected}`);
      }
    }
  }
  const byName = new Map(steps.map((step) => [step.step, step]));
  const live = selectLiveCaptureSource(
    byName.get("compositor-translucent"),
    byName.get("compositor-opaque-reset"),
  );
  if (!live) {
    failures.push(
      "compositor: no screen-capture backend returned two distinct frames, so this host produced no compositor evidence",
    );
    return failures;
  }
  for (const [label, sample, expectedOpacity] of [
    ["compositor-translucent", live.translucent, opacity],
    ["compositor-opaque-reset", live.opaque, 1],
  ] as const) {
    const distance = channelDistance(sample, expectedBlend(expectedOpacity));
    if (distance > MAX_CHANNEL_DELTA) {
      failures.push(
        `${label} (${live.source}): composited rgb(${sample.r}, ${sample.g}, ${sample.b}) is ${distance} off the expected blend`,
      );
    }
  }
  return failures;
}

async function main(): Promise<void> {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const defaultOut = join(tmpdir(), "cafe-window-opacity-native-smoke");
  const parsedOptions = parseWindowOpacitySmokeArgs(process.argv.slice(2), defaultOut);
  await mkdir(parsedOptions.outDir, { recursive: true });
  const options = {
    ...parsedOptions,
    outDir: await mkdtemp(join(parsedOptions.outDir, "run-")),
  };
  const profileDir = await mkdtemp(join(tmpdir(), "cafe-opacity-profile-"));
  const mainPath = join(profileDir, "opacity-smoke-main.cjs");
  await writeFile(mainPath, MAIN_SCRIPT, "utf8");

  // The parent may run under `ELECTRON_RUN_AS_NODE`; the child must be a real
  // Electron GUI process or there is no window and no compositor to observe.
  const childEnv = { ...process.env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  childEnv.CAFE_OPACITY_SMOKE_OUT = options.outDir;
  childEnv.CAFE_OPACITY_SMOKE_PROFILE = profileDir;
  childEnv.CAFE_OPACITY_SMOKE_OPACITY = String(options.opacity);

  const child = spawn(resolveElectronBinary(), [mainPath], {
    cwd: resolve(scriptDir, ".."),
    env: childEnv,
    windowsHide: true,
    stdio: ["ignore", "inherit", "inherit"],
  });
  let exitCode: number | null = null;
  try {
    exitCode = await new Promise<number | null>((resolveExit, rejectExit) => {
      const timer = setTimeout(() => {
        child.kill();
        rejectExit(new Error(`Native window opacity smoke timed out after ${SMOKE_TIMEOUT_MS}ms`));
      }, SMOKE_TIMEOUT_MS);
      child.once("error", rejectExit);
      child.once("exit", (code) => {
        clearTimeout(timer);
        resolveExit(code);
      });
    });
  } finally {
    await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
  }

  const resultPath = join(options.outDir, "native-smoke.json");
  const result = (await readJsonFile(resultPath)) as {
    readonly ok?: boolean;
    readonly steps?: readonly SmokeStep[];
  };
  const steps = result.steps ?? [];
  const unobservable = isHostUnobservable(steps);
  const failures = [
    ...validateRequiredSmokeSteps(steps, options.opacity),
    ...evaluateSmokeSteps(steps, options.opacity),
  ].filter((failure) => !(unobservable && failure.startsWith("compositor")));
  if (exitCode !== 0 || result.ok !== true) {
    failures.unshift(`Electron smoke exited with ${String(exitCode)}`);
  }
  for (const step of result.steps ?? []) {
    const gdi = usableSample(step.gdiSample);
    if (step.sample || gdi) {
      console.log(
        `${step.step}: getOpacity=${String(step.getOpacity)} desktopCapturer=${
          step.sample ? `rgb(${step.sample.r}, ${step.sample.g}, ${step.sample.b})` : "none"
        } gdi=${gdi ? `rgb(${gdi.r}, ${gdi.g}, ${gdi.b})` : JSON.stringify(step.gdiSample)}`,
      );
    } else if (step.getOpacity !== undefined) {
      console.log(
        `${step.step}: requested=${String(step.requested)} getOpacity=${String(step.getOpacity)}`,
      );
    }
  }
  if (failures.length > 0) {
    console.error(`Native window opacity smoke FAILED:\n- ${failures.join("\n- ")}`);
    process.exitCode = 1;
    return;
  }
  if (unobservable) {
    console.error(
      "Native window opacity smoke INCONCLUSIVE: the native opacity API checks passed, but an " +
        "opaque control window that Electron reported as visible did not appear in any screen " +
        "capture, so this host session has no observable desktop and the compositor was not " +
        `verified. Evidence: ${options.outDir}`,
    );
    process.exitCode = 2;
    return;
  }
  console.log(`Native window opacity smoke PASSED. Evidence: ${options.outDir}`);
}

export function validateRequiredSmokeSteps(steps: readonly SmokeStep[], opacity: number): string[] {
  const expected = {
    "startup-before-show": opacity,
    "startup-after-show": opacity,
    "compositor-translucent": opacity,
    "compositor-opaque-reset": 1,
    "reapply-runtime": opacity,
    "clamp-above-one": 1.5,
    "clamp-below-zero": -1,
    "final-opaque": 1,
  };
  return Object.entries(expected).flatMap(([name, requested]) => {
    const matches = steps.filter((step) => step.step === name);
    return matches.length === 1 &&
      matches[0]?.requested === requested &&
      Number.isFinite(matches[0]?.getOpacity)
      ? []
      : [`${name}: missing, duplicate, or invalid native observation`];
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
