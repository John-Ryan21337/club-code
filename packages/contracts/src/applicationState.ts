import * as Schema from "effect/Schema";

/** Operational columns only. This namespace never accepts a filesystem path. */
export const ApplicationStateTable = Schema.Literals(["usage_stats_days", "projection_state"]);
export type ApplicationStateTable = typeof ApplicationStateTable.Type;
export const ApplicationStateRowsInput = Schema.Struct({
  table: ApplicationStateTable,
  limit: Schema.optionalKey(
    Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 100 })),
  ),
});
export type ApplicationStateRowsInput = typeof ApplicationStateRowsInput.Type;
export const ApplicationStateTablesResult = Schema.Struct({
  database: Schema.Literal("cafe-code-state"),
  tables: Schema.Array(Schema.Struct({ name: ApplicationStateTable })).check(Schema.isMaxLength(2)),
});
export type ApplicationStateTablesResult = typeof ApplicationStateTablesResult.Type;
export const ApplicationStateRowsResult = Schema.Struct({
  database: Schema.Literal("cafe-code-state"),
  table: ApplicationStateTable,
  columns: Schema.Array(Schema.String.check(Schema.isMaxLength(128))).check(Schema.isMaxLength(12)),
  rows: Schema.Array(
    Schema.Array(Schema.String.check(Schema.isMaxLength(128))).check(Schema.isMaxLength(12)),
  ).check(Schema.isMaxLength(100)),
  truncated: Schema.Boolean,
});
export type ApplicationStateRowsResult = typeof ApplicationStateRowsResult.Type;
export class ApplicationStateError extends Schema.TaggedErrorClass<ApplicationStateError>()(
  "ApplicationStateError",
  {
    message: Schema.Literal("The operational state preview is unavailable."),
  },
) {}
