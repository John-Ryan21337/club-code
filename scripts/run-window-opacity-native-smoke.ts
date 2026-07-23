import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import electronPath from "electron";

const OUTPUT_PREFIX = "CAFE_CODE_WINDOW_OPACITY_SMOKE=";
const SMOKE_TIMEOUT_MS = 20_000;
const TERMINATION_TIMEOUT_MS = 5_000;
const MAX_OUTPUT_BYTES = 64 * 1024;
const SUPPORTED_PLATFORMS = new Set<NodeJS.Platform>(["darwin", "win32"]);

interface NativeOpacitySmokeResult {
  readonly ok: boolean;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly electron: string;
  readonly skipped: boolean;
  readonly initial: number;
  readonly changed: number;
  readonly restored: number;
}

function terminateProcessTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) return;
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  child.kill("SIGKILL");
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timeout);
      resolve(true);
    };
    child.once("exit", onExit);
  });
}

function appendBounded(current: string, chunk: Buffer): string {
  const next = current + chunk.toString("utf8");
  if (Buffer.byteLength(next) > MAX_OUTPUT_BYTES) {
    throw new Error("Native window opacity smoke produced excessive output.");
  }
  return next;
}

function parseResult(stdout: string): NativeOpacitySmokeResult {
  const encodedResults = stdout
    .split(/\r?\n/u)
    .filter((line) => line.startsWith(OUTPUT_PREFIX))
    .map((line) => line.slice(OUTPUT_PREFIX.length));
  if (encodedResults.length !== 1) {
    throw new Error(
      `Native window opacity smoke emitted ${encodedResults.length} result records; expected one.`,
    );
  }

  const value = JSON.parse(encodedResults[0]!) as Partial<NativeOpacitySmokeResult>;
  if (
    value.ok !== true ||
    value.skipped !== false ||
    value.platform !== process.platform ||
    value.arch !== process.arch ||
    typeof value.electron !== "string" ||
    value.electron.length === 0 ||
    typeof value.initial !== "number" ||
    !Number.isFinite(value.initial) ||
    typeof value.changed !== "number" ||
    !Number.isFinite(value.changed) ||
    typeof value.restored !== "number" ||
    !Number.isFinite(value.restored)
  ) {
    throw new Error("Native window opacity smoke returned an invalid or unsuccessful result.");
  }
  return value as NativeOpacitySmokeResult;
}

if (!SUPPORTED_PLATFORMS.has(process.platform)) {
  throw new Error(`Native window opacity smoke is unsupported on ${process.platform}.`);
}

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), "window-opacity-native-smoke.cjs");
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
const profileRoot = await mkdtemp(join(tmpdir(), "cafecode-window-opacity-smoke-"));
let child: ChildProcess | undefined;
let childSettled = false;
let failure: unknown;

try {
  child = spawn(
    electronPath as unknown as string,
    ["--disable-gpu", `--user-data-dir=${profileRoot}`, scriptPath],
    {
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );

  let stdout = "";
  let stderr = "";
  let outputError: Error | undefined;
  child.stdout?.on("data", (chunk: Buffer) => {
    try {
      stdout = appendBounded(stdout, chunk);
    } catch (error) {
      outputError = error instanceof Error ? error : new Error(String(error));
      terminateProcessTree(child!);
    }
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    try {
      stderr = appendBounded(stderr, chunk);
    } catch (error) {
      outputError = error instanceof Error ? error : new Error(String(error));
      terminateProcessTree(child!);
    }
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    let timedOut = false;
    let terminationTimeout: NodeJS.Timeout | undefined;
    const timeout = setTimeout(() => {
      timedOut = true;
      terminateProcessTree(child!);
      terminationTimeout = setTimeout(
        () => reject(new Error("Native window opacity smoke did not exit after termination.")),
        TERMINATION_TIMEOUT_MS,
      );
    }, SMOKE_TIMEOUT_MS);
    child!.once("error", (error) => {
      childSettled = true;
      clearTimeout(timeout);
      if (terminationTimeout) clearTimeout(terminationTimeout);
      reject(error);
    });
    child!.once("close", (code) => {
      childSettled = true;
      clearTimeout(timeout);
      if (terminationTimeout) clearTimeout(terminationTimeout);
      if (timedOut) {
        reject(new Error("Native window opacity smoke timed out."));
      } else {
        resolve(code ?? 1);
      }
    });
  });

  if (outputError) throw outputError;
  if (exitCode !== 0) {
    throw new Error(
      `Native window opacity smoke exited with ${exitCode}.${stderr.trim() ? ` ${stderr.trim()}` : ""}`,
    );
  }
  const result = parseResult(stdout);
  console.info(`${OUTPUT_PREFIX}${JSON.stringify(result)}`);
} catch (error) {
  failure = error;
}

if (child && !childSettled) {
  try {
    terminateProcessTree(child);
    if (!(await waitForExit(child, TERMINATION_TIMEOUT_MS))) {
      throw new Error("Native window opacity smoke process did not terminate.");
    }
  } catch (error) {
    failure ??= error;
  }
}
try {
  await rm(profileRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
} catch (error) {
  failure ??= error;
}

if (failure) throw failure;
