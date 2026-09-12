import { describe, expect, it } from "vitest";
import type { WorkspaceObservatoryRowsResult } from "@cafecode/contracts";
import { compareDatabaseSnapshots } from "./workspaceDatabaseComparison";

const key = (value: number) => value.toString(16).padStart(64, "0");
function snapshot(
  patch: Partial<WorkspaceObservatoryRowsResult> = {},
): WorkspaceObservatoryRowsResult {
  return {
    relativePath: " data/example.db",
    table: "items",
    columns: ["id", "value"],
    rows: [
      ["1", "first"],
      ["2", "second"],
    ],
    rowKeys: [key(1), key(2)],
    identityColumns: [0],
    truncated: false,
    redacted: false,
    ...patch,
  };
}

describe("compareDatabaseSnapshots", () => {
  it("refuses duplicate column names instead of labelling an ambiguous comparison", () => {
    const ambiguous = snapshot({ columns: ["id", "id"] });
    expect(compareDatabaseSnapshots(ambiguous, ambiguous)).toEqual({
      kind: "unavailable",
      reason: "columns",
    });
  });
  it("compares by typed keys despite row reordering and reports exact changed columns", () => {
    const before = snapshot();
    const after = snapshot({
      rows: [
        ["2", "edited"],
        ["3", "new"],
      ],
      rowKeys: [key(2), key(3)],
    });
    expect(compareDatabaseSnapshots(before, after)).toEqual({
      kind: "compared",
      changed: true,
      added: 1,
      missing: 1,
      updated: 1,
      truncated: false,
      changes: [
        {
          kind: "changed",
          key: key(2),
          before: ["2", "second"],
          after: ["2", "edited"],
          changedColumns: [1],
        },
        { kind: "new", key: key(3), after: ["3", "new"], changedColumns: [] },
        { kind: "missing", key: key(1), before: ["1", "first"], changedColumns: [] },
      ],
    });
    expect(before.rows).toEqual([
      ["1", "first"],
      ["2", "second"],
    ]);
  });

  it("treats reordered identical rows and valid empty snapshots as unchanged", () => {
    expect(
      compareDatabaseSnapshots(
        snapshot(),
        snapshot({
          rows: [
            ["2", "second"],
            ["1", "first"],
          ],
          rowKeys: [key(2), key(1)],
        }),
      ),
    ).toMatchObject({ kind: "compared", changed: false, changes: [], truncated: false });
    const empty = snapshot({ rows: [], rowKeys: [] });
    expect(compareDatabaseSnapshots(empty, empty)).toMatchObject({
      kind: "compared",
      changed: false,
    });
    expect(compareDatabaseSnapshots(snapshot(), empty)).toMatchObject({
      kind: "compared",
      missing: 2,
    });
  });

  it.each([
    [{ relativePath: "data/example.db" }, "scope"],
    [{ table: "other" }, "scope"],
    [{ columns: ["value", "id"] }, "columns"],
    [{ columns: [] }, "columns"],
    [{ columns: ["id", "x".repeat(513)] }, "columns"],
    [{ truncated: true }, "partial"],
    [{ redacted: true }, "masked"],
    [{ identityColumns: undefined }, "identity"],
    [{ identityColumns: [] }, "identity"],
    [{ identityColumns: [0, 0] }, "identity"],
    [{ identityColumns: [0.5] }, "identity"],
    [{ identityColumns: [-1] }, "identity"],
    [{ identityColumns: [2] }, "identity"],
    [{ identityColumns: [1] }, "identity"],
    [{ rowKeys: undefined }, "identity"],
    [{ rowKeys: [] }, "identity"],
    [{ rowKeys: [key(1), key(1)] }, "identity"],
    [{ rowKeys: [key(1), "A".repeat(64)] }, "identity"],
    [{ rows: [["1"], ["2", "second"]] }, "identity"],
    [
      {
        rows: [
          ["1", "x".repeat(4097)],
          ["2", "second"],
        ],
      },
      "identity",
    ],
  ] as const)("refuses unsafe input on either side: %j", (patch, reason) => {
    const unsafe = snapshot(patch as Partial<WorkspaceObservatoryRowsResult>);
    expect(compareDatabaseSnapshots(snapshot(), unsafe)).toEqual({ kind: "unavailable", reason });
    expect(compareDatabaseSnapshots(unsafe, snapshot())).toEqual({ kind: "unavailable", reason });
  });

  it("requires the same ordered composite-key columns", () => {
    expect(
      compareDatabaseSnapshots(
        snapshot({ identityColumns: [0, 1] }),
        snapshot({ identityColumns: [1, 0] }),
      ),
    ).toEqual({ kind: "unavailable", reason: "identity" });
  });

  it("rejects sparse arrays instead of skipping missing identities or cells", () => {
    for (const patch of [
      { rowKeys: new Array<string>(2) },
      { rows: new Array<readonly string[]>(2) },
      { rows: [new Array<string>(2), ["2", "second"]] },
      { identityColumns: new Array<number>(1) },
    ]) {
      expect(compareDatabaseSnapshots(snapshot(), snapshot(patch))).toEqual({
        kind: "unavailable",
        reason: "identity",
      });
    }
    expect(
      compareDatabaseSnapshots(snapshot(), snapshot({ columns: new Array<string>(2) })),
    ).toEqual({ kind: "unavailable", reason: "columns" });
  });

  it("caps emitted differences while counting both complete bounded snapshots", () => {
    const make = (start: number) =>
      snapshot({
        rows: Array.from({ length: 100 }, (_, index) => [String(start + index), "row"]),
        rowKeys: Array.from({ length: 100 }, (_, index) => key(start + index)),
      });
    const result = compareDatabaseSnapshots(make(0), make(100));
    expect(result).toMatchObject({
      kind: "compared",
      changed: true,
      added: 100,
      missing: 100,
      updated: 0,
      truncated: true,
    });
    if (result.kind !== "compared") throw new Error("expected comparison");
    expect(result.changes).toHaveLength(40);
    expect(result.changes[0]).toMatchObject({ kind: "new", key: key(100) });
    const tooMany = make(0);
    expect(
      compareDatabaseSnapshots(
        tooMany,
        snapshot({
          rows: [...tooMany.rows, ["101", "row"]],
          rowKeys: [...tooMany.rowKeys!, key(101)],
        }),
      ),
    ).toEqual({ kind: "unavailable", reason: "identity" });
  });

  it("does not equate identical displayed keys with distinct typed representations", () => {
    const before = snapshot({ rows: [["1", "same"]], rowKeys: [key(1)] });
    const after = snapshot({ rows: [["1", "same"]], rowKeys: [key(2)] });
    expect(compareDatabaseSnapshots(before, after)).toMatchObject({
      kind: "compared",
      added: 1,
      missing: 1,
      updated: 0,
    });
  });
});
