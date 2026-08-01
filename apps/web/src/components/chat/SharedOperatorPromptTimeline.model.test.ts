import {
  COLLABORATION_EVENT_SEQUENCE_MAX,
  COLLABORATION_MEMBERSHIP_EPOCH_MAX,
  CollaborationAuthoredMessageCommandId,
  CollaborationAuthoredMessageId,
  CollaborationMembershipEpoch,
  CollaborationSha256,
  DeviceId,
  SharedProjectId,
  UserId,
  type CollaborationAuthoredMessage,
  type CollaborationAuthoredMessagePage,
  type CollaborationProjectMember,
} from "@cafecode/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vitest";

import {
  appendSharedOperatorPromptPage,
  decodeSharedOperatorPromptPage,
  EMPTY_SHARED_OPERATOR_PROMPT_TIMELINE,
  SHARED_OPERATOR_PROMPT_MAX_PAGES,
  SHARED_OPERATOR_PROMPT_PAGE_LIMIT,
  snapshotSharedOperatorPromptAuthors,
} from "./SharedOperatorPromptTimeline.model.ts";

const projectA = SharedProjectId.make("shared-project-a");
const projectB = SharedProjectId.make("shared-project-b");
const userA = UserId.make("operator-a");
const userB = UserId.make("operator-b");

function prompt(input: {
  readonly sequence: number;
  readonly operatorSequence?: number;
  readonly projectId?: typeof projectA;
  readonly author?: typeof userA;
  readonly tombstoned?: boolean;
}): CollaborationAuthoredMessage {
  const messageId = CollaborationAuthoredMessageId.make(`prompt-${input.sequence}`);
  return {
    sharedProjectId: input.projectId ?? projectA,
    projectSequence: input.sequence,
    operatorSequence: input.operatorSequence ?? input.sequence,
    messageId,
    kind: "authored-prompt",
    body: `Shared prompt ${input.sequence}`,
    contextInclusion: "eligible",
    authorUserId: input.author ?? userA,
    authorDeviceId: DeviceId.make("device-a"),
    membershipEpoch: CollaborationMembershipEpoch.make(1),
    previousMessageSha256: null,
    messageSha256: CollaborationSha256.make(
      input.sequence.toString(16).padStart(64, "0").slice(-64),
    ),
    occurredAt: DateTime.makeUnsafe(
      `2026-08-01T12:00:${String(input.sequence).padStart(2, "0")}.000Z`,
    ),
    receivedAt: DateTime.makeUnsafe(
      `2026-08-01T12:00:${String(input.sequence).padStart(2, "0")}.100Z`,
    ),
    tombstone: input.tombstoned
      ? {
          commandId: CollaborationAuthoredMessageCommandId.make("remove-command"),
          targetMessageId: messageId,
          actorUserId: userB,
          actorDeviceId: DeviceId.make("device-b"),
          membershipEpoch: CollaborationMembershipEpoch.make(1),
          reason: "Removed by project policy.",
          createdAt: DateTime.makeUnsafe("2026-08-01T12:01:00.000Z"),
          recoverable: true,
        }
      : null,
  };
}

function page(
  messages: readonly CollaborationAuthoredMessage[],
  input: { readonly projectId?: typeof projectA; readonly hasMore?: boolean } = {},
): CollaborationAuthoredMessagePage {
  return {
    sharedProjectId: input.projectId ?? projectA,
    messages,
    mergedOrder: messages.map((message) => message.messageId),
    lanePositions: messages.map((message) => ({
      messageId: message.messageId,
      userId: message.authorUserId,
      projectSequence: message.projectSequence,
      operatorSequence: message.operatorSequence,
    })),
    nextCursor: messages.at(-1)?.projectSequence ?? 0,
    hasMore: input.hasMore ?? false,
  };
}

const participants: readonly CollaborationProjectMember[] = [
  {
    userId: userA,
    displayName: "Aiko",
    role: "owner",
    permissions: ["transcript.read", "transcript.append"],
    joinedAt: "2026-08-01T10:00:00.000Z",
  },
  {
    userId: userB,
    displayName: "Ren",
    role: "operator",
    permissions: ["transcript.read", "transcript.append"],
    joinedAt: "2026-08-01T10:01:00.000Z",
  },
];

describe("SharedOperatorPromptTimeline model", () => {
  it("decodes only canonical prompt pages into frozen minimal snapshots", () => {
    const decoded = decodeSharedOperatorPromptPage(
      page([prompt({ sequence: 1 }), prompt({ sequence: 2, author: userB, tombstoned: true })]),
      projectA,
      0,
    );
    expect(decoded.entries).toEqual([
      expect.objectContaining({ messageId: "prompt-1", body: "Shared prompt 1" }),
      expect.objectContaining({ messageId: "prompt-2", authorUserId: userB, body: null }),
    ]);
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Object.isFrozen(decoded.entries)).toBe(true);
    expect(Object.isFrozen(decoded.entries[0])).toBe(true);
    expect(decoded.entries[0]).not.toHaveProperty("authorDeviceId");
    expect(decoded.entries[0]).not.toHaveProperty("membershipEpoch");
  });

  it("rejects non-prompt, cross-project, out-of-order, and inconsistent index payloads", () => {
    expect(() =>
      decodeSharedOperatorPromptPage(
        page([{ ...prompt({ sequence: 1 }), kind: "operator-chat" }]),
        projectA,
        0,
      ),
    ).toThrow(/non-prompt/);
    expect(() =>
      decodeSharedOperatorPromptPage(
        page([prompt({ sequence: 1, projectId: projectB })], { projectId: projectB }),
        projectA,
        0,
      ),
    ).toThrow(/another project/);
    expect(() =>
      decodeSharedOperatorPromptPage(
        page([prompt({ sequence: 2 }), prompt({ sequence: 1 })]),
        projectA,
        0,
      ),
    ).toThrow(/canonical project order/);
    expect(() =>
      decodeSharedOperatorPromptPage(
        { ...page([prompt({ sequence: 1 })]), mergedOrder: [] },
        projectA,
        0,
      ),
    ).toThrow(/indexes/);
  });

  it("rejects excess fields, accessors, subclasses, and sparse arrays before admission", () => {
    expect(() =>
      decodeSharedOperatorPromptPage(
        {
          ...page([prompt({ sequence: 1 })]),
          hiddenProviderOutput: "must not enter state",
        },
        projectA,
        0,
      ),
    ).toThrow(/unsupported shape/);

    const accessor = page([prompt({ sequence: 1 })]) as Record<string, unknown>;
    Object.defineProperty(accessor, "messages", { enumerable: true, get: () => [] });
    expect(() => decodeSharedOperatorPromptPage(accessor, projectA, 0)).toThrow(/data property/);

    const subclassedMessages = new (class extends Array<CollaborationAuthoredMessage> {})();
    subclassedMessages.push(prompt({ sequence: 1 }));
    expect(() =>
      decodeSharedOperatorPromptPage(
        { ...page([prompt({ sequence: 1 })]), messages: subclassedMessages },
        projectA,
        0,
      ),
    ).toThrow(/plain array/);

    const sparse = Array<CollaborationAuthoredMessage>(1);
    expect(() =>
      decodeSharedOperatorPromptPage(
        { ...page([]), messages: sparse, mergedOrder: ["prompt-1"], lanePositions: [{}] },
        projectA,
        0,
      ),
    ).toThrow(/dense/);
  });

  it("binds pages to the requested cursor and rejects replay across pages", () => {
    const firstPage = decodeSharedOperatorPromptPage(
      page([prompt({ sequence: 1 })], { hasMore: true }),
      projectA,
      0,
    );
    const first = appendSharedOperatorPromptPage(
      EMPTY_SHARED_OPERATOR_PROMPT_TIMELINE,
      firstPage,
      0,
    );
    const replay = decodeSharedOperatorPromptPage(
      {
        ...page([prompt({ sequence: 2 })]),
        messages: [{ ...prompt({ sequence: 2 }), messageId: prompt({ sequence: 1 }).messageId }],
        mergedOrder: [prompt({ sequence: 1 }).messageId],
        lanePositions: [
          {
            messageId: prompt({ sequence: 1 }).messageId,
            userId: userA,
            projectSequence: 2,
            operatorSequence: 2,
          },
        ],
      },
      projectA,
      1,
    );
    expect(() => appendSharedOperatorPromptPage(first, replay, 1)).toThrow(
      /identity changed|replays/,
    );
    expect(() => appendSharedOperatorPromptPage(first, firstPage, 0)).toThrow(/cursor/);
  });

  it("enforces monotonic per-operator lanes across filtered prompt pages", () => {
    const first = appendSharedOperatorPromptPage(
      EMPTY_SHARED_OPERATOR_PROMPT_TIMELINE,
      decodeSharedOperatorPromptPage(
        page([prompt({ sequence: 1, operatorSequence: 4 })], { hasMore: true }),
        projectA,
        0,
      ),
      0,
    );
    const regression = decodeSharedOperatorPromptPage(
      page([prompt({ sequence: 2, operatorSequence: 3 })]),
      projectA,
      1,
    );
    expect(() => appendSharedOperatorPromptPage(first, regression, 1)).toThrow(/operator sequence/);
  });

  it("stops after the bounded page window without retaining unbounded prompt text", () => {
    let state = EMPTY_SHARED_OPERATOR_PROMPT_TIMELINE;
    for (let pageIndex = 0; pageIndex < SHARED_OPERATOR_PROMPT_MAX_PAGES; pageIndex += 1) {
      const sequence = pageIndex + 1;
      state = appendSharedOperatorPromptPage(
        state,
        decodeSharedOperatorPromptPage(
          page([prompt({ sequence })], { hasMore: true }),
          projectA,
          state.nextCursor,
        ),
        state.nextCursor,
      );
    }
    expect(state).toMatchObject({
      pageCount: SHARED_OPERATOR_PROMPT_MAX_PAGES,
      hasMore: false,
      truncated: true,
    });
    expect(state.consumedCursors).toHaveLength(SHARED_OPERATOR_PROMPT_MAX_PAGES);
  });

  it("rejects over-limit pages and continuing empty pages", () => {
    const tooMany = Array.from({ length: SHARED_OPERATOR_PROMPT_PAGE_LIMIT + 1 }, (_, index) =>
      prompt({ sequence: index + 1 }),
    );
    expect(() => decodeSharedOperatorPromptPage(page(tooMany), projectA, 0)).toThrow(/bound/);
    expect(() =>
      decodeSharedOperatorPromptPage({ ...page([]), hasMore: true }, projectA, 0),
    ).toThrow(/cannot continue/);
  });

  it("snapshots roster attribution and rejects duplicate or accessor-backed members", () => {
    const authors = snapshotSharedOperatorPromptAuthors(participants);
    expect(authors).toEqual([
      expect.objectContaining({ userId: userA, displayName: "Aiko", canReadTranscript: true }),
      expect.objectContaining({ userId: userB, displayName: "Ren", canReadTranscript: true }),
    ]);
    expect(Object.isFrozen(authors)).toBe(true);

    expect(() => snapshotSharedOperatorPromptAuthors([participants[0]!, participants[0]!])).toThrow(
      /duplicate user/,
    );
    const accessor = { ...participants[0] };
    Object.defineProperty(accessor, "displayName", { enumerable: true, get: () => "Hidden" });
    expect(() => snapshotSharedOperatorPromptAuthors([accessor])).toThrow(/data property/);
  });

  it("snapshots transcript authority and every membership-replacement field", () => {
    const withoutRead = {
      ...participants[1]!,
      permissions: ["chat.read"] as const,
    };
    const first = snapshotSharedOperatorPromptAuthors([withoutRead])[0]!;
    const rejoined = snapshotSharedOperatorPromptAuthors([
      { ...withoutRead, joinedAt: "2026-08-01T11:01:00.000Z" },
    ])[0]!;
    expect(first.canReadTranscript).toBe(false);
    expect(rejoined.membershipFingerprint).not.toBe(first.membershipFingerprint);
  });

  it("rejects attribution control characters and contract-bound integer overflow", () => {
    expect(() =>
      snapshotSharedOperatorPromptAuthors([{ ...participants[0]!, displayName: "Aiko\u202eYou" }]),
    ).toThrow(/displayName/);
    expect(() =>
      decodeSharedOperatorPromptPage(
        page([
          {
            ...prompt({ sequence: 1 }),
            membershipEpoch: COLLABORATION_MEMBERSHIP_EPOCH_MAX + 1,
          },
        ]),
        projectA,
        0,
      ),
    ).toThrow(/membershipEpoch.*bound/);
    const overSequence = {
      ...prompt({ sequence: 1 }),
      projectSequence: COLLABORATION_EVENT_SEQUENCE_MAX + 1,
    };
    expect(() =>
      decodeSharedOperatorPromptPage(
        {
          ...page([overSequence]),
          nextCursor: COLLABORATION_EVENT_SEQUENCE_MAX + 1,
        },
        projectA,
        0,
      ),
    ).toThrow(/projectSequence.*invalid/);
  });

  it("rejects a page whose retained prompt bodies exceed the contract byte budget", () => {
    const messages = Array.from({ length: 17 }, (_, index) => ({
      ...prompt({ sequence: index + 1 }),
      body: "x".repeat(32_768),
    }));
    expect(() => decodeSharedOperatorPromptPage(page(messages), projectA, 0)).toThrow(
      /retained UTF-8 byte bound/,
    );
  });
});
