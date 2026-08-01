import { describe, expect, it } from "vitest";

import {
  buildSharedOperatorPromptLaneWindow,
  SHARED_OPERATOR_PROMPT_VISIBLE_LANE_LIMIT,
} from "./SharedOperatorPromptLanes.model.ts";
import type {
  SharedOperatorPromptAuthor,
  SharedOperatorPromptEntry,
} from "./SharedOperatorPromptTimeline.model.ts";

function author(index: number): SharedOperatorPromptAuthor {
  return {
    userId: `operator-${index}`,
    displayName: `Operator ${index}`,
    canReadTranscript: true,
    membershipFingerprint: JSON.stringify(["operator", ["transcript.read"], index]),
  };
}

function entry(input: {
  readonly projectSequence: number;
  readonly operatorSequence: number;
  readonly authorIndex?: number;
  readonly authorUserId?: string;
  readonly body?: string | null;
}): SharedOperatorPromptEntry {
  return {
    messageId: `prompt-${input.projectSequence}`,
    authorUserId: input.authorUserId ?? `operator-${input.authorIndex ?? 0}`,
    projectSequence: input.projectSequence,
    operatorSequence: input.operatorSequence,
    body: input.body === undefined ? `Shared prompt ${input.projectSequence}` : input.body,
    occurredAtIso: `2026-08-01T12:00:${String(input.projectSequence).padStart(2, "0")}.000Z`,
    messageSha256: input.projectSequence.toString(16).padStart(64, "0"),
  };
}

describe("shared operator prompt lane presentation", () => {
  it("derives frozen current-roster lanes from the already-admitted merged dataset", () => {
    const result = buildSharedOperatorPromptLaneWindow(
      [
        entry({ projectSequence: 1, operatorSequence: 4, authorIndex: 1 }),
        entry({ projectSequence: 2, operatorSequence: 7, authorIndex: 0 }),
        entry({ projectSequence: 3, operatorSequence: 6, authorIndex: 1, body: null }),
      ],
      [author(0), author(1)],
      0,
    );

    expect(result.lanes.map((lane) => lane.displayName)).toEqual(["Operator 0", "Operator 1"]);
    expect(result.lanes[0]!.entries.map((prompt) => prompt.operatorSequence)).toEqual([7]);
    expect(result.lanes[1]!.entries.map((prompt) => prompt.operatorSequence)).toEqual([4, 6]);
    expect(result.lanes[1]!.entries[1]!.body).toBeNull();
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.lanes)).toBe(true);
    expect(Object.isFrozen(result.lanes[0])).toBe(true);
    expect(Object.isFrozen(result.lanes[0]!.entries)).toBe(true);
    expect(Object.isFrozen(result.lanes[0]!.entries[0])).toBe(true);
  });

  it("renders no more than twenty roster lanes and exposes a bounded window start", () => {
    const authors = Array.from({ length: 24 }, (_, index) => author(index));
    const middle = buildSharedOperatorPromptLaneWindow([], authors, 3);
    expect(middle.lanes).toHaveLength(SHARED_OPERATOR_PROMPT_VISIBLE_LANE_LIMIT);
    expect(middle.lanes[0]!.userId).toBe("operator-3");
    expect(middle.lanes.at(-1)!.userId).toBe("operator-22");
    expect(middle.totalLaneCount).toBe(24);

    const bounded = buildSharedOperatorPromptLaneWindow([], authors, 999);
    expect(bounded.windowStart).toBe(4);
    expect(bounded.lanes).toHaveLength(SHARED_OPERATOR_PROMPT_VISIBLE_LANE_LIMIT);
    expect(bounded.lanes[0]!.userId).toBe("operator-4");
    expect(bounded.lanes.at(-1)!.userId).toBe("operator-23");
  });

  it("does not invent attribution for former operators", () => {
    const result = buildSharedOperatorPromptLaneWindow(
      [entry({ projectSequence: 1, operatorSequence: 1, authorUserId: "former-operator" })],
      [author(0)],
      0,
    );
    expect(result.hiddenFormerOperatorPromptCount).toBe(1);
    expect(result.lanes[0]!.entries).toEqual([]);
  });

  it("rejects presentation regressions, duplicate identity, and excess fields", () => {
    expect(() =>
      buildSharedOperatorPromptLaneWindow(
        [
          entry({ projectSequence: 1, operatorSequence: 2 }),
          entry({ projectSequence: 2, operatorSequence: 1 }),
        ],
        [author(0)],
        0,
      ),
    ).toThrow(/operator sequence/);
    expect(() =>
      buildSharedOperatorPromptLaneWindow(
        [
          entry({ projectSequence: 1, operatorSequence: 1 }),
          { ...entry({ projectSequence: 2, operatorSequence: 2 }), messageId: "prompt-1" },
        ],
        [author(0)],
        0,
      ),
    ).toThrow(/immutable identity/);
    expect(() =>
      buildSharedOperatorPromptLaneWindow(
        [{ ...entry({ projectSequence: 1, operatorSequence: 1 }), hiddenContext: "SECRET" }],
        [author(0)],
        0,
      ),
    ).toThrow(/unsupported shape/);
  });

  it("rejects accessors, sparse arrays, subclasses, and hostile inspection", () => {
    const accessor = entry({ projectSequence: 1, operatorSequence: 1 }) as unknown as Record<
      string,
      unknown
    >;
    Object.defineProperty(accessor, "body", { enumerable: true, get: () => "SECRET" });
    expect(() => buildSharedOperatorPromptLaneWindow([accessor], [author(0)], 0)).toThrow(
      /data property/,
    );

    const sparseAuthors = Array<SharedOperatorPromptAuthor>(1);
    expect(() => buildSharedOperatorPromptLaneWindow([], sparseAuthors, 0)).toThrow(/dense/);

    const subclassedEntries = new (class extends Array<SharedOperatorPromptEntry> {})();
    expect(() => buildSharedOperatorPromptLaneWindow(subclassedEntries, [author(0)], 0)).toThrow(
      /plain array/,
    );

    const hostile = new Proxy(
      {},
      {
        getPrototypeOf: () => {
          throw new Error("SECRET_PROXY_DETAIL");
        },
      },
    );
    expect(() => buildSharedOperatorPromptLaneWindow([hostile], [author(0)], 0)).toThrow(
      /inspected safely/,
    );
  });

  it("rejects unsafe attribution controls and bodies outside the parent admission boundary", () => {
    expect(() =>
      buildSharedOperatorPromptLaneWindow(
        [],
        [{ ...author(0), displayName: "Operator\u202eYou" }],
        0,
      ),
    ).toThrow(/displayName/);
    expect(() =>
      buildSharedOperatorPromptLaneWindow(
        [entry({ projectSequence: 1, operatorSequence: 1, body: "   " })],
        [author(0)],
        0,
      ),
    ).toThrow(/body/);
    expect(() =>
      buildSharedOperatorPromptLaneWindow(
        [entry({ projectSequence: 1, operatorSequence: 1, body: "unsafe\uD800" })],
        [author(0)],
        0,
      ),
    ).toThrow(/body/);
  });
});
