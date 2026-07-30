import { EventId, type OrchestrationThreadActivity } from "@cafecode/contracts";
import { describe, expect, it } from "vitest";

import {
  decodeMatrixWorkVocabulary,
  deriveMatrixWorkVocabulary,
  encodeMatrixWorkVocabulary,
} from "./matrixWorkVocabulary";

function activity(
  id: string,
  payload: Record<string, unknown>,
  options: Partial<Pick<OrchestrationThreadActivity, "kind" | "tone">> = {},
): OrchestrationThreadActivity {
  return {
    id: EventId.make(id),
    kind: options.kind ?? "tool.completed",
    tone: options.tone ?? "tool",
    summary: "Summary text must never become a Matrix token",
    payload,
    turnId: null,
    createdAt: `2026-07-23T12:00:${id.padStart(2, "0")}.000Z`,
  };
}

describe("Matrix live work vocabulary", () => {
  it("maps observed operation categories into English and Japanese terms", () => {
    const vocabulary = deriveMatrixWorkVocabulary([
      activity("1", {
        itemType: "command_execution",
        title: "Build and test",
        detail: "corepack yarn typecheck",
        observed: {
          providerObserved: true,
          operation: "build test typecheck",
        },
      }),
      activity("2", {
        itemType: "collab_agent_tool_call",
        data: { item: { agentPath: "/root/auditor", kind: "started" } },
      }),
      activity("3", {
        itemType: "file_change",
        data: { item: { changes: [{ path: "apps/web/src/WindowAtmosphere.tsx" }] } },
      }),
    ]);

    expect(vocabulary.english).toEqual(
      expect.arrayContaining(["BUILD", "TEST", "TYPES", "RUN", "AGENT", "DELEGATE", "WRITE"]),
    );
    expect(vocabulary.japanese).toEqual(
      expect.arrayContaining(["構築", "試験", "型検査", "実行", "エージェント", "分担", "書込"]),
    );
    expect(vocabulary.english).toContain("WindowAtmosphere.tsx");
    expect(vocabulary.japanese).toContain("WindowAtmosphere.tsx");
  });

  it("does not classify free-form provider titles or detail text", () => {
    const vocabulary = deriveMatrixWorkVocabulary([
      activity("6", {
        itemType: "unclassified",
        title: "build audit database",
        detail: "SELECT secret FROM private_url",
        data: {
          arbitraryToolOutput: {
            path: "invented-file.ts",
            agentPath: "/root/auditor",
            kind: "started",
          },
        },
      }),
    ]);

    expect(vocabulary).toEqual({ english: [], japanese: [] });
  });

  it("describes reported query/error/agent state without claiming search, recovery, or delegation", () => {
    const vocabulary = deriveMatrixWorkVocabulary([
      activity("7", {
        observed: {
          providerObserved: true,
          operation: "query",
        },
      }),
      activity(
        "8",
        {
          itemType: "collab_agent_tool_call",
          data: { item: { agentPath: "/root/worker", kind: "interacted" } },
        },
        { tone: "error" },
      ),
    ]);

    expect(vocabulary.english).toEqual(expect.arrayContaining(["DATABASE", "AGENT", "ERROR"]));
    expect(vocabulary.japanese).toEqual(
      expect.arrayContaining(["データベース", "エージェント", "エラー"]),
    );
    expect(vocabulary.english).not.toContain("SEARCH");
    expect(vocabulary.english).not.toContain("RECOVER");
    expect(vocabulary.english).not.toContain("DELEGATE");
    expect(vocabulary.japanese).not.toContain("分担");
  });

  it("never exposes summaries, command text, file contents, or secret-looking filenames", () => {
    const vocabulary = deriveMatrixWorkVocabulary([
      {
        ...activity("4", {
          itemType: "file_change",
          detail: "write hunter2 into production",
          data: {
            item: {
              changes: [
                { path: ".env" },
                { path: "secrets/access_token.json" },
                { path: "private-key.pem" },
                { path: "safe/renderer.ts" },
              ],
              content: "API_KEY=should-never-appear",
              prompt: "private prompt text",
            },
          },
        }),
        summary: "confidential customer name",
      },
    ]);

    const rendered = [...vocabulary.english, ...vocabulary.japanese].join(" ");
    expect(rendered).toContain("renderer.ts");
    expect(rendered).not.toMatch(
      /hunter2|production|access_token|private-key|API_KEY|prompt|confidential|customer/iu,
    );
  });

  it("round-trips a bounded vocabulary and fails closed on malformed state", () => {
    const vocabulary = deriveMatrixWorkVocabulary([
      activity("5", { itemType: "web_search", title: "Search" }),
    ]);

    expect(vocabulary).toMatchObject({
      english: expect.arrayContaining(["SEARCH"]),
      japanese: expect.arrayContaining(["検索"]),
    });
    expect(decodeMatrixWorkVocabulary(encodeMatrixWorkVocabulary(vocabulary))).toEqual(vocabulary);
    expect(decodeMatrixWorkVocabulary("{broken")).toEqual({ english: [], japanese: [] });
  });

  it("never rehydrates an injected secret or opaque identifier into the canvas", () => {
    expect(
      decodeMatrixWorkVocabulary(
        JSON.stringify([
          ["BUILD", "BUILD", "構築", "api_token.json", "abCDefGhIjKlMnOpQrStUvWxYz12"],
          ["構築", "BUILD", "safe-file.ts"],
        ]),
      ),
    ).toEqual({ english: ["BUILD"], japanese: ["構築", "safe-file.ts"] });
  });
});
