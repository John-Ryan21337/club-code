import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";

import {
  COLLABORATION_AUTHORED_MESSAGE_MAX_CHARS,
  COLLABORATION_CONTEXT_SOURCE_MAX_COUNT,
  CollaborationAppendAuthoredMessageRequest,
  CollaborationCreateContextPacketRequest,
} from "./collaborationChat.ts";

const decodeAppend = Schema.decodeUnknownSync(CollaborationAppendAuthoredMessageRequest);
const decodePacket = Schema.decodeUnknownSync(CollaborationCreateContextPacketRequest);

describe("collaboration authored-message contracts", () => {
  it("accepts only explicit shared operator chat or authored prompts", () => {
    const base = {
      commandId: "command-1",
      sharedProjectId: "project-1",
      messageId: "message-1",
      body: "Operator-authored shared text",
      contextInclusion: "eligible",
      occurredAt: "2026-08-01T12:00:00.000Z",
    };
    expect(() => decodeAppend({ ...base, kind: "operator-chat" })).not.toThrow();
    expect(() => decodeAppend({ ...base, kind: "authored-prompt" })).not.toThrow();
    expect(() => decodeAppend({ ...base, kind: "private-message" })).toThrow();
    expect(() => decodeAppend({ ...base, kind: "system" })).toThrow();
    expect(() => decodeAppend({ ...base, kind: "provider-output" })).toThrow();
  });

  it("bounds authored message text by characters and UTF-8 bytes", () => {
    const base = {
      commandId: "command-1",
      sharedProjectId: "project-1",
      messageId: "message-1",
      kind: "operator-chat",
      contextInclusion: "eligible",
      occurredAt: "2026-08-01T12:00:00.000Z",
    };
    expect(() =>
      decodeAppend({ ...base, body: "x".repeat(COLLABORATION_AUTHORED_MESSAGE_MAX_CHARS) }),
    ).not.toThrow();
    expect(() =>
      decodeAppend({ ...base, body: "x".repeat(COLLABORATION_AUTHORED_MESSAGE_MAX_CHARS + 1) }),
    ).toThrow();
    expect(() => decodeAppend({ ...base, body: "😀".repeat(20_000) })).toThrow();
  });

  it("requires explicit, unique, bounded context source pointers", () => {
    const base = {
      commandId: "packet-command-1",
      sharedProjectId: "project-1",
      packetId: "packet-1",
      basePacketId: null,
      sourceKinds: ["operator-chat"],
      tokenBudget: 1_000,
      encodedByteBudget: 4_000,
    };
    expect(() =>
      decodePacket({
        ...base,
        selection: { messageIds: ["message-1"], sourceKinds: base.sourceKinds },
      }),
    ).not.toThrow();
    expect(() =>
      decodePacket({
        ...base,
        selection: {
          messageIds: ["message-1", "message-1"],
          sourceKinds: base.sourceKinds,
        },
      }),
    ).toThrow();
    expect(() =>
      decodePacket({
        ...base,
        selection: {
          messageIds: Array.from(
            { length: COLLABORATION_CONTEXT_SOURCE_MAX_COUNT + 1 },
            (_, index) => `message-${index}`,
          ),
          sourceKinds: base.sourceKinds,
        },
      }),
    ).toThrow();
  });
});
