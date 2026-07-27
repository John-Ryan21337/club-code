import { describe, expect, it } from "vitest";

import {
  canStartQueuedFollowUpTurn,
  canExpandQueuedFollowUpText,
  collectRetainedFollowUpThreadTargets,
  decideQueuedFollowUpAction,
  decideFollowUpDelivery,
  hasQueuedFollowUpDispatchBeenObserved,
  isLiveSteerAvailableForThread,
  previewQueuedFollowUpText,
  queuedFollowUpActionLabel,
  queuedFollowUpActionTitle,
  readRetryableSteerFailurePayload,
  rekeyQueuedFollowUpsForActiveThread,
  selectQueuedFollowUpDispatchCandidate,
} from "./followUpQueue";

describe("followUpQueue", () => {
  type TestQueuedFollowUp = {
    id: string;
    threadId: string;
    blockedReason: string | null;
    promptText?: string;
  };

  it("sends normally when idle even if steer was requested", () => {
    expect(
      decideFollowUpDelivery({
        phase: "ready",
        requestedSteer: true,
        liveSteerSupported: true,
      }),
    ).toBe("send");
  });

  it("queues normal submit while a turn is running", () => {
    expect(
      decideFollowUpDelivery({
        phase: "running",
        requestedSteer: false,
        liveSteerSupported: true,
      }),
    ).toBe("queue");
  });

  it("steers a running turn only when provider support is explicit", () => {
    expect(
      decideFollowUpDelivery({
        phase: "running",
        requestedSteer: true,
        liveSteerSupported: true,
      }),
    ).toBe("steer");
    expect(
      decideFollowUpDelivery({
        phase: "running",
        requestedSteer: true,
        liveSteerSupported: false,
      }),
    ).toBe("queue");
  });

  it("keeps Codex live steer available while the active turn is running", () => {
    expect(
      isLiveSteerAvailableForThread({
        liveSteerSupported: true,
        provider: "codex",
        activeTurnId: "turn-1",
        latestTurn: { turnId: "turn-1", state: "running" },
      }),
    ).toBe(true);

    expect(
      isLiveSteerAvailableForThread({
        liveSteerSupported: true,
        provider: "codex",
        activeTurnId: "turn-1",
        latestTurn: { turnId: "turn-2", state: "running" },
      }),
    ).toBe(false);

    expect(
      isLiveSteerAvailableForThread({
        liveSteerSupported: true,
        provider: "claudeAgent",
        activeTurnId: "turn-1",
        latestTurn: { turnId: "turn-1", state: "running" },
      }),
    ).toBe(true);

    expect(
      isLiveSteerAvailableForThread({
        liveSteerSupported: false,
        provider: "claudeAgent",
        activeTurnId: "turn-1",
        latestTurn: { turnId: "turn-1", state: "running" },
      }),
    ).toBe(false);

    expect(
      isLiveSteerAvailableForThread({
        liveSteerSupported: true,
        provider: "claudeAgent",
        activeTurnId: null,
        latestTurn: { turnId: "turn-1", state: "running" },
      }),
    ).toBe(false);

    expect(
      isLiveSteerAvailableForThread({
        liveSteerSupported: true,
        provider: "claudeAgent",
        activeTurnId: "turn-1",
        latestTurn: { turnId: "turn-1", state: "completed" },
      }),
    ).toBe(false);
  });

  it("normalizes queue preview text", () => {
    expect(previewQueuedFollowUpText("  fix\n\nthis   next  ")).toBe("fix this next");
    expect(previewQueuedFollowUpText("   ")).toBe("Image-only follow-up");
  });

  it("only expands queued prompts that need a detail view", () => {
    expect(canExpandQueuedFollowUpText("say yes")).toBe(false);
    expect(canExpandQueuedFollowUpText("first line\nsecond line")).toBe(true);
    expect(
      canExpandQueuedFollowUpText(
        "This queued follow-up is intentionally long enough that the collapsed row is likely to truncate it before the user can read the full text.",
      ),
    ).toBe(true);
  });

  it("preserves every retryable steer failure while retaining Codex retry detail", () => {
    expect(
      readRetryableSteerFailurePayload({
        messageId: "message-capability-churn",
        retryableFollowUp: true,
        retryAfter: "active-turn",
      }),
    ).toEqual({
      messageId: "message-capability-churn",
      nonSteerableTurnKind: null,
    });
    expect(
      readRetryableSteerFailurePayload({
        messageId: "message-review",
        retryableFollowUp: true,
        codexNonSteerableTurnKind: "review",
      }),
    ).toEqual({
      messageId: "message-review",
      nonSteerableTurnKind: "review",
    });
    expect(
      readRetryableSteerFailurePayload({
        messageId: "message-fatal",
        retryableFollowUp: false,
      }),
    ).toBeNull();
  });

  it("retains background thread detail while a steer result is still pending", () => {
    expect(
      collectRetainedFollowUpThreadTargets({
        queueGroups: [
          [
            {
              environmentId: "local",
              threadId: "queued-thread",
            },
          ],
        ],
        pendingTurnStarts: [
          {
            environmentId: "local",
            threadId: "queued-thread",
          },
        ],
        pendingSteers: [
          {
            environmentId: "remote",
            threadId: "background-steer-thread",
          },
        ],
      }),
    ).toEqual([
      {
        environmentId: "local",
        threadId: "queued-thread",
      },
      {
        environmentId: "remote",
        threadId: "background-steer-thread",
      },
    ]);
  });

  it("chooses a concrete queued-item action instead of silently no-oping", () => {
    expect(
      decideQueuedFollowUpAction({
        phase: "running",
        liveSteerAvailable: true,
        canDispatchNow: true,
      }),
    ).toBe("steer");
    expect(
      decideQueuedFollowUpAction({
        phase: "ready",
        liveSteerAvailable: true,
        canDispatchNow: true,
      }),
    ).toBe("send");
    expect(
      decideQueuedFollowUpAction({
        phase: "running",
        liveSteerAvailable: false,
        canDispatchNow: true,
      }),
    ).toBe("wait");
    expect(
      decideQueuedFollowUpAction({
        phase: "running",
        liveSteerAvailable: false,
        canDispatchNow: false,
      }),
    ).toBe("wait");
    expect(
      decideQueuedFollowUpAction({
        phase: "ready",
        liveSteerAvailable: true,
        canDispatchNow: false,
      }),
    ).toBe("wait");
  });

  it("changes a queued action from steer to wait when capability availability changes", () => {
    expect(
      decideQueuedFollowUpAction({
        phase: "running",
        liveSteerAvailable: true,
        canDispatchNow: true,
      }),
    ).toBe("steer");
    expect(
      decideQueuedFollowUpAction({
        phase: "running",
        liveSteerAvailable: false,
        canDispatchNow: true,
      }),
    ).toBe("wait");
  });

  it("derives queued item labels from the safe action decision", () => {
    expect(queuedFollowUpActionLabel("steer")).toBe("Steer");
    expect(queuedFollowUpActionLabel("wait")).toBe("Waiting");
    expect(queuedFollowUpActionLabel("send")).toBe("Send");
    expect(queuedFollowUpActionTitle("steer")).toContain("without interrupting");
    expect(queuedFollowUpActionTitle("wait")).toContain("as soon as the active turn can accept it");
  });

  it("starts queued follow-ups from the visible idle state without consulting stale send flags", () => {
    expect(
      canStartQueuedFollowUpTurn({
        queueLength: 1,
        firstItemBlocked: false,
        isWorking: false,
        isConnecting: false,
        isEnvironmentUnavailable: false,
        isDispatchInFlight: false,
      }),
    ).toBe(true);
    expect(
      canStartQueuedFollowUpTurn({
        queueLength: 1,
        firstItemBlocked: false,
        isWorking: true,
        isConnecting: false,
        isEnvironmentUnavailable: false,
        isDispatchInFlight: false,
      }),
    ).toBe(false);
    expect(
      canStartQueuedFollowUpTurn({
        queueLength: 1,
        firstItemBlocked: false,
        isWorking: false,
        isConnecting: false,
        isEnvironmentUnavailable: false,
        isDispatchInFlight: true,
      }),
    ).toBe(false);
  });

  it("selects a dispatchable queued follow-up from a background thread", () => {
    const queues: Record<string, TestQueuedFollowUp[]> = {
      active: [
        {
          id: "blocked-active",
          threadId: "active",
          blockedReason: "still running",
        },
      ],
      background: [
        {
          id: "ready-background",
          threadId: "background",
          blockedReason: null,
        },
      ],
    };

    const candidate = selectQueuedFollowUpDispatchCandidate<string, TestQueuedFollowUp>({
      queuesByThreadId: queues,
      preferredThreadId: "active",
      canStart: ({ item }) => item.blockedReason === null,
    });

    expect(candidate).toEqual({
      threadId: "background",
      item: queues.background?.[0],
      queueLength: 1,
    });
  });

  it("prefers the active thread queue when it can dispatch", () => {
    const queues: Record<string, TestQueuedFollowUp[]> = {
      background: [
        {
          id: "ready-background",
          threadId: "background",
          blockedReason: null,
        },
      ],
      active: [
        {
          id: "ready-active",
          threadId: "active",
          blockedReason: null,
        },
      ],
    };

    const candidate = selectQueuedFollowUpDispatchCandidate<string, TestQueuedFollowUp>({
      queuesByThreadId: queues,
      preferredThreadId: "active",
      canStart: ({ item }) => item.blockedReason === null,
    });

    expect(candidate?.threadId).toBe("active");
    expect(candidate?.item.id).toBe("ready-active");
  });

  it("detects when a queued turn start is reflected by thread state", () => {
    expect(
      hasQueuedFollowUpDispatchBeenObserved({
        messageId: "msg-queued",
        dispatchedAt: "2026-05-25T05:00:00.000Z",
        thread: {
          messages: [{ id: "msg-queued" }],
          latestTurn: null,
          session: null,
        },
      }),
    ).toBe(true);

    expect(
      hasQueuedFollowUpDispatchBeenObserved({
        messageId: "msg-queued",
        dispatchedAt: "2026-05-25T05:00:00.000Z",
        thread: {
          messages: [],
          latestTurn: { requestedAt: "2026-05-25T05:00:00.001Z" },
          session: null,
        },
      }),
    ).toBe(true);

    expect(
      hasQueuedFollowUpDispatchBeenObserved({
        messageId: "msg-queued",
        dispatchedAt: "2026-05-25T05:00:00.000Z",
        thread: {
          messages: [],
          latestTurn: { requestedAt: "2026-05-25T04:59:59.999Z" },
          session: { activeTurnId: null, updatedAt: "2026-05-25T05:00:01.000Z" },
        },
      }),
    ).toBe(false);
  });

  it("rekeys an orphaned draft queue onto the active server thread", () => {
    const queues: Record<string, TestQueuedFollowUp[]> = {
      "draft-thread": [
        {
          id: "queued-1",
          threadId: "draft-thread",
          blockedReason: "stale error",
          promptText: "next",
        },
      ],
    };

    const next = rekeyQueuedFollowUpsForActiveThread<string, TestQueuedFollowUp>({
      queuesByThreadId: queues,
      activeThreadId: "server-thread",
      previousActiveThreadId: "draft-thread",
      knownThreadIds: new Set(["server-thread"]),
    });

    expect(next["draft-thread"]).toBeUndefined();
    expect(next["server-thread"]).toEqual([
      {
        id: "queued-1",
        threadId: "server-thread",
        blockedReason: null,
        promptText: "next",
      },
    ]);
  });

  it("does not steal a queue from another known server thread", () => {
    const queues: Record<string, TestQueuedFollowUp[]> = {
      other: [
        {
          id: "queued-1",
          threadId: "other",
          blockedReason: null,
        },
      ],
    };

    const next = rekeyQueuedFollowUpsForActiveThread<string, TestQueuedFollowUp>({
      queuesByThreadId: queues,
      activeThreadId: "active",
      previousActiveThreadId: null,
      knownThreadIds: new Set(["active", "other"]),
    });

    expect(next).toBe(queues);
  });
});
