// @effect-diagnostics nodeBuiltinImport:off globalTimers:off

import { spawn, type ChildProcess } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { win32 as pathWin32 } from "node:path";

import { buildGpuProbeEnvironment, validatedWindowsSystemRoot } from "./GpuProbeProcess.ts";
import type {
  ClosableHostNetworkCounterReaderShape,
  HostNetworkCounters,
} from "./HostNetworkTelemetry.ts";

const MAX_COUNTER_SOURCE_BYTES = 65_536;
const MAX_WINDOWS_OUTPUT_BYTES = 256;
const WINDOWS_PROBE_TIMEOUT_MS = 2_000;
const WINDOWS_FORCE_SETTLE_GRACE_MS = 500;
const WINDOWS_SHUTDOWN_CLOSE_GRACE_MS = 1_000;
/** One wedged helper plus one bounded recovery attempt; never grow without limit. */
const MAX_UNREAPED_WINDOWS_HELPERS = 2;
const WINDOWS_POWERSHELL_SUBPATH = [
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
] as const;

/**
 * Fixed program: emits two aggregate UInt64 counters and no adapter identity.
 * No caller, workspace, setting, address, or filter is interpolated.
 */
const WINDOWS_NETWORK_COUNTER_SCRIPT =
  "$ErrorActionPreference='Stop';" +
  "$PSModuleAutoLoadingPreference='None';" +
  "$module=$env:SystemRoot+'\\System32\\WindowsPowerShell\\v1.0\\Modules\\NetAdapter\\NetAdapter.psd1';" +
  "Microsoft.PowerShell.Core\\Import-Module -Name $module -Force -ErrorAction Stop;" +
  "$items=@(NetAdapter\\Get-NetAdapterStatistics -ErrorAction Stop);" +
  "[UInt64]$rx=0;[UInt64]$tx=0;" +
  "foreach($item in $items){$rx+=[UInt64]$item.ReceivedBytes;$tx+=[UInt64]$item.SentBytes};" +
  "[Console]::Out.Write(('{0},{1}' -f $rx,$tx))";

const WINDOWS_NETWORK_COUNTER_ARGS = [
  "-NoLogo",
  "-NoProfile",
  "-NonInteractive",
  "-ExecutionPolicy",
  "Bypass",
  "-Command",
  WINDOWS_NETWORK_COUNTER_SCRIPT,
] as const;

type SpawnLike = typeof spawn;
type ReadFileLike = (path: string, encoding: BufferEncoding) => Promise<string>;
type IsExecutableFileLike = (filePath: string) => boolean;

interface HostNetworkCounterReaderOptions {
  readonly platform?: NodeJS.Platform;
  readonly env?: NodeJS.ProcessEnv;
  readonly spawnProcess?: SpawnLike;
  readonly readTextFile?: ReadFileLike;
  readonly isExecutableFile?: IsExecutableFileLike;
  readonly timeoutMs?: number;
  readonly forceSettleGraceMs?: number;
  readonly shutdownCloseGraceMs?: number;
}

interface TrackedNetworkChild {
  readonly terminated: Promise<void>;
  readonly stopForClose: () => void;
  readonly detachAfterClose: () => void;
}

const swallowLateProcessError = () => {
  // A detached helper may report a delayed process error after bounded owner
  // shutdown. It has already failed closed and owns no result payload.
};

const swallowLateStreamError = () => {
  // Destroyed stdio can report a delayed error after bounded cleanup.
};

function scheduleDeadline(callback: () => void, delayMs: number): ReturnType<typeof setTimeout> {
  const deadline = setTimeout(callback, delayMs);
  deadline.unref();
  return deadline;
}

function safeCounter(value: bigint): number | null {
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
}

export function parseWindowsNetworkCounterOutput(output: string): HostNetworkCounters | null {
  const match = /^(\d+),(\d+)$/u.exec(output.trim());
  if (!match) return null;
  try {
    const receivedBytes = safeCounter(BigInt(match[1]!));
    const transmittedBytes = safeCounter(BigInt(match[2]!));
    return receivedBytes === null || transmittedBytes === null
      ? null
      : { receivedBytes, transmittedBytes };
  } catch {
    return null;
  }
}

export function parseLinuxNetworkCounterSource(source: string): HostNetworkCounters | null {
  if (Buffer.byteLength(source, "utf8") > MAX_COUNTER_SOURCE_BYTES) return null;
  let receivedTotal = 0n;
  let transmittedTotal = 0n;
  let rowCount = 0;

  for (const line of source.split(/\r?\n/u)) {
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const fields = line
      .slice(separator + 1)
      .trim()
      .split(/\s+/u);
    if (fields.length < 16 || fields.some((field) => !/^\d+$/u.test(field))) {
      return null;
    }
    try {
      receivedTotal += BigInt(fields[0]!);
      transmittedTotal += BigInt(fields[8]!);
    } catch {
      return null;
    }
    rowCount += 1;
  }

  if (rowCount === 0) return null;
  const receivedBytes = safeCounter(receivedTotal);
  const transmittedBytes = safeCounter(transmittedTotal);
  return receivedBytes === null || transmittedBytes === null
    ? null
    : { receivedBytes, transmittedBytes };
}

function isExecutableFile(filePath: string): boolean {
  try {
    accessSync(filePath, constants.X_OK);
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

export function resolveTrustedWindowsNetworkProbePath(
  env: NodeJS.ProcessEnv,
  executableCheck: IsExecutableFileLike = isExecutableFile,
): string | null {
  const systemRoot = validatedWindowsSystemRoot(env);
  if (systemRoot === null) return null;
  const candidate = pathWin32.join(systemRoot, ...WINDOWS_POWERSHELL_SUBPATH);
  return executableCheck(candidate) ? candidate : null;
}

function makeReader(
  options: HostNetworkCounterReaderOptions,
): ClosableHostNetworkCounterReaderShape {
  const platform = options.platform ?? process.platform;
  const environment = options.env ?? process.env;
  const spawnProcess = options.spawnProcess ?? spawn;
  const readTextFile = options.readTextFile ?? readFile;
  const executableCheck = options.isExecutableFile ?? isExecutableFile;
  const timeoutMs = Math.max(1, options.timeoutMs ?? WINDOWS_PROBE_TIMEOUT_MS);
  const forceSettleGraceMs = Math.max(
    1,
    options.forceSettleGraceMs ?? WINDOWS_FORCE_SETTLE_GRACE_MS,
  );
  const shutdownCloseGraceMs = Math.max(
    1,
    options.shutdownCloseGraceMs ?? WINDOWS_SHUTDOWN_CLOSE_GRACE_MS,
  );
  let activeChild: TrackedNetworkChild | null = null;
  const unreapedChildren = new Set<TrackedNetworkChild>();
  const trackedChildren = new Set<TrackedNetworkChild>();
  let closed = false;
  let closePromise: Promise<void> | null = null;

  const readWindows = (): Promise<HostNetworkCounters | null> => {
    if (closed || activeChild !== null || unreapedChildren.size >= MAX_UNREAPED_WINDOWS_HELPERS) {
      return Promise.resolve(null);
    }
    const executable = resolveTrustedWindowsNetworkProbePath(environment, executableCheck);
    if (executable === null) return Promise.resolve(null);

    return new Promise((resolve) => {
      let settled = false;
      let failed = false;
      let retired = false;
      let output = "";
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let forceSettle: ReturnType<typeof setTimeout> | undefined;
      let terminated = false;
      let streamsDetached = false;
      let lifecycleDetached = false;
      let signalTerminated: (() => void) | undefined;
      const terminatedPromise = new Promise<void>((resolveTerminated) => {
        signalTerminated = resolveTerminated;
      });
      let record: TrackedNetworkChild;

      const finish = (value: HostNetworkCounters | null) => {
        if (settled) return;
        settled = true;
        if (timeout !== undefined) clearTimeout(timeout);
        if (forceSettle !== undefined) clearTimeout(forceSettle);
        resolve(value);
      };

      let child: ChildProcess;
      try {
        child = spawnProcess(executable, [...WINDOWS_NETWORK_COUNTER_ARGS], {
          cwd: pathWin32.dirname(executable),
          windowsHide: true,
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
          env: buildGpuProbeEnvironment(environment, "win32"),
        });
      } catch {
        finish(null);
        return;
      }

      const retireSlot = () => {
        if (retired) return;
        retired = true;
        if (activeChild === record) activeChild = null;
        unreapedChildren.add(record);
        try {
          child.unref();
        } catch {
          // A hostile/mocked child cannot prevent bounded slot retirement.
        }
      };

      const markTerminated = () => {
        if (!terminated) {
          terminated = true;
          signalTerminated?.();
        }
      };

      const releaseRecord = () => {
        if (activeChild === record) activeChild = null;
        unreapedChildren.delete(record);
        trackedChildren.delete(record);
      };

      const detachStreams = () => {
        if (streamsDetached) return;
        streamsDetached = true;
        for (const stream of [child.stdout, child.stderr]) {
          if (!stream) continue;
          try {
            stream.removeListener("error", retire);
            stream.on("error", swallowLateStreamError);
            stream.destroy();
          } catch {
            // Best effort: unref below releases the process handle.
          }
        }
      };

      const detachLifecycle = () => {
        if (lifecycleDetached) return;
        lifecycleDetached = true;
        try {
          child.removeListener("error", onChildError);
          child.removeListener("exit", onChildExit);
          child.removeListener("close", onChildClose);
          child.on("error", swallowLateProcessError);
        } catch {
          // Bounded cleanup remains authoritative.
        }
      };

      const retire = () => {
        failed = true;
        try {
          child.kill();
        } catch {
          // The force-settle deadline below still bounds the caller.
        }
      };
      const onChildError = () => {
        failed = true;
        retireSlot();
        finish(null);
        detachStreams();
      };
      const onChildExit = () => {
        markTerminated();
        if (settled || retired || closed) {
          detachStreams();
          detachLifecycle();
          releaseRecord();
        }
      };
      const onChildClose = (code: number | null) => {
        markTerminated();
        finish(code === 0 && !failed ? parseWindowsNetworkCounterOutput(output) : null);
        detachStreams();
        detachLifecycle();
        releaseRecord();
      };
      const stopForClose = () => {
        failed = true;
        retireSlot();
        retire();
        finish(null);
        detachStreams();
      };
      const detachAfterClose = () => {
        if (timeout !== undefined) clearTimeout(timeout);
        if (forceSettle !== undefined) clearTimeout(forceSettle);
        finish(null);
        detachStreams();
        detachLifecycle();
        try {
          child.unref();
        } catch {
          // Best effort.
        }
        markTerminated();
        releaseRecord();
      };
      record = {
        terminated: terminatedPromise,
        stopForClose,
        detachAfterClose,
      };
      activeChild = record;
      trackedChildren.add(record);

      timeout = scheduleDeadline(retire, timeoutMs);
      forceSettle = scheduleDeadline(() => {
        retireSlot();
        detachStreams();
        finish(null);
        if (terminated) {
          detachLifecycle();
          releaseRecord();
        }
      }, timeoutMs + forceSettleGraceMs);

      child.on("error", onChildError);
      child.once("exit", onChildExit);
      child.once("close", onChildClose);
      if (!child.stdout || !child.stderr) {
        retire();
        retireSlot();
        detachStreams();
        finish(null);
        return;
      }
      child.stderr.on("error", retire);
      child.stderr.resume();
      child.stdout.on("error", retire);
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        if (failed) return;
        output += chunk;
        if (Buffer.byteLength(output, "utf8") > MAX_WINDOWS_OUTPUT_BYTES) {
          output = "";
          retire();
        }
      });
    });
  };

  return {
    read: () => {
      if (closed) return Promise.resolve(null);
      if (platform === "linux") {
        return Promise.resolve()
          .then(() => readTextFile("/proc/net/dev", "utf8"))
          .then(parseLinuxNetworkCounterSource, () => null);
      }
      if (platform === "win32") return readWindows();
      return Promise.resolve(null);
    },
    close: () => {
      if (closePromise) return closePromise;
      closed = true;
      closePromise = (async () => {
        const records = [...trackedChildren];
        for (const record of records) {
          try {
            record.stopForClose();
          } catch {
            // The deadline and final detachment below remain authoritative.
          }
        }
        if (records.length > 0) {
          let shutdownDeadline: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              Promise.all(records.map((record) => record.terminated)),
              new Promise<void>((resolve) => {
                shutdownDeadline = scheduleDeadline(resolve, shutdownCloseGraceMs);
              }),
            ]);
          } finally {
            if (shutdownDeadline !== undefined) clearTimeout(shutdownDeadline);
          }
        }
        for (const record of records) {
          try {
            record.detachAfterClose();
          } catch {
            // Best effort; every normally shaped record is still unref'd.
          }
        }
        activeChild = null;
        unreapedChildren.clear();
        trackedChildren.clear();
      })();
      return closePromise;
    },
  };
}

export function makeHostNetworkCounterReader(): ClosableHostNetworkCounterReaderShape {
  return makeReader({});
}

/** Test-only seam; production callers cannot redirect the recurring helper. */
export function makeHostNetworkCounterReaderForTest(
  options: HostNetworkCounterReaderOptions,
): ClosableHostNetworkCounterReaderShape {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Host network counter reader test overrides are unavailable.");
  }
  return makeReader(options);
}

export const HOST_NETWORK_WINDOWS_ARGS: ReadonlyArray<string> = WINDOWS_NETWORK_COUNTER_ARGS;
