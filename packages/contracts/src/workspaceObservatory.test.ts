import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  WORKSPACE_OBSERVATORY_LIMITS,
  WorkspaceObservatoryActivityResult,
  WorkspaceObservatoryFileResult,
  WorkspaceObservatoryRowsResult,
  WorkspaceObservatoryTreeResult,
} from "./workspaceObservatory.js";

const decodeTree = Schema.decodeUnknownSync(WorkspaceObservatoryTreeResult);
const decodeFile = Schema.decodeUnknownSync(WorkspaceObservatoryFileResult);
const decodeRows = Schema.decodeUnknownSync(WorkspaceObservatoryRowsResult);
const decodeActivity = Schema.decodeUnknownSync(WorkspaceObservatoryActivityResult);

describe("workspace observatory contracts", () => {
  it("keeps additive redaction flags backwards compatible", () => {
    expect(decodeTree({ relativePath: "", entries: [], truncated: false })).not.toHaveProperty(
      "redacted",
    );
    expect(
      decodeFile({
        relativePath: "src/app.ts",
        content: "export {};",
        truncated: false,
        redacted: true,
      }),
    ).toMatchObject({ redacted: true });
    expect(
      decodeRows({
        columns: ["id", "value"],
        identityColumns: [0],
        rows: [["1", "visible"]],
        truncated: false,
        redacted: false,
      }),
    ).toMatchObject({ identityColumns: [0] });
  });

  it("rejects oversized tree, row, and activity payloads", () => {
    const entry = { name: "file.ts", relativePath: "file.ts", kind: "file" as const };
    expect(() =>
      decodeTree({
        relativePath: "",
        entries: Array.from({ length: WORKSPACE_OBSERVATORY_LIMITS.treeEntries + 1 }, () => entry),
        truncated: true,
      }),
    ).toThrow();
    expect(() =>
      decodeRows({
        columns: ["value"],
        rows: Array.from({ length: WORKSPACE_OBSERVATORY_LIMITS.databaseRows + 1 }, () => [
          "value",
        ]),
        truncated: true,
        redacted: false,
      }),
    ).toThrow();
    expect(() =>
      decodeRows({
        columns: ["value"],
        identityColumns: [WORKSPACE_OBSERVATORY_LIMITS.databaseColumns],
        rows: [],
        truncated: false,
        redacted: false,
      }),
    ).toThrow();
    const observation = {
      agentId: "agent-1",
      threadId: "thread-1",
      operation: "read",
      path: "src/app.ts",
      status: "running",
      timestamp: "2026-01-01T00:00:00.000Z",
      attribution: "observed" as const,
    };
    expect(() =>
      decodeActivity({
        observations: Array.from(
          { length: WORKSPACE_OBSERVATORY_LIMITS.observations + 1 },
          () => observation,
        ),
      }),
    ).toThrow();
  });
});
