/**
 * Workspace observatory contracts.
 *
 * The observatory is a strictly read-only projection of the *selected*
 * project's working tree. Callers name a `projectId`; the server resolves the
 * workspace root from its own projection, so a caller can never point the
 * observatory at an arbitrary directory.
 *
 * Redaction of file names and file text is best effort. It reduces accidental
 * shoulder-surfing of obvious credential shapes. It is not a secret-protection
 * boundary, and callers must not treat an un-redacted preview as proof that a
 * file is free of sensitive material.
 *
 * @module workspaceObservatory
 */
import * as Schema from "effect/Schema";

import { ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/** Hard payload limits shared by the server and the browser presentation. */
export const WORKSPACE_OBSERVATORY_LIMITS = {
  /** Maximum directory entries returned for a single tree listing. */
  treeEntries: 500,
  /** Maximum UTF-8 bytes of file text returned for a single preview. */
  textBytes: 128 * 1024,
  /** Maximum characters in a workspace-root-relative path. */
  relativePathLength: 512,
} as const;

const RelativePath = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(WORKSPACE_OBSERVATORY_LIMITS.relativePathLength),
);

export const WorkspaceObservatoryTreeInput = Schema.Struct({
  projectId: ProjectId,
  relativePath: Schema.optionalKey(RelativePath),
});
export type WorkspaceObservatoryTreeInput = typeof WorkspaceObservatoryTreeInput.Type;

export const WorkspaceObservatoryFileInput = Schema.Struct({
  projectId: ProjectId,
  relativePath: RelativePath,
});
export type WorkspaceObservatoryFileInput = typeof WorkspaceObservatoryFileInput.Type;

export const WorkspaceObservatoryTreeEntry = Schema.Struct({
  name: RelativePath,
  relativePath: RelativePath,
  kind: Schema.Literals(["file", "directory"]),
});
export type WorkspaceObservatoryTreeEntry = typeof WorkspaceObservatoryTreeEntry.Type;

export const WorkspaceObservatoryTreeResult = Schema.Struct({
  /** Empty string for the workspace root itself. */
  relativePath: Schema.String.check(
    Schema.isMaxLength(WORKSPACE_OBSERVATORY_LIMITS.relativePathLength),
  ),
  entries: Schema.Array(WorkspaceObservatoryTreeEntry).check(
    Schema.isMaxLength(WORKSPACE_OBSERVATORY_LIMITS.treeEntries),
  ),
  /** Some entries were dropped because a hard limit was reached. */
  truncated: Schema.Boolean,
  /** Some entries were withheld because their names looked sensitive. */
  redacted: Schema.Boolean,
});
export type WorkspaceObservatoryTreeResult = typeof WorkspaceObservatoryTreeResult.Type;

export const WorkspaceObservatoryFileResult = Schema.Struct({
  relativePath: RelativePath,
  content: Schema.String,
  truncated: Schema.Boolean,
  /** Best-effort masking replaced at least one span of the returned text. */
  redacted: Schema.Boolean,
});
export type WorkspaceObservatoryFileResult = typeof WorkspaceObservatoryFileResult.Type;

export const WORKSPACE_DATABASE_LIMITS = {
  tables: 200,
  columns: 40,
  rows: 100,
  cellCharacters: 4096,
  resultBytes: 256 * 1024,
} as const;
const DatabaseTableName = Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(128));
export const WorkspaceObservatoryTablesInput = WorkspaceObservatoryFileInput;
export type WorkspaceObservatoryTablesInput = typeof WorkspaceObservatoryTablesInput.Type;
export const WorkspaceObservatoryRowsInput = Schema.Struct({
  projectId: ProjectId,
  relativePath: RelativePath,
  table: DatabaseTableName,
  limit: Schema.optionalKey(
    Schema.Number.check(
      Schema.isInt(),
      Schema.isBetween({ minimum: 1, maximum: WORKSPACE_DATABASE_LIMITS.rows }),
    ),
  ),
});
export type WorkspaceObservatoryRowsInput = typeof WorkspaceObservatoryRowsInput.Type;
export const WorkspaceObservatoryTablesResult = Schema.Struct({
  relativePath: RelativePath,
  tables: Schema.Array(Schema.Struct({ name: DatabaseTableName })).check(
    Schema.isMaxLength(WORKSPACE_DATABASE_LIMITS.tables),
  ),
  truncated: Schema.Boolean,
});
export type WorkspaceObservatoryTablesResult = typeof WorkspaceObservatoryTablesResult.Type;
export const WorkspaceObservatoryRowsResult = Schema.Struct({
  relativePath: RelativePath,
  table: DatabaseTableName,
  columns: Schema.Array(Schema.String.check(Schema.isMaxLength(512))).check(
    Schema.isMaxLength(WORKSPACE_DATABASE_LIMITS.columns),
  ),
  rows: Schema.Array(
    Schema.Array(
      Schema.String.check(Schema.isMaxLength(WORKSPACE_DATABASE_LIMITS.cellCharacters)),
    ).check(Schema.isMaxLength(WORKSPACE_DATABASE_LIMITS.columns)),
  ).check(Schema.isMaxLength(WORKSPACE_DATABASE_LIMITS.rows)),
  truncated: Schema.Boolean,
  redacted: Schema.Boolean,
  /** Optional for older servers. These describe exact typed key representations,
   * not SQL collation equivalence or a database change log. */
  identityColumns: Schema.optionalKey(
    Schema.Array(
      Schema.Number.check(
        Schema.isInt(),
        Schema.isBetween({ minimum: 0, maximum: WORKSPACE_DATABASE_LIMITS.columns - 1 }),
      ),
    ).check(Schema.isMaxLength(WORKSPACE_DATABASE_LIMITS.columns)),
  ),
  rowKeys: Schema.optionalKey(
    Schema.Array(
      Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/), Schema.isMaxLength(64)),
    ).check(Schema.isMaxLength(WORKSPACE_DATABASE_LIMITS.rows)),
  ),
});
export type WorkspaceObservatoryRowsResult = typeof WorkspaceObservatoryRowsResult.Type;

export class WorkspaceObservatoryError extends Schema.TaggedErrorClass<WorkspaceObservatoryError>()(
  "WorkspaceObservatoryError",
  { message: TrimmedNonEmptyString },
) {}
