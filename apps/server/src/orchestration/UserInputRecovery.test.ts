import {
  EventId,
  MessageId,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  ThreadId,
  TurnId,
  type OrchestrationMessage,
  type OrchestrationThreadActivity,
} from "@cafecode/contracts";
import { describe, expect, it } from "vitest";

import {
  USER_INPUT_CALLBACK_OWNERSHIP_LOST_KIND,
  USER_INPUT_RECOVERY_ACCEPTED_KIND,
  USER_INPUT_RECOVERY_PENDING_KIND,
  composeStoppedSessionUserInputRecoveryMessage,
  findAcceptedUserInputRecovery,
  findPendingUserInputRecovery,
  findUserInputCallbackOwnershipLoss,
  findUserInputRequestContext,
  hasResolvedUserInputRequest,
  threadCarriesRecoveryContinuationMessage,
  userInputRecoveryIdentity,
  userInputRecoveryMessageId,
} from "./UserInputRecovery.ts";

const createdAt = "2026-07-25T12:00:00.000Z";
const threadId = ThreadId.make("thread-user-input-recovery");
const turnId = TurnId.make("turn-user-input-recovery");

function activity(
  kind: string,
  payload: unknown,
  activityTurnId: TurnId | null = turnId,
): OrchestrationThreadActivity {
  return {
    id: EventId.make(`event-${crypto.randomUUID()}`),
    tone: "info",
    kind,
    summary: "Recovery test activity",
    payload,
    turnId: activityTurnId,
    createdAt,
  };
}

function message(input: {
  readonly id: MessageId;
  readonly role?: OrchestrationMessage["role"];
  readonly text: string;
}): OrchestrationMessage {
  return {
    id: input.id,
    role: input.role ?? "user",
    text: input.text,
    attachments: [],
    turnId,
    streaming: false,
    createdAt,
    updatedAt: createdAt,
  };
}

describe("stopped structured-input recovery policy", () => {
  it("derives bounded deterministic identities without copying provider ids", () => {
    const veryLongRequestId = `provider-secret-${"x".repeat(10_000)}`;
    const identity = userInputRecoveryIdentity(threadId, veryLongRequestId);
    const recoveryMessageId = userInputRecoveryMessageId(threadId, veryLongRequestId);

    expect(identity).toMatch(/^[a-f0-9]{64}$/u);
    expect(userInputRecoveryIdentity(threadId, veryLongRequestId)).toBe(identity);
    expect(userInputRecoveryIdentity(ThreadId.make("other-thread"), veryLongRequestId)).not.toBe(
      identity,
    );
    expect(recoveryMessageId).toBe(`user-input-recovery:${identity}`);
    expect(recoveryMessageId).not.toContain("provider-secret");
    expect(String(recoveryMessageId).length).toBeLessThan(100);
  });

  it("finds the newest exact request context and ignores malformed questions", () => {
    const activities = [
      activity("user-input.requested", {
        requestId: "request-1",
        questions: [{ id: "target", question: "Old question?" }],
      }),
      activity("user-input.requested", {
        requestId: "request-other",
        questions: [{ id: "other" }],
      }),
      activity(
        "user-input.requested",
        {
          requestId: "request-1",
          questions: [null, "not-an-object", { id: "target", question: "Current question?" }],
        },
        null,
      ),
    ];

    expect(findUserInputRequestContext({ activities }, "request-1")).toEqual({
      questions: [{ id: "target", question: "Current question?" }],
      turnId: null,
    });
    expect(findUserInputRequestContext({ activities }, "missing")).toBeUndefined();
  });

  it("recognizes only a typed durable callback-ownership loss marker", () => {
    const activities = [
      activity(USER_INPUT_CALLBACK_OWNERSHIP_LOST_KIND, {
        requestId: "request-1",
        loss: "session-missing",
      }),
      activity(USER_INPUT_CALLBACK_OWNERSHIP_LOST_KIND, {
        requestId: "request-other",
        loss: "callback-missing",
      }),
    ];

    expect(findUserInputCallbackOwnershipLoss({ activities }, "request-1")).toBe("session-missing");
    expect(
      findUserInputCallbackOwnershipLoss(
        {
          activities: [
            ...activities,
            activity(USER_INPUT_CALLBACK_OWNERSHIP_LOST_KIND, {
              requestId: "request-1",
              loss: "transport-outage",
            }),
          ],
        },
        "request-1",
      ),
    ).toBe("session-missing");
    expect(findUserInputCallbackOwnershipLoss({ activities }, "missing")).toBeUndefined();
  });

  it("composes a visible bounded answer using question text instead of opaque keys", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const recovery = composeStoppedSessionUserInputRecoveryMessage({
      answers: {
        target: "enterprise account executive",
        years: 8,
        remote: true,
        preferences: { travel: "limited" },
        cyclic,
        omitted: undefined,
      },
      questions: [
        {
          id: "target",
          header: "Role",
          question: "Which position should the search target?",
        },
      ],
    });

    expect(recovery).toContain(
      "- Which position should the search target?: enterprise account executive",
    );
    expect(recovery).toContain("- years: 8");
    expect(recovery).toContain("- remote: true");
    expect(recovery).toContain('- preferences: {"travel":"limited"}');
    expect(recovery).toContain("- cyclic: [answer could not be represented as text]");
    expect(recovery).toContain("- omitted: [no answer supplied]");
    expect(recovery?.length).toBeLessThanOrEqual(PROVIDER_SEND_TURN_MAX_INPUT_CHARS);
  });

  it("handles empty answers, truncates provider labels, and rejects oversized turns", () => {
    const empty = composeStoppedSessionUserInputRecoveryMessage({
      answers: {},
      questions: [],
    });
    expect(empty).toContain("without a non-empty answer");

    const truncated = composeStoppedSessionUserInputRecoveryMessage({
      answers: { target: "answer" },
      questions: [{ id: "target", question: "q".repeat(2_000) }],
    });
    expect(truncated).toContain("… [question truncated]: answer");
    expect(truncated).not.toContain("q".repeat(513));

    expect(
      composeStoppedSessionUserInputRecoveryMessage({
        answers: { target: "x".repeat(PROVIDER_SEND_TURN_MAX_INPUT_CHARS) },
        questions: [],
      }),
    ).toBeUndefined();
  });

  it("keeps a pending answer open until an exact accepted recovery message exists", () => {
    const requestId = "request-pending";
    const recoveryMessageId = userInputRecoveryMessageId(threadId, requestId);
    const recoveryMessageText = composeStoppedSessionUserInputRecoveryMessage({
      answers: { target: "enterprise account executive" },
      questions: [{ id: "target", question: "Target role?" }],
    })!;
    const pendingActivity = activity(USER_INPUT_RECOVERY_PENDING_KIND, {
      requestId,
      answers: { target: "enterprise account executive" },
      recoveryMessageId,
      recoveryMessageText,
    });

    const pending = findPendingUserInputRecovery(
      { activities: [pendingActivity], messages: [] },
      recoveryMessageId,
    );
    expect(pending).toMatchObject({
      requestId,
      recoveryMessageId,
      recoveryMessageText,
      requestTurnId: turnId,
    });
    expect(
      threadCarriesRecoveryContinuationMessage(
        { messages: [message({ id: recoveryMessageId, text: "forged replacement" })] },
        pending!,
      ),
    ).toBe(false);
    expect(
      threadCarriesRecoveryContinuationMessage(
        {
          messages: [
            message({
              id: recoveryMessageId,
              role: "assistant",
              text: recoveryMessageText,
            }),
          ],
        },
        pending!,
      ),
    ).toBe(false);
    expect(
      threadCarriesRecoveryContinuationMessage(
        { messages: [message({ id: recoveryMessageId, text: recoveryMessageText })] },
        pending!,
      ),
    ).toBe(true);
  });

  it("recognizes durable provider acceptance only for the exact pending request and message", () => {
    const requestId = "request-accepted";
    const recoveryMessageId = userInputRecoveryMessageId(threadId, requestId);
    const pending = {
      requestId,
      answers: { target: "engineering" },
      recoveryMessageId,
      recoveryMessageText: "durable continuation",
      requestTurnId: turnId,
    };
    const acceptedAt = "2026-07-25T12:01:00.000Z";
    const activities = [
      activity(USER_INPUT_RECOVERY_ACCEPTED_KIND, {
        requestId: "other-request",
        recoveryMessageId,
        acceptedAt,
      }),
      activity(USER_INPUT_RECOVERY_ACCEPTED_KIND, {
        requestId,
        recoveryMessageId: MessageId.make("user-input-recovery:other"),
        acceptedAt,
      }),
      activity(USER_INPUT_RECOVERY_ACCEPTED_KIND, {
        requestId,
        recoveryMessageId,
        acceptedAt,
      }),
    ];

    expect(findAcceptedUserInputRecovery({ activities }, pending)).toEqual({
      requestId,
      recoveryMessageId,
      acceptedAt,
    });
    expect(
      findAcceptedUserInputRecovery(
        {
          activities: [
            activity(USER_INPUT_RECOVERY_ACCEPTED_KIND, {
              requestId,
              recoveryMessageId,
              acceptedAt: null,
            }),
          ],
        },
        pending,
      ),
    ).toBeUndefined();
  });

  it("refuses malformed, oversized, or already-resolved pending records", () => {
    const requestId = "request-resolved";
    const recoveryMessageId = userInputRecoveryMessageId(threadId, requestId);
    const pendingPayload = {
      requestId,
      answers: { target: "engineering" },
      recoveryMessageId,
      recoveryMessageText: "durable continuation",
    };

    expect(
      findPendingUserInputRecovery(
        {
          activities: [
            activity(USER_INPUT_RECOVERY_PENDING_KIND, {
              ...pendingPayload,
              answers: "not-an-object",
            }),
          ],
          messages: [],
        },
        recoveryMessageId,
      ),
    ).toBeUndefined();
    expect(
      findPendingUserInputRecovery(
        {
          activities: [
            activity(USER_INPUT_RECOVERY_PENDING_KIND, {
              ...pendingPayload,
              recoveryMessageText: "x".repeat(PROVIDER_SEND_TURN_MAX_INPUT_CHARS + 1),
            }),
          ],
          messages: [],
        },
        recoveryMessageId,
      ),
    ).toBeUndefined();

    const resolvedActivities = [
      activity(USER_INPUT_RECOVERY_PENDING_KIND, pendingPayload),
      activity("user-input.resolved", { requestId }),
    ];
    expect(hasResolvedUserInputRequest({ activities: resolvedActivities }, requestId)).toBe(true);
    expect(
      findPendingUserInputRecovery(
        { activities: resolvedActivities, messages: [] },
        recoveryMessageId,
      ),
    ).toBeUndefined();
  });
});
