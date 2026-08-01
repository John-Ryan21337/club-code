import {
  CollaborationAuthoredMessageId,
  CollaborationContextPacketId,
  CollaborationMembershipEpoch,
  CollaborationSha256,
  DeviceId,
  SharedProjectId,
  UserId,
  type CollaborationAuthoredMessage,
  type CollaborationAuthoredMessagePage,
  type CollaborationContextPacket,
} from "@cafecode/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vitest";

import {
  appendConfirmedSharedOperatorMessage,
  EMPTY_SHARED_OPERATOR_TIMELINE,
  mergeSharedOperatorMessagePage,
  safeCollaborationFailureCode,
  visibleSharedOperatorContextPackets,
} from "./SharedOperatorChatPanel.model.ts";

const projectA = SharedProjectId.make("shared-project-a");
const projectB = SharedProjectId.make("shared-project-b");
const author = UserId.make("operator-a");

function message(sequence: number, projectId = projectA): CollaborationAuthoredMessage {
  return {
    sharedProjectId: projectId,
    projectSequence: sequence,
    operatorSequence: sequence,
    messageId: CollaborationAuthoredMessageId.make(`message-${sequence}`),
    kind: sequence % 2 === 0 ? "authored-prompt" : "operator-chat",
    body: `visible authored text ${sequence}`,
    contextInclusion: "eligible",
    authorUserId: author,
    authorDeviceId: DeviceId.make("device-a"),
    membershipEpoch: CollaborationMembershipEpoch.make(1),
    previousMessageSha256: sequence === 1 ? null : CollaborationSha256.make("a".repeat(64)),
    messageSha256: CollaborationSha256.make("b".repeat(64)),
    occurredAt: DateTime.makeUnsafe(`2026-08-01T12:00:0${sequence}.000Z`),
    receivedAt: DateTime.makeUnsafe(`2026-08-01T12:00:0${sequence}.100Z`),
    tombstone: null,
  };
}

function page(messages: readonly CollaborationAuthoredMessage[]): CollaborationAuthoredMessagePage {
  return {
    sharedProjectId: projectA,
    messages,
    mergedOrder: messages.map((entry) => entry.messageId),
    lanePositions: messages.map((entry) => ({
      messageId: entry.messageId,
      userId: entry.authorUserId,
      projectSequence: entry.projectSequence,
      operatorSequence: entry.operatorSequence,
    })),
    nextCursor: Math.max(0, ...messages.map((entry) => entry.projectSequence)),
    hasMore: false,
  };
}

describe("SharedOperatorChatPanel model", () => {
  it("uses project sequence ordering and deduplicates confirmed messages", () => {
    const first = mergeSharedOperatorMessagePage({
      state: EMPTY_SHARED_OPERATOR_TIMELINE,
      page: page([message(2), message(1)]),
      projectId: projectA,
      requestedAfterSequence: 0,
    });
    expect(first.messages.map((entry) => entry.projectSequence)).toEqual([1, 2]);

    const confirmed = appendConfirmedSharedOperatorMessage({
      state: first,
      message: message(2),
      expectedMessageId: message(2).messageId,
      projectId: projectA,
    });
    expect(confirmed?.messages).toHaveLength(2);
    expect(confirmed?.nextCursor).toBe(first.nextCursor);
  });

  it("ignores stale, malformed, and cross-project pages without moving the cursor", () => {
    const current = { ...EMPTY_SHARED_OPERATOR_TIMELINE, nextCursor: 2, messages: [message(2)] };
    const stale = mergeSharedOperatorMessagePage({
      state: current,
      page: page([message(1)]),
      projectId: projectA,
      requestedAfterSequence: 0,
    });
    const wrongProject = mergeSharedOperatorMessagePage({
      state: current,
      page: { ...page([message(3, projectB)]), sharedProjectId: projectB },
      projectId: projectA,
      requestedAfterSequence: 2,
    });
    const badOrder = mergeSharedOperatorMessagePage({
      state: current,
      page: { ...page([message(3)]), mergedOrder: [] },
      projectId: projectA,
      requestedAfterSequence: 2,
    });
    const skippedCursor = mergeSharedOperatorMessagePage({
      state: current,
      page: { ...page([message(3)]), nextCursor: 99 },
      projectId: projectA,
      requestedAfterSequence: 2,
    });
    expect(stale).toBe(current);
    expect(wrongProject).toBe(current);
    expect(badOrder).toBe(current);
    expect(skippedCursor).toBe(current);
  });

  it("keeps memory bounded while allowing pagination to advance to the newest window", () => {
    const next = mergeSharedOperatorMessagePage({
      state: EMPTY_SHARED_OPERATOR_TIMELINE,
      page: { ...page([message(1), message(2), message(3), message(4)]), hasMore: true },
      projectId: projectA,
      requestedAfterSequence: 0,
      retainedLimit: 2,
    });
    expect(next.messages.map((entry) => entry.projectSequence)).toEqual([3, 4]);
    expect(next).toMatchObject({ nextCursor: 4, hasMore: true, saturated: true });
  });

  it("rejects cross-project append acknowledgements", () => {
    expect(
      appendConfirmedSharedOperatorMessage({
        state: EMPTY_SHARED_OPERATOR_TIMELINE,
        message: message(1, projectB),
        expectedMessageId: message(1, projectB).messageId,
        projectId: projectA,
      }),
    ).toBeNull();
  });

  it("exposes only project-scoped context packets and sanitizes failure codes", () => {
    const packet = (projectId: typeof projectA, sequence: number): CollaborationContextPacket => ({
      sharedProjectId: projectId,
      packetId: CollaborationContextPacketId.make(`packet-${sequence}`),
      basePacketId: null,
      sources: [],
      excludedSources: [],
      tokenBudget: 1_000,
      estimatedTokens: 250,
      encodedBytes: 500,
      throughSequence: sequence,
      packetSha256: CollaborationSha256.make("c".repeat(64)),
      createdByUserId: author,
      createdByDeviceId: DeviceId.make("device-a"),
      membershipEpoch: CollaborationMembershipEpoch.make(1),
      createdAt: DateTime.makeUnsafe("2026-08-01T12:00:00.000Z"),
    });
    expect(
      visibleSharedOperatorContextPackets([packet(projectB, 9), packet(projectA, 3)], projectA),
    ).toHaveLength(1);
    expect(safeCollaborationFailureCode(new Error("private path M:\\secret"))).toBe("Error");
    expect(safeCollaborationFailureCode("unsafe raw error text")).toBe(
      "CollaborationRequestFailure",
    );
  });
});
