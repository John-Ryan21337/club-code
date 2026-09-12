import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import { ApplicationStateRowsInput, ApplicationStateRowsResult } from "./applicationState.ts";

const decodeInput = Schema.decodeUnknownSync(ApplicationStateRowsInput);
const decodeRows = Schema.decodeUnknownSync(ApplicationStateRowsResult);
describe("operational application-state contracts", () => {
  it("accepts only installed operational table identities and bounded limits", () => {
    expect(decodeInput({ table: "usage_stats_days", limit: 25 })).toEqual({
      table: "usage_stats_days",
      limit: 25,
    });
    for (const table of ["auth_sessions", "projection_thread_messages", "../state.sqlite"])
      expect(() => decodeInput({ table })).toThrow();
    for (const limit of [0, 101, 1.5])
      expect(() => decodeInput({ table: "projection_state", limit })).toThrow();
  });
  it("rejects unrelated database identities and oversized cells", () => {
    const result = {
      database: "cafe-code-state",
      table: "projection_state",
      columns: ["projector"],
      rows: [["projection.projects"]],
      truncated: false,
    };
    expect(decodeRows(result)).toEqual(result);
    expect(() => decodeRows({ ...result, database: "/private/state.sqlite" })).toThrow();
    expect(() => decodeRows({ ...result, rows: [["x".repeat(129)]] })).toThrow();
  });
});
