// Explicit opt-in only: a real WebGL engine with a synthetic oscillator behind
// a zero-gain output. No microphones, files, accounts or capture devices.
import assert from "node:assert/strict";
import { mkdir, copyFile, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(process.argv[2] ?? resolve(webRoot, "../../docs/pr-assets/milkdrop-engine"));
await mkdir(output, { recursive: true });
const server = await createServer({
  root: webRoot,
  configFile: false,
  server: { host: "127.0.0.1", port: 0, strictPort: false },
  plugins: [
    {
      name: "owned-milkdrop-probe",
      configureServer(instance) {
        instance.middlewares.use((request, response, next) => {
          if (request.url !== "/") return next();
          response.setHeader("Content-Type", "text/html; charset=utf-8");
          response.end(
            '<!doctype html><title>MilkDrop engine verification</title><style>body{background:#161821;color:#eee;font:18px system-ui;padding:30px}canvas{width:640px;height:360px;border:1px solid #888}p{max-width:650px}</style><h1>Bundled MilkDrop engine</h1><p>Verification fixture · synthetic oscillator · silent output</p><canvas width="640" height="360"></canvas><p id="status">Engine inactive. No product controls are enabled by this prerequisite.</p>',
          );
        });
      },
    },
  ],
});
let browser;
const watchdog = setTimeout(() => {
  console.error("MilkDrop smoke deadline exceeded.");
  process.exit(1);
}, 90_000);
try {
  await server.listen();
  const address = server.httpServer.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
  const context = await browser.newContext({
    viewport: { width: 800, height: 680 },
    recordVideo: { dir: output, size: { width: 800, height: 680 } },
  });
  const requests = [];
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin || url.protocol === "data:") return route.continue();
    requests.push(url.origin);
    return route.abort();
  });
  const page = await context.newPage();
  await page.goto(origin);
  await page.screenshot({ path: resolve(output, "before.png") });
  const result = await page.evaluate(async () => {
    const engine = await import("/src/milkdropVisualizer.ts");
    const canvas = document.querySelector("canvas");
    const audioContext = new AudioContext();
    const source = audioContext.createOscillator();
    const parallelAnalyser = audioContext.createAnalyser();
    const silentGain = audioContext.createGain();
    silentGain.gain.value = 0;
    source.connect(parallelAnalyser).connect(silentGain).connect(audioContext.destination);
    source.start();
    await audioContext.resume();
    let frames = 0;
    let litPixels = 0;
    const errors = [];
    const activation = await engine.activateMilkdropVisualizer({
      audioContext,
      audioSource: source,
      canvas,
      onError: (error) => errors.push(error.code),
      onRenderFrame: () => {
        frames += 1;
        const gl = canvas.getContext("webgl2");
        const pixels = new Uint8Array(4 * 64 * 64);
        gl.readPixels(0, 0, 64, 64, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        litPixels = Math.max(
          litPixels,
          pixels.filter((value, index) => index % 4 !== 3 && value > 0).length,
        );
      },
    });
    if (!activation.ok) {
      source.stop();
      await audioContext.close();
      return { error: activation.error.code };
    }
    const controller = activation.controller;
    const initial = controller.currentPresetName;
    const next = controller.next(0);
    document.querySelector("#status").textContent =
      `Rendering bundled preset: ${next}. Synthetic signal; output gain is zero.`;
    // This callback is serialized into Chromium; it cannot close over a Node helper.
    // eslint-disable-next-line unicorn/consistent-function-scoping
    const wait = (milliseconds) =>
      new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
    await wait(1500);
    controller.stop();
    const stoppedFrames = frames;
    await wait(100);
    const stableWhileStopped = frames === stoppedFrames;
    const waveform = new Uint8Array(parallelAnalyser.fftSize);
    parallelAnalyser.getByteTimeDomainData(waveform);
    const callerGraphAlive = waveform.some((value) => value !== 128);
    const restarted = controller.start();
    await wait(500);
    window.finishMilkdropProbe = async () => {
      controller.destroy();
      controller.destroy();
      document.querySelector("#status").textContent =
        "Engine stopped and WebGL released. The fixture now closes its own synthetic audio context.";
      const last = frames;
      await wait(100);
      source.stop();
      source.disconnect();
      await audioContext.close();
      return {
        stopped: !controller.running,
        noLateFrames: frames === last,
        closed: audioContext.state === "closed",
      };
    };
    return {
      catalog: controller.presetNames.length,
      initial,
      next,
      frames,
      litPixels,
      stableWhileStopped,
      callerGraphAlive,
      restarted,
      errors,
      width: canvas.width,
      height: canvas.height,
    };
  });
  assert.equal(result.error, undefined);
  assert.ok(result.catalog > 100);
  assert.notEqual(result.initial, result.next);
  assert.ok(result.frames >= 2 && result.litPixels > 0);
  assert.ok(result.stableWhileStopped && result.callerGraphAlive && result.restarted);
  assert.deepEqual(result.errors, []);
  assert.ok(result.width * result.height <= 4_194_304);
  await page.screenshot({ path: resolve(output, "after.png") });
  const cleanup = await page.evaluate(() => window.finishMilkdropProbe());
  assert.deepEqual(cleanup, { stopped: true, noLateFrames: true, closed: true });
  assert.deepEqual(requests, []);
  const video = page.video();
  await context.close();
  const raw = await video.path();
  const final = resolve(output, "interaction.webm");
  await copyFile(raw, final);
  // Only remove the exact recording just created in this owned output folder.
  assert.equal(dirname(resolve(raw)), output);
  if (resolve(raw) !== final) await unlink(raw);
  console.log(JSON.stringify({ ...result, cleanup, externalRequests: requests.length, output }));
} finally {
  clearTimeout(watchdog);
  await browser?.close();
  await server.close();
}
