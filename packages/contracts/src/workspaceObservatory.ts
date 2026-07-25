import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/** Hard payload limits shared by the server and the browser presentation. */
export const WORKSPACE_OBSERVATORY_LIMITS = {
  treeEntries: 500,
  databases: 501,
  databaseTables: 200,
  textBytes: 128 * 1024,
  databaseRows: 100,
  databaseColumns: 40,
  databaseCellBytes: 4 * 1024,
  databaseBytes: 128 * 1024,
  observations: 100,
} as const;

const RelativePath = TrimmedNonEmptyString.check(Schema.isMaxLength(512));
const OptionalRelativePath = Schema.optionalKey(RelativePath);

export const WorkspaceObservatoryTreeInput = Schema.Struct({
  cwd: TrimmedNonEmptyString.check(Schema.isMaxLength(1024)),
  relativePath: OptionalRelativePath,
});
export type WorkspaceObservatoryTreeInput = typeof WorkspaceObservatoryTreeInput.Type;

export const WorkspaceObservatoryFileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString.check(Schema.isMaxLength(1024)),
  relativePath: RelativePath,
});
export type WorkspaceObservatoryFileInput = typeof WorkspaceObservatoryFileInput.Type;

export const WorkspaceObservatoryDatabaseRef = Schema.Union([
  Schema.Literal("cafe-code-state"),
  RelativePath,
]);
export type WorkspaceObservatoryDatabaseRef = typeof WorkspaceObservatoryDatabaseRef.Type;

export const WorkspaceObservatoryDatabaseInput = Schema.Struct({
  cwd: TrimmedNonEmptyString.check(Schema.isMaxLength(1024)),
  database: WorkspaceObservatoryDatabaseRef,
});
export type WorkspaceObservatoryDatabaseInput = typeof WorkspaceObservatoryDatabaseInput.Type;

export const WorkspaceObservatoryTableInput = Schema.Struct({
  cwd: TrimmedNonEmptyString.check(Schema.isMaxLength(1024)),
  database: WorkspaceObservatoryDatabaseRef,
  table: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  limit: Schema.optionalKey(
    Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 100 })),
  ),
});
export type WorkspaceObservatoryTableInput = typeof WorkspaceObservatoryTableInput.Type;

export const WorkspaceObservatoryActivityInput = Schema.Struct({
  cwd: TrimmedNonEmptyString.check(Schema.isMaxLength(1024)),
  agentId: Schema.optionalKey(TrimmedNonEmptyString.check(Schema.isMaxLength(128))),
});
export type WorkspaceObservatoryActivityInput = typeof WorkspaceObservatoryActivityInput.Type;

export const WorkspaceObservatoryTreeEntry = Schema.Struct({
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(512)),
  relativePath: TrimmedNonEmptyString,
  kind: Schema.Literals(["file", "directory"]),
});
export type WorkspaceObservatoryTreeEntry = typeof WorkspaceObservatoryTreeEntry.Type;

export const WorkspaceObservatoryTreeResult = Schema.Struct({
  relativePath: Schema.String.check(Schema.isMaxLength(512)),
  entries: Schema.Array(WorkspaceObservatoryTreeEntry).check(
    Schema.isMaxLength(WORKSPACE_OBSERVATORY_LIMITS.treeEntries),
  ),
  truncated: Schema.Boolean,
  redacted: Schema.optionalKey(Schema.Boolean),
});
export type WorkspaceObservatoryTreeResult = typeof WorkspaceObservatoryTreeResult.Type;

export const WorkspaceObservatoryFileResult = Schema.Struct({
  relativePath: RelativePath,
  content: Schema.String.check(Schema.isMaxLength(WORKSPACE_OBSERVATORY_LIMITS.textBytes)),
  truncated: Schema.Boolean,
  redacted: Schema.optionalKey(Schema.Boolean),
});
export type WorkspaceObservatoryFileResult = typeof WorkspaceObservatoryFileResult.Type;

export const WorkspaceObservatoryDatabaseResult = Schema.Struct({
  database: WorkspaceObservatoryDatabaseRef,
  label: TrimmedNonEmptyString.check(Schema.isMaxLength(512)),
});
export type WorkspaceObservatoryDatabaseResult = typeof WorkspaceObservatoryDatabaseResult.Type;

export const WorkspaceObservatoryTableResult = Schema.Struct({
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  type: Schema.Literals(["table", "view"]),
});
export type WorkspaceObservatoryTableResult = typeof WorkspaceObservatoryTableResult.Type;

export const WorkspaceObservatoryRowsResult = Schema.Struct({
  columns: Schema.Array(TrimmedNonEmptyString.check(Schema.isMaxLength(128))).check(
    Schema.isMaxLength(WORKSPACE_OBSERVATORY_LIMITS.databaseColumns),
  ),
  /**
   * Column indexes for a complete declared SQLite primary key. An empty or
   * absent value means row identity is not proven and clients must not invent
   * row-level attribution.
   */
  identityColumns: Schema.optionalKey(
    Schema.Array(
      Schema.Number.check(
        Schema.isInt(),
        Schema.isBetween({
          minimum: 0,
          maximum: WORKSPACE_OBSERVATORY_LIMITS.databaseColumns - 1,
        }),
      ),
    ).check(Schema.isMaxLength(WORKSPACE_OBSERVATORY_LIMITS.databaseColumns)),
  ),
  rows: Schema.Array(
    Schema.Array(
      Schema.String.check(Schema.isMaxLength(WORKSPACE_OBSERVATORY_LIMITS.databaseCellBytes)),
    ).check(Schema.isMaxLength(WORKSPACE_OBSERVATORY_LIMITS.databaseColumns)),
  ).check(Schema.isMaxLength(WORKSPACE_OBSERVATORY_LIMITS.databaseRows)),
  truncated: Schema.Boolean,
  redacted: Schema.Boolean,
});
export type WorkspaceObservatoryRowsResult = typeof WorkspaceObservatoryRowsResult.Type;

export const WorkspaceObservatoryObservation = Schema.Struct({
  agentId: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  threadId: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  operation: TrimmedNonEmptyString.check(Schema.isMaxLength(64)),
  path: RelativePath,
  status: TrimmedNonEmptyString.check(Schema.isMaxLength(64)),
  timestamp: TrimmedNonEmptyString.check(Schema.isMaxLength(64)),
  attribution: Schema.Literals(["observed", "unattributed"]),
});
export type WorkspaceObservatoryObservation = typeof WorkspaceObservatoryObservation.Type;

export const WorkspaceObservatoryActivityResult = Schema.Struct({
  observations: Schema.Array(WorkspaceObservatoryObservation).check(
    Schema.isMaxLength(WORKSPACE_OBSERVATORY_LIMITS.observations),
  ),
});
export type WorkspaceObservatoryActivityResult = typeof WorkspaceObservatoryActivityResult.Type;

export class WorkspaceObservatoryError extends Schema.TaggedErrorClass<WorkspaceObservatoryError>()(
  "WorkspaceObservatoryError",
  { message: TrimmedNonEmptyString },
) {}
