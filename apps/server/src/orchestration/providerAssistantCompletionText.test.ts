import { describe, expect, it } from "vitest";
import {
  EventId,
  ProviderDriverKind,
  RuntimeItemId,
  ThreadId,
  TurnId,
  type ProviderRuntimeEvent,
} from "@cafecode/contracts";

import {
  completedAssistantTextDelta,
  isAuthoritativeCodexAssistantCompletion,
  prefixSafeAssistantRepairSuffix,
} from "./providerAssistantCompletionText.ts";

describe("native Codex completion recovery", () => {
  const native = {
    threadId: "native-thread",
    turnId: "turn-1",
    item: { type: "agentMessage", id: "item-1", text: "The complete answer.\r\n" },
  };
  const valid = {
    type: "item.completed",
    eventId: EventId.make("event-1"),
    provider: ProviderDriverKind.make("codex"),
    createdAt: "2026-01-01T00:00:00.000Z",
    threadId: ThreadId.make("thread-1"),
    turnId: TurnId.make("turn-1"),
    itemId: RuntimeItemId.make("item-1"),
    payload: {
      itemType: "assistant_message",
      status: "completed",
      detail: native.item.text,
      data: native,
    },
    raw: { source: "codex.app-server.notification", method: "item/completed", payload: native },
  } satisfies ProviderRuntimeEvent;

  it("accepts intact native completion text including its source whitespace", () => {
    expect(isAuthoritativeCodexAssistantCompletion(valid, "assistant:item-1")).toBe(true);
  });

  it("rejects another item or a split message segment", () => {
    expect(isAuthoritativeCodexAssistantCompletion(valid, "assistant:item-2")).toBe(false);
    expect(isAuthoritativeCodexAssistantCompletion(valid, "assistant:item-1:segment:1")).toBe(
      false,
    );
  });

  it("rejects missing native evidence and changed mapped text", () => {
    expect(
      isAuthoritativeCodexAssistantCompletion({ ...valid, raw: undefined }, "assistant:item-1"),
    ).toBe(false);
    expect(
      isAuthoritativeCodexAssistantCompletion(
        { ...valid, payload: { ...valid.payload, detail: "Changed text" } },
        "assistant:item-1",
      ),
    ).toBe(false);
  });

  it.each([
    { ...native, threadId: "another-thread" },
    { ...native, turnId: "another-turn" },
    { ...native, item: { ...native.item, id: "another-item" } },
    { ...native, item: { ...native.item, text: "Changed text" } },
  ])("rejects inconsistent native identity or text: %j", (payload) => {
    expect(
      isAuthoritativeCodexAssistantCompletion(
        { ...valid, raw: { ...valid.raw, payload } },
        "assistant:item-1",
      ),
    ).toBe(false);
  });

  it("rejects compacted events even when the retained fields match", () => {
    expect(
      isAuthoritativeCodexAssistantCompletion(
        {
          ...valid,
          compaction: {
            version: 1,
            originalEncodedBytes: 200,
            compactedEncodedBytes: 100,
            sha256: "digest",
            truncatedStrings: 1,
            omittedArrayItems: 0,
            omittedObjectKeys: 0,
            depthOmissions: 0,
          },
        },
        "assistant:item-1",
      ),
    ).toBe(false);
  });
});

describe("provider assistant completion text helpers", () => {
  it("appends the missing suffix when projected text is a provider-completion prefix", () => {
    expect(
      prefixSafeAssistantRepairSuffix({
        projectedText: "visible prefix",
        completionText: "visible prefix plus recovered suffix",
      }),
    ).toEqual({
      type: "append",
      suffix: " plus recovered suffix",
    });
  });

  it("reports unchanged when the projected text already matches retained provider output", () => {
    expect(
      prefixSafeAssistantRepairSuffix({
        projectedText: "complete answer",
        completionText: "complete answer",
      }),
    ).toEqual({ type: "unchanged" });
  });

  it("rejects divergent provider output without producing a suffix", () => {
    expect(
      prefixSafeAssistantRepairSuffix({
        projectedText: "current visible answer",
        completionText: "different provider answer",
      }),
    ).toEqual({ type: "diverged" });
  });

  it("keeps forward ingestion append-only when a buffered tail precedes completion detail", () => {
    expect(
      completedAssistantTextDelta({
        projectedText: "hello",
        bufferedText: " world",
        fallbackText: "hello world from item.completed",
      }),
    ).toBe(" world from item.completed");
  });

  it("does not duplicate streamed text when the durable projection still has only the first chunk", () => {
    const completedText = "First streamed paragraph. A second sentence follows.";

    expect(
      completedAssistantTextDelta({
        projectedText: "First",
        bufferedText: "",
        fallbackText: completedText,
        streamObserved: true,
      }),
    ).toBe("");
  });
});
