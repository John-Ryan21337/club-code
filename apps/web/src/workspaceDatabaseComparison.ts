import {
  WORKSPACE_DATABASE_LIMITS,
  type WorkspaceObservatoryRowsResult,
} from "@cafecode/contracts";

export const MAX_DATABASE_SNAPSHOT_CHANGES = 40;

export interface DatabaseSnapshotChange {
  readonly kind: "new" | "missing" | "changed";
  readonly key: string;
  readonly before?: readonly string[];
  readonly after?: readonly string[];
  readonly changedColumns: readonly number[];
}

export type DatabaseSnapshotComparison =
  | {
      readonly kind: "unavailable";
      readonly reason: "scope" | "columns" | "partial" | "masked" | "identity";
    }
  | {
      readonly kind: "compared";
      readonly changed: boolean;
      readonly added: number;
      readonly missing: number;
      readonly updated: number;
      readonly changes: readonly DatabaseSnapshotChange[];
      readonly truncated: boolean;
    };

const ROW_KEY = /^[a-f0-9]{64}$/;

function validColumns(columns: readonly string[]): boolean {
  return (
    Array.isArray(columns) &&
    columns.length > 0 &&
    columns.length <= WORKSPACE_DATABASE_LIMITS.columns &&
    new Set(columns).size === columns.length &&
    Array.from(columns).every((column) => typeof column === "string" && column.length <= 512)
  );
}

function validIdentity(snapshot: WorkspaceObservatoryRowsResult): boolean {
  const { identityColumns, rowKeys, rows, columns } = snapshot;
  if (
    !Array.isArray(identityColumns) ||
    identityColumns.length === 0 ||
    identityColumns.length > columns.length ||
    !Array.from(identityColumns).every(
      (index) => Number.isInteger(index) && index >= 0 && index < columns.length,
    ) ||
    new Set(identityColumns).size !== identityColumns.length ||
    !Array.isArray(rows) ||
    rows.length > WORKSPACE_DATABASE_LIMITS.rows ||
    !Array.isArray(rowKeys) ||
    rowKeys.length !== rows.length ||
    !Array.from(rowKeys).every(
      (key) => typeof key === "string" && key.length === 64 && ROW_KEY.test(key),
    ) ||
    new Set(rowKeys).size !== rowKeys.length
  ) {
    return false;
  }
  return Array.from(rows).every(
    (row) =>
      Array.isArray(row) &&
      row.length === columns.length &&
      Array.from(row).every(
        (cell) =>
          typeof cell === "string" && cell.length <= WORKSPACE_DATABASE_LIMITS.cellCharacters,
      ),
  );
}

/**
 * Compares bounded complete previews by the server's exact typed key hashes.
 * These are snapshot differences, not evidence of database inserts/deletions
 * or SQL collation equivalence. The caller must also pin project and connection.
 */
export function compareDatabaseSnapshots(
  before: WorkspaceObservatoryRowsResult,
  after: WorkspaceObservatoryRowsResult,
): DatabaseSnapshotComparison {
  if (before.relativePath !== after.relativePath || before.table !== after.table) {
    return { kind: "unavailable", reason: "scope" };
  }
  if (
    !validColumns(before.columns) ||
    !validColumns(after.columns) ||
    before.columns.length !== after.columns.length ||
    before.columns.some((column, index) => column !== after.columns[index])
  ) {
    return { kind: "unavailable", reason: "columns" };
  }
  if (before.truncated !== false || after.truncated !== false) {
    return { kind: "unavailable", reason: "partial" };
  }
  if (before.redacted !== false || after.redacted !== false) {
    return { kind: "unavailable", reason: "masked" };
  }
  if (
    !validIdentity(before) ||
    !validIdentity(after) ||
    before.identityColumns!.length !== after.identityColumns!.length ||
    before.identityColumns!.some((index, position) => index !== after.identityColumns![position])
  ) {
    return { kind: "unavailable", reason: "identity" };
  }

  const oldRows = new Map(before.rowKeys!.map((key, index) => [key, before.rows[index]!]));
  const currentKeys = new Set(after.rowKeys!);
  const changes: DatabaseSnapshotChange[] = [];
  let added = 0;
  let missing = 0;
  let updated = 0;
  const emit = (change: DatabaseSnapshotChange) => {
    if (changes.length < MAX_DATABASE_SNAPSHOT_CHANGES) changes.push(change);
  };
  for (let index = 0; index < after.rows.length; index += 1) {
    const key = after.rowKeys![index]!;
    const next = after.rows[index]!;
    const previous = oldRows.get(key);
    if (previous === undefined) {
      added += 1;
      emit({ kind: "new", key, after: next, changedColumns: [] });
      continue;
    }
    const changedColumns: number[] = [];
    for (let column = 0; column < next.length; column += 1) {
      if (previous[column] !== next[column]) changedColumns.push(column);
    }
    if (changedColumns.length > 0) {
      updated += 1;
      emit({ kind: "changed", key, before: previous, after: next, changedColumns });
    }
  }
  for (const [key, previous] of oldRows) {
    if (currentKeys.has(key)) continue;
    missing += 1;
    emit({ kind: "missing", key, before: previous, changedColumns: [] });
  }
  const total = added + missing + updated;
  return {
    kind: "compared",
    changed: total > 0,
    added,
    missing,
    updated,
    changes,
    truncated: total > changes.length,
  };
}
