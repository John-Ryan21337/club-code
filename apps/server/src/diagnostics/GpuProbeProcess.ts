// @effect-diagnostics nodeBuiltinImport:off globalTimers:off

import { spawn, type ChildProcess } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { win32 as pathWin32 } from "node:path";

import type { ServerSystemGpuTelemetry } from "@cafecode/contracts";

import {
  parseGpuProbeOutput,
  probeFailedGpuTelemetry,
  unsupportedGpuTelemetry,
} from "./GpuTelemetry.ts";

const MAX_PROBE_OUTPUT_BYTES = 16_384;
const PROBE_TIMEOUT_MS = 2_000;
/** Extra time after the kill request before the caller is settled regardless. */
const PROBE_FORCE_SETTLE_GRACE_MS = 500;
const SHUTDOWN_CLOSE_GRACE_MS = 1_000;
/** One helper at a time, host-wide. See `read` for why this is a hard cap. */
const MAX_LIVE_HELPERS = 1;

// Fixed argv only: no caller input, workspace path, or configuration value
// ever reaches this command line.
const NVIDIA_SMI_ARGS = [
  "--query-gpu=name,index,utilization.gpu,memory.total,memory.used",
  "--format=csv,noheader,nounits",
] as const;

const NVIDIA_SMI_WINDOWS_SUBPATH = ["System32", "nvidia-smi.exe"] as const;
const WINDOWS_DEFAULT_SYSTEM_DRIVE = "C";
/**
 * Distro-package-owned locations only. `/usr/local/bin`, `~/.local/bin`,
 * workspace `node_modules/.bin`, and anything reachable through `PATH` are
 * deliberately absent: they are writable without root on common setups, and a
 * long-lived server that probes on a timer must not execute from them.
 */
const NVIDIA_SMI_LINUX_PATHS = ["/usr/bin/nvidia-smi", "/bin/nvidia-smi"] as const;

/**
 * Windows 10/11 installs use a drive-root `Windows` directory. Accepting an
 * arbitrary drive-absolute path would let a tampered environment redirect the
 * recurring probe into a user-writable tree.
 */
const WINDOWS_SYSTEM_ROOT_PATTERN = /^([A-Za-z]):[\\/][Ww][Ii][Nn][Dd][Oo][Ww][Ss][\\/]*$/u;
const WINDOWS_SYSTEM_DRIVE_PATTERN = /^([A-Za-z]):$/u;
/** Covers C0 and C1: a newline or NUL must not survive normalization. */
const CONTROL_CHARACTER_PATTERN = /\p{Cc}/u;

/**
 * The child needs enough to load its own vendor library and nothing else.
 *
 * `PATH` is excluded so the helper cannot resolve a planted sibling tool, and
 * on Windows it also removes `PATH` from the DLL search order. `LD_LIBRARY_PATH`
 * and `LD_PRELOAD` are excluded so a tampered loader path cannot inject code
 * into the probe. A driver installed outside the default loader search path
 * therefore reports unsupported rather than being reached through a
 * caller-influenced variable.
 */
const ALLOWED_POSIX_ENVIRONMENT_NAMES = new Set(["temp", "tmp", "tmpdir"]);

export interface GpuProbeProcessShape {
  /** Never rejects. Resolves an explicit unavailable measurement on every failure path. */
  readonly read: () => Promise<ServerSystemGpuTelemetry>;
  readonly close: () => Promise<void>;
}

type SpawnLike = typeof spawn;
type IsExecutableFileLike = (filePath: string, platform: NodeJS.Platform) => boolean;

interface GpuProbeProcessOptions {
  readonly platform?: NodeJS.Platform;
  readonly env?: NodeJS.ProcessEnv;
  readonly isExecutableFile?: IsExecutableFileLike;
  readonly spawnProcess?: SpawnLike;
  readonly probeTimeoutMs?: number;
  readonly forceSettleGraceMs?: number;
  readonly shutdownCloseGraceMs?: number;
}

type EnvironmentValue =
  | { readonly state: "missing" }
  | { readonly state: "ambiguous" }
  | { readonly state: "present"; readonly value: string };

/**
 * `process.env` is case-insensitive on Windows, but injected/test environment
 * objects can contain several spellings of the same key. Depending on object
 * insertion order at a security boundary would make the chosen system root
 * ambiguous, so duplicates fail closed even when their values happen to match.
 */
function readUniqueEnvironmentValue(env: NodeJS.ProcessEnv, name: string): EnvironmentValue {
  const wanted = name.toLowerCase();
  let found: string | undefined;
  for (const [key, value] of Object.entries(env)) {
    if (key.toLowerCase() !== wanted || value === undefined) continue;
    if (found !== undefined) return { state: "ambiguous" };
    found = value;
  }
  return found === undefined ? { state: "missing" } : { state: "present", value: found };
}

export function buildGpuProbeEnvironment(
  source: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): NodeJS.ProcessEnv {
  if (platform === "win32") {
    const systemRoot = validatedWindowsSystemRoot(source);
    if (systemRoot === null) return {};
    const systemDrive = systemRoot.slice(0, 2);
    return {
      SystemRoot: systemRoot,
      windir: systemRoot,
      SystemDrive: systemDrive,
    };
  }

  const environment: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined && ALLOWED_POSIX_ENVIRONMENT_NAMES.has(name.toLowerCase())) {
      environment[name] = value;
    }
  }
  return environment;
}

export function validatedWindowsSystemRoot(env: NodeJS.ProcessEnv): string | null {
  const systemRootValue = readUniqueEnvironmentValue(env, "SystemRoot");
  const windowsDirectoryValue = readUniqueEnvironmentValue(env, "windir");
  const systemDriveValue = readUniqueEnvironmentValue(env, "SystemDrive");
  if (
    systemRootValue.state === "ambiguous" ||
    windowsDirectoryValue.state === "ambiguous" ||
    systemDriveValue.state === "ambiguous"
  ) {
    return null;
  }

  const parseRoot = (raw: string): string | null => {
    if (CONTROL_CHARACTER_PATTERN.test(raw)) return null;
    const match = WINDOWS_SYSTEM_ROOT_PATTERN.exec(raw.trim());
    const drive = match?.[1]?.toUpperCase();
    return drive === undefined ? null : `${drive}:\\Windows`;
  };
  const systemRoot =
    systemRootValue.state === "present" ? parseRoot(systemRootValue.value) : undefined;
  const windowsDirectory =
    windowsDirectoryValue.state === "present" ? parseRoot(windowsDirectoryValue.value) : undefined;
  if (systemRoot === null || windowsDirectory === null) return null;
  if (
    systemRoot !== undefined &&
    windowsDirectory !== undefined &&
    systemRoot !== windowsDirectory
  ) {
    return null;
  }

  let configuredDrive: string | undefined;
  if (systemDriveValue.state === "present") {
    if (CONTROL_CHARACTER_PATTERN.test(systemDriveValue.value)) return null;
    const match = WINDOWS_SYSTEM_DRIVE_PATTERN.exec(systemDriveValue.value.trim());
    configuredDrive = match?.[1]?.toUpperCase();
    if (configuredDrive === undefined) return null;
  }

  const trustedRoot = systemRoot ?? windowsDirectory;
  if (trustedRoot === undefined) {
    // Missing environment data may safely fall back only to the standard
    // protected Windows directory. A non-C install needs the root/drive pair.
    if (configuredDrive !== undefined && configuredDrive !== WINDOWS_DEFAULT_SYSTEM_DRIVE) {
      return null;
    }
    return `${WINDOWS_DEFAULT_SYSTEM_DRIVE}:\\Windows`;
  }

  const rootDrive = trustedRoot.slice(0, 1);
  if (configuredDrive !== undefined && configuredDrive !== rootDrive) return null;
  if (rootDrive !== WINDOWS_DEFAULT_SYSTEM_DRIVE && configuredDrive === undefined) return null;
  return pathWin32.normalize(`${rootDrive}:\\Windows`);
}

function isExecutableFileOnDisk(filePath: string, platform: NodeJS.Platform): boolean {
  try {
    if (!statSync(filePath).isFile()) return false;
    if (platform === "win32") return true;
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the GPU helper from trusted platform locations only.
 *
 * `PATH` is never consulted. The server hydrates `PATH` at startup with
 * user-writable tool directories (npm, pnpm, Volta, scoop shims), so a
 * PATH-resolved helper on a repeating timer would execute anything an
 * unprivileged process could drop into one of them.
 */
export function resolveTrustedGpuProbePath(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  isExecutable: IsExecutableFileLike = isExecutableFileOnDisk,
): string | null {
  if (platform === "win32") {
    const systemRoot = validatedWindowsSystemRoot(env);
    if (systemRoot === null) return null;
    const candidate = pathWin32.join(systemRoot, ...NVIDIA_SMI_WINDOWS_SUBPATH);
    return isExecutable(candidate, platform) ? candidate : null;
  }
  if (platform === "linux") {
    for (const candidate of NVIDIA_SMI_LINUX_PATHS) {
      if (isExecutable(candidate, platform)) return candidate;
    }
    return null;
  }
  // macOS (including current Apple Silicon) and every other platform expose no
  // trusted GPU telemetry source to this build.
  return null;
}

function boundedPositiveInteger(value: number | undefined, fallback: number, maximum: number) {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 && value <= maximum
    ? value
    : fallback;
}

function requestKill(child: ChildProcess): void {
  try {
    child.kill("SIGKILL");
  } catch {
    /* best-effort */
  }
}

/**
 * Owner for bounded, disposable GPU helper processes.
 *
 * Every read settles: the helper is third-party, and Node's `close` event
 * waits for the process *and* its stdio pipes, so a grandchild holding stdout
 * or an uninterruptible driver call can withhold it indefinitely. A force
 * deadline settles the caller either way, while the registry keeps the
 * still-live child visible to `close()` for shutdown reaping.
 */
function makeGpuProbeProcessWithOptions(
  options: GpuProbeProcessOptions = {},
): GpuProbeProcessShape {
  const platform = options.platform ?? process.platform;
  const environment = options.env ?? process.env;
  const isExecutable = options.isExecutableFile ?? isExecutableFileOnDisk;
  const spawnProcess = options.spawnProcess ?? spawn;
  const probeTimeoutMs = boundedPositiveInteger(options.probeTimeoutMs, PROBE_TIMEOUT_MS, 10_000);
  const forceSettleGraceMs = boundedPositiveInteger(
    options.forceSettleGraceMs,
    PROBE_FORCE_SETTLE_GRACE_MS,
    10_000,
  );
  const shutdownCloseGraceMs = boundedPositiveInteger(
    options.shutdownCloseGraceMs,
    SHUTDOWN_CLOSE_GRACE_MS,
    10_000,
  );

  const liveChildren = new Set<ChildProcess>();
  const childClosed = new Map<ChildProcess, Promise<void>>();
  let closed = false;
  let closePromise: Promise<void> | null = null;

  const read = (): Promise<ServerSystemGpuTelemetry> =>
    new Promise((resolve) => {
      if (closed) {
        resolve(probeFailedGpuTelemetry());
        return;
      }
      // A helper the OS has not reaped still counts. Refusing to start a
      // second one keeps a wedged driver from stacking processes behind it;
      // GPU telemetry stays explicitly unavailable instead.
      if (liveChildren.size >= MAX_LIVE_HELPERS) {
        resolve(probeFailedGpuTelemetry());
        return;
      }

      const command = resolveTrustedGpuProbePath(platform, environment, isExecutable);
      if (command === null) {
        resolve(unsupportedGpuTelemetry());
        return;
      }

      let child: ChildProcess;
      try {
        child = spawnProcess(command, [...NVIDIA_SMI_ARGS], {
          env: buildGpuProbeEnvironment(environment, platform),
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });
      } catch {
        resolve(probeFailedGpuTelemetry());
        return;
      }

      liveChildren.add(child);
      let signalClosed: (() => void) | undefined;
      childClosed.set(
        child,
        new Promise<void>((resolveClosed) => {
          signalClosed = resolveClosed;
        }),
      );

      let output = "";
      let failed = false;
      let settled = false;
      let killDeadline: ReturnType<typeof setTimeout> | undefined;
      let forceSettleDeadline: ReturnType<typeof setTimeout> | undefined;

      const settle = (ok: boolean) => {
        if (settled) return;
        settled = true;
        if (killDeadline !== undefined) clearTimeout(killDeadline);
        if (forceSettleDeadline !== undefined) clearTimeout(forceSettleDeadline);
        resolve(ok && !failed ? parseGpuProbeOutput(output) : probeFailedGpuTelemetry());
      };

      // Registry membership tracks the OS process, not the caller's promise, so
      // a force-settled helper stays visible to `close()` until it truly exits.
      const retire = () => {
        liveChildren.delete(child);
        childClosed.delete(child);
        signalClosed?.();
      };

      // Registered before stdio is touched: Node can hand back null streams for
      // EMFILE/ENFILE and emit the spawn error a tick later.
      child.once("error", () => {
        failed = true;
      });
      child.once("close", (exitCode) => {
        retire();
        settle(exitCode === 0);
      });

      killDeadline = setTimeout(() => {
        failed = true;
        requestKill(child);
      }, probeTimeoutMs);
      forceSettleDeadline = setTimeout(() => {
        failed = true;
        requestKill(child);
        settle(false);
      }, probeTimeoutMs + forceSettleGraceMs);

      if (!child.stdout || !child.stderr) {
        failed = true;
        requestKill(child);
        return;
      }

      try {
        child.stderr.on("error", () => {
          failed = true;
          requestKill(child);
        });
        // Drained and discarded: stderr is never accumulated, parsed, or logged.
        child.stderr.resume();
        child.stdout.on("error", () => {
          failed = true;
          requestKill(child);
        });
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          if (failed) return;
          output += chunk;
          if (Buffer.byteLength(output, "utf8") > MAX_PROBE_OUTPUT_BYTES) {
            failed = true;
            requestKill(child);
          }
        });
      } catch {
        failed = true;
        requestKill(child);
      }
    });

  const close = () => {
    if (closePromise) return closePromise;
    closed = true;
    closePromise = (async () => {
      const pendingClose = [...liveChildren].map(
        (child) => childClosed.get(child) ?? Promise.resolve(),
      );
      for (const child of liveChildren) {
        requestKill(child);
      }
      if (pendingClose.length === 0) return;
      let shutdownDeadline: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        Promise.all(pendingClose).finally(() => {
          if (shutdownDeadline !== undefined) clearTimeout(shutdownDeadline);
        }),
        // Returns even if the OS has not released an uninterruptible child.
        new Promise<void>((resolveShutdown) => {
          shutdownDeadline = setTimeout(resolveShutdown, shutdownCloseGraceMs);
        }),
      ]);
    })();
    return closePromise;
  };

  return { read, close };
}

export function makeGpuProbeProcess(): GpuProbeProcessShape {
  return makeGpuProbeProcessWithOptions();
}

/**
 * Test-only process seam. Production callers cannot supply an alternate
 * platform, environment, executable check, or spawn implementation.
 */
export function makeGpuProbeProcessForTest(options: GpuProbeProcessOptions): GpuProbeProcessShape {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("GPU probe test overrides are unavailable.");
  }
  return makeGpuProbeProcessWithOptions(options);
}

/** Exposed so tests can assert the exact argv the helper is launched with. */
export const GPU_PROBE_ARGS: ReadonlyArray<string> = NVIDIA_SMI_ARGS;
