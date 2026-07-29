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
/** One final bounded reap attempt after a helper has released its admission slot. */
const PROBE_RETIRED_REAP_GRACE_MS = 1_000;
const SHUTDOWN_CLOSE_GRACE_MS = 1_000;
/** One probe may actively own the process boundary at a time. */
const MAX_CONCURRENT_GPU_HELPERS = 1;
/**
 * Retain at most two OS-unreaped helpers: the original wedged process and one
 * bounded recovery attempt. A second unreaped failure opens a fail-closed
 * circuit until either child eventually exits or the owner is disposed.
 */
const MAX_UNREAPED_GPU_HELPERS = 2;

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
 *
 * NVIDIA's Windows helper also consults `ProgramFiles`/`ProgramW6432` while
 * initializing NVML. Those values are derived from the same validated system
 * drive as `SystemRoot`; inherited values are never forwarded.
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
  readonly retiredReapGraceMs?: number;
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
    const programFiles = `${systemDrive}\\Program Files`;
    return {
      SystemRoot: systemRoot,
      windir: systemRoot,
      SystemDrive: systemDrive,
      ProgramFiles: programFiles,
      ProgramW6432: programFiles,
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

function requestUnref(child: ChildProcess): void {
  try {
    child.unref();
  } catch {
    /* best-effort */
  }
}

function scheduleDeadline(callback: () => void, delayMs: number): ReturnType<typeof setTimeout> {
  const deadline = setTimeout(callback, delayMs);
  deadline.unref();
  return deadline;
}

const swallowLateProcessError = () => {
  // An OS-unreaped child can report a delayed spawn/runtime error after the
  // owner has completed its bounded shutdown. Keep that event non-fatal
  // without retaining the per-read closure.
};

const swallowLateStreamError = () => {
  // Destroyed stdio may report a delayed error. The probe has already failed
  // closed, so there is no result or diagnostic payload left to update.
};

interface TrackedGpuProbeChild {
  readonly terminated: Promise<void>;
  readonly stopForClose: () => void;
  readonly detachAfterClose: () => void;
}

/**
 * Shutdown must reach every tracked child. Per-record cleanup is isolated so
 * one hostile process object cannot strand the rest or reject close().
 */
function forEachRecord(
  records: ReadonlyArray<TrackedGpuProbeChild>,
  step: (record: TrackedGpuProbeChild) => void,
): void {
  for (const record of records) {
    try {
      step(record);
    } catch {
      // Best effort: the bounded shutdown deadline remains authoritative.
    }
  }
}

/**
 * Owner for bounded, disposable GPU helper processes.
 *
 * Every read settles: the helper is third-party, and Node's `close` event
 * waits for the process *and* its stdio pipes, so a grandchild holding stdout
 * or an uninterruptible driver call can withhold it indefinitely. The active
 * admission slot is therefore released after a bounded force-settle deadline,
 * while OS-unreaped children remain in a separately bounded quarantine for
 * late exit observation and shutdown reaping. One replacement may run behind
 * a wedged child; two unreaped children open a fail-closed circuit instead of
 * allowing an unbounded process leak.
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
  const retiredReapGraceMs = boundedPositiveInteger(
    options.retiredReapGraceMs,
    PROBE_RETIRED_REAP_GRACE_MS,
    10_000,
  );
  const shutdownCloseGraceMs = boundedPositiveInteger(
    options.shutdownCloseGraceMs,
    SHUTDOWN_CLOSE_GRACE_MS,
    10_000,
  );

  const activeChildren = new Set<TrackedGpuProbeChild>();
  const unreapedChildren = new Set<TrackedGpuProbeChild>();
  let closed = false;
  let closePromise: Promise<void> | null = null;

  const read = (): Promise<ServerSystemGpuTelemetry> =>
    new Promise((resolve) => {
      if (closed) {
        resolve(probeFailedGpuTelemetry());
        return;
      }
      // At most one logical probe is active. A single OS-unreaped predecessor
      // may coexist with its replacement, but a second unreaped failure opens
      // the circuit until a late exit releases quarantine capacity.
      if (
        activeChildren.size >= MAX_CONCURRENT_GPU_HELPERS ||
        unreapedChildren.size >= MAX_UNREAPED_GPU_HELPERS
      ) {
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
          ...(platform === "win32" ? { cwd: pathWin32.dirname(command) } : {}),
          env: buildGpuProbeEnvironment(environment, platform),
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });
      } catch {
        resolve(probeFailedGpuTelemetry());
        return;
      }

      let output = "";
      let failed = false;
      let settled = false;
      let terminated = false;
      let retired = false;
      let admissionReleased = false;
      let streamsDetached = false;
      let lifecycleDetached = false;
      let killDeadline: ReturnType<typeof setTimeout> | undefined;
      let forceSettleDeadline: ReturnType<typeof setTimeout> | undefined;
      let retiredReapDeadline: ReturnType<typeof setTimeout> | undefined;
      let signalTerminated: (() => void) | undefined;
      const termination = new Promise<void>((resolveTerminated) => {
        signalTerminated = resolveTerminated;
      });
      let record: TrackedGpuProbeChild;

      const clearReadDeadlines = () => {
        if (killDeadline !== undefined) {
          clearTimeout(killDeadline);
          killDeadline = undefined;
        }
        if (forceSettleDeadline !== undefined) {
          clearTimeout(forceSettleDeadline);
          forceSettleDeadline = undefined;
        }
      };

      const clearRetiredReapDeadline = () => {
        if (retiredReapDeadline === undefined) return;
        clearTimeout(retiredReapDeadline);
        retiredReapDeadline = undefined;
      };

      const settle = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearReadDeadlines();
        const result = ok && !failed ? parseGpuProbeOutput(output) : probeFailedGpuTelemetry();
        output = "";
        resolve(result);
      };

      const releaseAdmission = () => {
        if (admissionReleased) return;
        admissionReleased = true;
        activeChildren.delete(record);
      };

      const markTerminated = () => {
        if (terminated) return;
        terminated = true;
        clearRetiredReapDeadline();
        unreapedChildren.delete(record);
        signalTerminated?.();
      };

      const detachStreams = () => {
        if (streamsDetached) return;
        streamsDetached = true;
        const stdout = child.stdout;
        if (stdout) {
          try {
            stdout.removeListener("error", onStdoutError);
            stdout.removeListener("data", onStdoutData);
            stdout.on("error", swallowLateStreamError);
            stdout.destroy();
          } catch {
            // Cleanup stays best-effort; the process kill and bounded owner
            // shutdown remain authoritative.
          }
        }
        const stderr = child.stderr;
        if (stderr) {
          try {
            stderr.removeListener("error", onStderrError);
            stderr.on("error", swallowLateStreamError);
            stderr.destroy();
          } catch {
            // See stdout cleanup above.
          }
        }
      };

      const detachLifecycle = () => {
        if (lifecycleDetached) return;
        lifecycleDetached = true;
        try {
          child.removeListener("error", onChildError);
        } catch {
          // A hostile or partially initialized process object cannot block
          // cleanup of the remaining tracked children.
        }
        try {
          child.removeListener("exit", onChildExit);
        } catch {
          // See the error-listener cleanup above.
        }
        try {
          child.removeListener("close", onChildClose);
        } catch {
          // See the error-listener cleanup above.
        }
        try {
          child.on("error", swallowLateProcessError);
        } catch {
          // Owner shutdown remains bounded even if listener bookkeeping fails.
        }
      };

      const onChildError = () => {
        failed = true;
      };
      const onChildExit = () => {
        markTerminated();
        // A logically retired caller is already settled, so `close` is no
        // longer needed for output completeness once the OS process exits.
        if (admissionReleased) {
          detachStreams();
          detachLifecycle();
        }
      };
      const onChildClose = (exitCode: number | null) => {
        markTerminated();
        releaseAdmission();
        settle(exitCode === 0);
        detachStreams();
        detachLifecycle();
      };
      const onStderrError = () => {
        failed = true;
        requestKill(child);
      };
      const onStdoutError = () => {
        failed = true;
        requestKill(child);
      };
      const onStdoutData = (chunk: string) => {
        if (failed || settled) return;
        output += chunk;
        if (Buffer.byteLength(output, "utf8") > MAX_PROBE_OUTPUT_BYTES) {
          failed = true;
          requestKill(child);
        }
      };

      /**
       * Retire this read from the active admission slot.
       *
       * Reached from the force-settle deadline and from stdio paths that can
       * never observe output. Latched so a second call cannot overwrite and
       * leak the one bounded reap deadline.
       */
      const retireAfterForceSettle = () => {
        if (retired) return;
        retired = true;
        failed = true;
        requestKill(child);
        settle(false);
        releaseAdmission();
        detachStreams();
        if (terminated) {
          detachLifecycle();
          return;
        }

        // Admission guaranteed capacity before spawn, and there can be only
        // one active child, so this insertion cannot exceed the hard cap.
        unreapedChildren.add(record);
        retiredReapDeadline = scheduleDeadline(() => {
          retiredReapDeadline = undefined;
          if (!terminated) requestKill(child);
        }, retiredReapGraceMs);
      };

      const stopForClose = () => {
        failed = true;
        releaseAdmission();
        clearRetiredReapDeadline();
        requestKill(child);
        settle(false);
        detachStreams();
      };

      const detachAfterClose = () => {
        releaseAdmission();
        unreapedChildren.delete(record);
        clearReadDeadlines();
        clearRetiredReapDeadline();
        detachStreams();
        detachLifecycle();
        output = "";
        // Once the owner's bounded shutdown ends it no longer promises to
        // observe an unkillable process. Release its Node process handle so an
        // OS-stuck helper cannot keep the backend alive after that deadline,
        // then resolve only this internal waiter.
        if (!terminated) {
          requestUnref(child);
          terminated = true;
          signalTerminated?.();
        }
      };

      record = {
        terminated: termination,
        stopForClose,
        detachAfterClose,
      };
      activeChildren.add(record);

      // Registered before stdio is touched: Node can hand back null streams for
      // EMFILE/ENFILE and emit the spawn error a tick later.
      // `kill()` failures can emit more than one process-level error over the
      // timeout, force-settle, reap, and shutdown attempts. A one-shot handler
      // would make the second error fatal to the backend.
      child.on("error", onChildError);
      child.once("exit", onChildExit);
      child.once("close", onChildClose);

      killDeadline = scheduleDeadline(() => {
        failed = true;
        requestKill(child);
      }, probeTimeoutMs);
      forceSettleDeadline = scheduleDeadline(
        retireAfterForceSettle,
        probeTimeoutMs + forceSettleGraceMs,
      );

      // Node can hand back null streams for EMFILE/ENFILE, and stdio wiring can
      // fail part-way. Either way this read can never observe output, so retire
      // it now instead of parking the single admission slot until the regular
      // force-settle deadline. Retirement also destroys any half-wired pipe and
      // installs static error guards for delayed stream errors.
      if (!child.stdout || !child.stderr) {
        retireAfterForceSettle();
        return;
      }

      try {
        child.stderr.on("error", onStderrError);
        // Drained and discarded: stderr is never accumulated, parsed, or logged.
        child.stderr.resume();
        child.stdout.on("error", onStdoutError);
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", onStdoutData);
      } catch {
        retireAfterForceSettle();
      }
    });

  const close = () => {
    if (closePromise) return closePromise;
    closed = true;
    closePromise = (async () => {
      const records = [...new Set([...activeChildren, ...unreapedChildren])];
      forEachRecord(records, (record) => record.stopForClose());
      if (records.length === 0) return;
      let shutdownDeadline: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.all(records.map((record) => record.terminated)),
          // Returns even if the OS has not released an uninterruptible child.
          new Promise<void>((resolveShutdown) => {
            shutdownDeadline = scheduleDeadline(resolveShutdown, shutdownCloseGraceMs);
          }),
        ]);
      } finally {
        if (shutdownDeadline !== undefined) clearTimeout(shutdownDeadline);
        forEachRecord(records, (record) => record.detachAfterClose());
        activeChildren.clear();
        unreapedChildren.clear();
      }
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
