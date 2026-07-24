import type {
  WorkspaceObservatoryObservation,
  WorkspaceObservatoryRowsResult,
} from "@cafecode/contracts";

export const WORKSPACE_OBSERVATORY_DIFF_LIMIT = 200;

export type FileLineChange =
  | { readonly kind: "added"; readonly line: number; readonly after: string }
  | { readonly kind: "removed"; readonly line: number; readonly before: string }
  | {
      readonly kind: "changed";
      readonly line: number;
      readonly before: string;
      readonly after: string;
    };

export interface FileLineDiff {
  readonly changed: boolean;
  readonly changes: readonly FileLineChange[];
  readonly truncated: boolean;
}

export type RowChange =
  | {
      readonly kind: "added";
      readonly identity: readonly string[];
      readonly after: readonly string[];
    }
  | {
      readonly kind: "removed";
      readonly identity: readonly string[];
      readonly before: readonly string[];
    }
  | {
      readonly kind: "changed";
      readonly identity: readonly string[];
      readonly before: readonly string[];
      readonly after: readonly string[];
      readonly changedColumns: readonly number[];
    };

export interface RowSnapshotDiff {
  readonly changed: boolean;
  readonly identityProven: boolean;
  readonly changes: readonly RowChange[];
  readonly truncated: boolean;
}

function pushBounded<T>(target: T[], value: T): boolean {
  if (target.length >= WORKSPACE_OBSERVATORY_DIFF_LIMIT) return false;
  target.push(value);
  return true;
}

/**
 * Computes a bounded, latest-snapshot-only line summary. Common leading and
 * trailing lines are removed first so a local insertion does not make the
 * remainder of a file look rewritten.
 */
export function diffFileLines(before: string, after: string): FileLineDiff {
  if (before === after) return { changed: false, changes: [], truncated: false };
  const previous = before.split("\n");
  const current = after.split("\n");
  let prefix = 0;
  while (
    prefix < previous.length &&
    prefix < current.length &&
    previous[prefix] === current[prefix]
  )
    prefix += 1;
  let suffix = 0;
  while (
    suffix < previous.length - prefix &&
    suffix < current.length - prefix &&
    previous[previous.length - 1 - suffix] === current[current.length - 1 - suffix]
  )
    suffix += 1;
  const previousMiddle = previous.slice(prefix, previous.length - suffix);
  const currentMiddle = current.slice(prefix, current.length - suffix);
  const changes: FileLineChange[] = [];
  let truncated = false;
  const shared = Math.min(previousMiddle.length, currentMiddle.length);
  for (let index = 0; index < shared; index += 1) {
    if (previousMiddle[index] === currentMiddle[index]) continue;
    if (
      !pushBounded(changes, {
        kind: "changed",
        line: prefix + index + 1,
        before: previousMiddle[index]!,
        after: currentMiddle[index]!,
      })
    ) {
      truncated = true;
      break;
    }
  }
  if (!truncated) {
    for (let index = shared; index < previousMiddle.length; index += 1) {
      if (
        !pushBounded(changes, {
          kind: "removed",
          line: prefix + index + 1,
          before: previousMiddle[index]!,
        })
      ) {
        truncated = true;
        break;
      }
    }
  }
  if (!truncated) {
    for (let index = shared; index < currentMiddle.length; index += 1) {
      if (
        !pushBounded(changes, {
          kind: "added",
          line: prefix + index + 1,
          after: currentMiddle[index]!,
        })
      ) {
        truncated = true;
        break;
      }
    }
  }
  return { changed: true, changes, truncated };
}

function identityKey(row: readonly string[], indexes: readonly number[]): string {
  return JSON.stringify(indexes.map((index) => row[index]));
}

function indexedRows(
  snapshot: WorkspaceObservatoryRowsResult,
): Map<string, readonly string[]> | null {
  const indexes = snapshot.identityColumns ?? [];
  if (indexes.length === 0 || indexes.some((index) => index >= snapshot.columns.length))
    return null;
  const result = new Map<string, readonly string[]>();
  for (const row of snapshot.rows) {
    const key = identityKey(row, indexes);
    if (result.has(key)) return null;
    result.set(key, row);
  }
  return result;
}

/**
 * Row-level changes are emitted only when both snapshots carry the same
 * complete primary-key indexes and those displayed identities are unique.
 */
export function diffRows(
  before: WorkspaceObservatoryRowsResult,
  after: WorkspaceObservatoryRowsResult,
): RowSnapshotDiff {
  const sameColumns = JSON.stringify(before.columns) === JSON.stringify(after.columns);
  const sameIdentities =
    JSON.stringify(before.identityColumns ?? []) === JSON.stringify(after.identityColumns ?? []);
  const changed = !sameColumns || JSON.stringify(before.rows) !== JSON.stringify(after.rows);
  if (!changed) return { changed: false, identityProven: false, changes: [], truncated: false };
  const previousIndexes = before.identityColumns ?? [];
  const currentIndexes = after.identityColumns ?? [];
  if (!sameColumns || !sameIdentities)
    return { changed: true, identityProven: false, changes: [], truncated: false };
  const previous = indexedRows(before);
  const current = indexedRows(after);
  if (!previous || !current)
    return { changed: true, identityProven: false, changes: [], truncated: false };
  const changes: RowChange[] = [];
  let truncated = false;
  for (const [key, row] of previous) {
    const next = current.get(key);
    const identity = previousIndexes.map((index) => row[index]!);
    if (!next) {
      if (!pushBounded(changes, { kind: "removed", identity, before: row })) {
        truncated = true;
        break;
      }
      continue;
    }
    if (JSON.stringify(row) !== JSON.stringify(next)) {
      const changedColumns = row.flatMap((cell, index) => (cell === next[index] ? [] : [index]));
      if (
        !pushBounded(changes, {
          kind: "changed",
          identity,
          before: row,
          after: next,
          changedColumns,
        })
      ) {
        truncated = true;
        break;
      }
    }
  }
  if (!truncated) {
    for (const [key, row] of current) {
      if (previous.has(key)) continue;
      if (
        !pushBounded(changes, {
          kind: "added",
          identity: currentIndexes.map((index) => row[index]!),
          after: row,
        })
      ) {
        truncated = true;
        break;
      }
    }
  }
  return { changed: true, identityProven: true, changes, truncated };
}

export function stableAgentColorIndex(agentId: string, colorCount: number): number {
  let hash = 2_166_136_261;
  for (const character of agentId) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return colorCount > 0 ? (hash >>> 0) % colorCount : 0;
}

export function observationKey(observation: WorkspaceObservatoryObservation): string {
  return [
    observation.agentId,
    observation.threadId,
    observation.operation,
    observation.path,
    observation.status,
    observation.timestamp,
  ].join("\u0000");
}

export function isObservationRelevantToDirectory(path: string, directory: string): boolean {
  const parent = path.split("/").slice(0, -1).join("/");
  return parent === directory;
}
