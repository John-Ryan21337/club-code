import type { WorkspaceObservatoryRowsResult } from "@cafecode/contracts";
import { describe, expect, it } from "vitest";

import {
  WORKSPACE_OBSERVATORY_DIFF_LIMIT,
  diffFileLines,
  diffRows,
  isObservationRelevantToDirectory,
  stableAgentColorIndex,
} from "./workspaceObservatoryDiff";

function rows(values: string[][], identityColumns?: number[]): WorkspaceObservatoryRowsResult {
  return {
    columns: ["id", "value"],
    ...(identityColumns ? { identityColumns } : {}),
    rows: values,
    truncated: false,
    redacted: false,
  };
}

describe("workspace observatory snapshot diffs", () => {
  it("shows bounded line changes without retaining history", () => {
    expect(diffFileLines("one\ntwo\nthree", "one\nrevised\nthree")).toEqual({
      changed: true,
      changes: [{ kind: "changed", line: 2, before: "two", after: "revised" }],
      truncated: false,
    });
    const large = diffFileLines(
      "",
      Array.from({ length: WORKSPACE_OBSERVATORY_DIFF_LIMIT + 20 }, (_, index) => `${index}`).join(
        "\n",
      ),
    );
    expect(large.changes).toHaveLength(WORKSPACE_OBSERVATORY_DIFF_LIMIT);
    expect(large.truncated).toBe(true);
  });

  it("uses unique declared identities for added, removed, and changed rows", () => {
    const result = diffRows(
      rows(
        [
          ["1", "before"],
          ["2", "removed"],
        ],
        [0],
      ),
      rows(
        [
          ["1", "after"],
          ["3", "added"],
        ],
        [0],
      ),
    );
    expect(result.identityProven).toBe(true);
    expect(result.changes.map((change) => change.kind)).toEqual(["changed", "removed", "added"]);
  });

  it("reports only snapshot change when row identity is absent or ambiguous", () => {
    expect(diffRows(rows([["1", "before"]]), rows([["1", "after"]]))).toMatchObject({
      changed: true,
      identityProven: false,
      changes: [],
    });
    expect(
      diffRows(
        rows(
          [
            ["1", "before"],
            ["1", "duplicate"],
          ],
          [0],
        ),
        rows([["1", "after"]], [0]),
      ),
    ).toMatchObject({ changed: true, identityProven: false });
    expect(
      diffRows(rows([["1", "same"]], [0]), {
        ...rows([["1", "same"]], [0]),
        columns: ["id", "renamed"],
      }),
    ).toMatchObject({ changed: true, identityProven: false });
  });

  it("keeps agent colors stable and tree refresh relevance exact", () => {
    expect(stableAgentColorIndex("agent-b", 8)).toBe(stableAgentColorIndex("agent-b", 8));
    expect(isObservationRelevantToDirectory("src/app.ts", "src")).toBe(true);
    expect(isObservationRelevantToDirectory("src/nested/app.ts", "src")).toBe(false);
  });
});
