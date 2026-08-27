import {
  spawn as spawnNodeProcess,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from "node:child_process";
import * as NodeOs from "node:os";

import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { readProcessRows, type ProcessRow } from "../diagnostics/ProcessDiagnostics.ts";

export const PROVIDER_PROCESS_PRIORITY = NodeOs.constants.priority.PRIORITY_BELOW_NORMAL;

const DESCENDANT_SCAN_DELAYS = [100, 500] as const;

export interface ProviderProcessPriorityResult {
  readonly pid: number;
  readonly priority: number;
  readonly adjusted: boolean;
  readonly error?: string;
}

export interface ProviderProcessSpawnInput {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd?: string;
  readonly env: NodeJS.ProcessEnv;
  readonly signal: AbortSignal;
  readonly onStderr?: (data: string) => void;
  readonly onPriorityResult?: (result: ProviderProcessPriorityResult) => void;
}

export function collectProviderProcessTreePids(
  rows: ReadonlyArray<ProcessRow>,
  rootPid: number,
): ReadonlyArray<number> {
  if (!Number.isSafeInteger(rootPid) || rootPid <= 0) return [];

  const childrenByParent = new Map<number, number[]>();
  for (const row of rows) {
    const children = childrenByParent.get(row.ppid) ?? [];
    children.push(row.pid);
    childrenByParent.set(row.ppid, children);
  }

  const pids = [rootPid];
  const seen = new Set(pids);
  const queue = [...(childrenByParent.get(rootPid) ?? [])];
  while (queue.length > 0) {
    const pid = queue.shift();
    if (pid === undefined || seen.has(pid)) continue;
    seen.add(pid);
    pids.push(pid);
    queue.push(...(childrenByParent.get(pid) ?? []));
  }
  return pids;
}

export function setProviderProcessPriority(
  pid: number,
  setPriority: (pid: number, priority: number) => void = NodeOs.setPriority,
): ProviderProcessPriorityResult {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return {
      pid,
      priority: PROVIDER_PROCESS_PRIORITY,
      adjusted: false,
      error: "Provider process PID is invalid.",
    };
  }

  try {
    setPriority(pid, PROVIDER_PROCESS_PRIORITY);
    return { pid, priority: PROVIDER_PROCESS_PRIORITY, adjusted: true };
  } catch (cause) {
    return {
      pid,
      priority: PROVIDER_PROCESS_PRIORITY,
      adjusted: false,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

export function spawnProviderProcessAtLowerPriority(
  input: ProviderProcessSpawnInput,
  spawn: (
    command: string,
    args: ReadonlyArray<string>,
    options: SpawnOptionsWithoutStdio,
  ) => ChildProcessWithoutNullStreams = spawnNodeProcess,
): ChildProcessWithoutNullStreams {
  const child = spawn(input.command, input.args, {
    ...(input.cwd ? { cwd: input.cwd } : {}),
    env: input.env,
    signal: input.signal,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stderr.setEncoding("utf8");
  if (input.onStderr) {
    child.stderr.on("data", input.onStderr);
  }

  const result = setProviderProcessPriority(child.pid ?? 0);
  input.onPriorityResult?.(result);
  return child;
}

/**
 * Lower a provider runtime before it can saturate the workstation, then cover
 * shell-launched descendants after they appear. Provider startup remains
 * fail-open when the operating system rejects a priority change.
 */
const lowerProviderProcessTreePriorityEffect = Effect.fn("lowerProviderProcessTreePriority")(
  function* (input: { readonly provider: string; readonly rootPid: number }) {
    const attemptedPids = new Set<number>();

    const lowerPid = (pid: number) =>
      Effect.gen(function* () {
        if (attemptedPids.has(pid)) return;
        attemptedPids.add(pid);
        const result = setProviderProcessPriority(pid);
        if (!result.adjusted) {
          yield* Effect.logWarning("provider.process.priority.unavailable", {
            provider: input.provider,
            pid,
            priority: result.priority,
            error: result.error ?? "Unknown operating system error.",
          });
        }
      });

    yield* lowerPid(input.rootPid);

    for (const delayMs of DESCENDANT_SCAN_DELAYS) {
      yield* Effect.sleep(Duration.millis(delayMs));
      const rows = yield* readProcessRows();
      for (const pid of collectProviderProcessTreePids(rows, input.rootPid)) {
        yield* lowerPid(pid);
      }
    }

    yield* Effect.logDebug("provider.process.priority.applied", {
      provider: input.provider,
      rootPid: input.rootPid,
      priority: PROVIDER_PROCESS_PRIORITY,
      processCount: attemptedPids.size,
    });
  },
);

export const lowerProviderProcessTreePriority = (input: {
  readonly provider: string;
  readonly rootPid: number;
}) =>
  lowerProviderProcessTreePriorityEffect(input).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("provider.process.priority.scan-failed", {
        provider: input.provider,
        rootPid: input.rootPid,
        cause: Cause.pretty(cause),
      }),
    ),
  );
