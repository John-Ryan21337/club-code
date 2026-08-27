import { describe, expect, it } from "vitest";

import {
  appendOperatorFollowUp,
  canAutomaticallyActivateQueuedFollowUp,
  canActivateRunningQueuedFollowUp,
  canAutoStartQueuedFollowUpTurn,
  canStartQueuedFollowUpTurn,
  canExpandQueuedFollowUpText,
  collectRetainedFollowUpThreadTargets,
  decideQueuedFollowUpAction,
  decideFollowUpDelivery,
  followUpQueueStateKey,
  hasQueuedFollowUpDispatchBeenObserved,
  isQueuedFollowUpHead,
  isLiveSteerAvailableForThread,
  previewQueuedFollowUpText,
  queuedFollowUpActionLabel,
  queuedFollowUpActionTitle,
  readRetryableSteerFailurePayload,
  rekeyQueuedFollowUpsForActiveThread,
  releaseQueuedFollowUpDispatchClaim,
  selectQueuedFollowUpDispatchCandidate,
  shouldRetainLocalFollowUpShadow,
  shouldQueueOperatorFollowUp,
  tryClaimQueuedFollowUpDispatch,
  visibleQueuedManualFollowUps,
} from "./followUpQueue";

describe("followUpQueue", () => {
  type TestQueuedFollowUp = {
    id: string;
    threadId: string;
    blockedReason: string | null;
    promptText?: string;
  };
  type TestRekeyableFollowUp = TestQueuedFollowUp & {
    environmentId: string;
    serverHandoffTarget: { environmentId: string; threadId: string } | null;
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

  it("keeps the queued item visible during a running turn until Steer is explicit", () => {
    expect(canAutomaticallyActivateQueuedFollowUp("running")).toBe(false);
    expect(canAutomaticallyActivateQueuedFollowUp("ready")).toBe(true);
    expect(
      canAutomaticallyActivateQueuedFollowUp("ready", {
        manualStopBarrierActive: true,
      }),
    ).toBe(false);
    expect(canAutomaticallyActivateQueuedFollowUp("disconnected")).toBe(false);
    expect(canAutomaticallyActivateQueuedFollowUp("connecting")).toBe(false);
  });

  it("removes accepted handoffs from the visible queue while retaining later messages", () => {
    expect(
      visibleQueuedManualFollowUps([
        { id: "sent", status: "handoff" as const },
        { id: "next", status: "queued" as const },
        { id: "saving", status: "reserving" as const },
      ]).map((item) => item.id),
    ).toEqual(["next", "saving"]);
  });

  it("appends newly typed operator input behind every earlier queued command", () => {
    const existing = [{ id: "first" }, { id: "second" }];

    expect(appendOperatorFollowUp(existing, { id: "new" }).map((item) => item.id)).toEqual([
      "first",
      "second",
      "new",
    ]);
    expect(
      shouldQueueOperatorFollowUp({
        delivery: "steer",
        hasEarlierManualFollowUp: true,
      }),
    ).toBe(true);
    expect(
      shouldQueueOperatorFollowUp({
        delivery: "send",
        hasEarlierManualFollowUp: true,
      }),
    ).toBe(true);
    expect(
      shouldQueueOperatorFollowUp({
        delivery: "steer",
        hasEarlierManualFollowUp: false,
      }),
    ).toBe(false);
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
        pendingDirectDispatches: [
          {
            environmentId: "local",
            threadId: "direct-operator-turn",
          },
        ],
        pendingSteers: [
          {
            environmentId: "remote",
            threadId: "background-steer-thread",
          },
        ],
        pendingInterruptRecoveries: [
          {
            environmentId: "remote",
            threadId: "background-interrupt-recovery",
          },
        ],
      }),
    ).toEqual([
      {
        environmentId: "local",
        threadId: "queued-thread",
      },
      {
        environmentId: "local",
        threadId: "direct-operator-turn",
      },
      {
        environmentId: "remote",
        threadId: "background-steer-thread",
      },
      {
        environmentId: "remote",
        threadId: "background-interrupt-recovery",
      },
    ]);
  });

  it("isolates queue state for identical thread IDs in different environments", () => {
    expect(
      followUpQueueStateKey({
        environmentId: "environment-a",
        threadId: "thread-shared",
      }),
    ).not.toBe(
      followUpQueueStateKey({
        environmentId: "environment-b",
        threadId: "thread-shared",
      }),
    );
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

  it("keeps explicit Steer responsive when active-turn evidence is already strict", () => {
    expect(
      canActivateRunningQueuedFollowUp({
        phase: "running",
        liveSteerAvailable: true,
        hasRetryBlocker: false,
        isConnecting: false,
        isEnvironmentUnavailable: false,
        isDispatchInFlight: false,
        isQueuedDispatchPending: false,
        isSteerInFlight: false,
        headStatus: "queued",
      }),
    ).toBe(true);
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

  it("does not auto-start queued work across an explicit Stop barrier", () => {
    const idleQueue = {
      queueLength: 1,
      firstItemBlocked: false,
      isWorking: false,
      isConnecting: false,
      isEnvironmentUnavailable: false,
      isDispatchInFlight: false,
    };

    expect(
      canAutoStartQueuedFollowUpTurn({
        ...idleQueue,
        manualStopBarrierActive: true,
      }),
    ).toBe(false);
    expect(
      canAutoStartQueuedFollowUpTurn({
        ...idleQueue,
        manualStopBarrierActive: false,
      }),
    ).toBe(true);
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

  it("automatically drains chained operator follow-ups in FIFO order", () => {
    const queues: Record<string, TestQueuedFollowUp[]> = {
      active: [
        { id: "first", threadId: "active", blockedReason: null },
        { id: "second", threadId: "active", blockedReason: null },
        { id: "third", threadId: "active", blockedReason: null },
      ],
    };
    const dispatched: string[] = [];

    while ((queues.active?.length ?? 0) > 0) {
      const candidate = selectQueuedFollowUpDispatchCandidate<string, TestQueuedFollowUp>({
        queuesByThreadId: queues,
        preferredThreadId: "active",
        canStart: () => true,
      });
      expect(candidate).not.toBeNull();
      if (candidate === null) {
        break;
      }
      dispatched.push(candidate.item.id);
      queues[candidate.threadId] = (queues[candidate.threadId] ?? []).slice(1);
    }

    expect(dispatched).toEqual(["first", "second", "third"]);
  });

  it("only lets the queue head use a manual Send or Steer action", () => {
    const items = [{ id: "first" }, { id: "second" }, { id: "third" }];

    expect(isQueuedFollowUpHead(items, "first")).toBe(true);
    expect(isQueuedFollowUpHead(items, "second")).toBe(false);
    expect(isQueuedFollowUpHead(items, "third")).toBe(false);
  });

  it("claims a queued steer synchronously so a repeated head action cannot duplicate it", () => {
    const claimedItemIds = new Set<string>();

    expect(tryClaimQueuedFollowUpDispatch(claimedItemIds, "first")).toBe(true);
    expect(tryClaimQueuedFollowUpDispatch(claimedItemIds, "first")).toBe(false);
    expect(tryClaimQueuedFollowUpDispatch(claimedItemIds, "second")).toBe(true);
  });

  it("releases a failed queued steer claim before the same item is requeued", () => {
    const claimedItemIds = new Set<string>();

    expect(tryClaimQueuedFollowUpDispatch(claimedItemIds, "first")).toBe(true);
    releaseQueuedFollowUpDispatchClaim(claimedItemIds, "first");
    expect(tryClaimQueuedFollowUpDispatch(claimedItemIds, "first")).toBe(true);
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

  it("removes a local queue shadow after the server already consumed its exact message", () => {
    expect(
      shouldRetainLocalFollowUpShadow({
        messageId: "msg-consumed",
        projectedStatus: null,
        projectedMessages: [{ id: "msg-consumed" }],
      }),
    ).toBe(false);
    expect(
      shouldRetainLocalFollowUpShadow({
        messageId: "msg-pending",
        projectedStatus: null,
        projectedMessages: [{ id: "msg-unrelated" }],
      }),
    ).toBe(true);
  });

  it("keeps a reserving local shadow but yields to a durable queued item", () => {
    expect(
      shouldRetainLocalFollowUpShadow({
        messageId: "msg-reserving",
        projectedStatus: "reserving",
        projectedMessages: [],
      }),
    ).toBe(true);
    expect(
      shouldRetainLocalFollowUpShadow({
        messageId: "msg-queued",
        projectedStatus: "queued",
        projectedMessages: [],
      }),
    ).toBe(false);
  });

  it("rekeys an orphaned draft queue onto the active server thread", () => {
    const draftTarget = {
      environmentId: "environment-a",
      threadId: "draft-thread",
    };
    const serverTarget = {
      environmentId: "environment-a",
      threadId: "server-thread",
    };
    const queues: Record<string, TestRekeyableFollowUp[]> = {
      [followUpQueueStateKey(draftTarget)]: [
        {
          id: "queued-1",
          environmentId: "environment-a",
          threadId: "draft-thread",
          blockedReason: "stale error",
          promptText: "next",
          serverHandoffTarget: serverTarget,
        },
      ],
    };

    const next = rekeyQueuedFollowUpsForActiveThread<string, string, TestRekeyableFollowUp>({
      queuesByThreadKey: queues,
      activeTarget: serverTarget,
      activeThreadIsServerBacked: true,
      previousActiveTarget: draftTarget,
      knownThreadKeys: new Set([followUpQueueStateKey(serverTarget)]),
    });

    expect(next[followUpQueueStateKey(draftTarget)]).toBeUndefined();
    expect(next[followUpQueueStateKey(serverTarget)]).toEqual([
      {
        id: "queued-1",
        environmentId: "environment-a",
        threadId: "server-thread",
        blockedReason: null,
        promptText: "next",
        serverHandoffTarget: null,
      },
    ]);
  });

  it("consumes an exact same-id draft handoff without moving its queue", () => {
    const target = {
      environmentId: "environment-a",
      threadId: "thread-same",
    };
    const targetKey = followUpQueueStateKey(target);
    const queues: Record<string, TestRekeyableFollowUp[]> = {
      [targetKey]: [
        {
          id: "queued-1",
          environmentId: "environment-a",
          threadId: "thread-same",
          blockedReason: "draft projection not ready",
          serverHandoffTarget: target,
        },
      ],
    };

    const next = rekeyQueuedFollowUpsForActiveThread<string, string, TestRekeyableFollowUp>({
      queuesByThreadKey: queues,
      activeTarget: target,
      activeThreadIsServerBacked: true,
      previousActiveTarget: target,
      knownThreadKeys: new Set([targetKey]),
    });

    expect(next[targetKey]).toEqual([
      {
        ...queues[targetKey]?.[0],
        blockedReason: null,
        serverHandoffTarget: null,
      },
    ]);
  });

  it("does not steal a queue from another known server thread", () => {
    const otherTarget = {
      environmentId: "environment-a",
      threadId: "other",
    };
    const activeTarget = {
      environmentId: "environment-a",
      threadId: "active",
    };
    const queues: Record<string, TestRekeyableFollowUp[]> = {
      [followUpQueueStateKey(otherTarget)]: [
        {
          id: "queued-1",
          environmentId: "environment-a",
          threadId: "other",
          blockedReason: null,
          serverHandoffTarget: null,
        },
      ],
    };

    const next = rekeyQueuedFollowUpsForActiveThread<string, string, TestRekeyableFollowUp>({
      queuesByThreadKey: queues,
      activeTarget,
      activeThreadIsServerBacked: true,
      previousActiveTarget: otherTarget,
      knownThreadKeys: new Set([
        followUpQueueStateKey(activeTarget),
        followUpQueueStateKey(otherTarget),
      ]),
    });

    expect(next).toBe(queues);
  });

  it("does not reinterpret a removed server thread queue as a draft handoff", () => {
    const removedServerTarget = {
      environmentId: "environment-a",
      threadId: "removed-server-thread",
    };
    const activeTarget = {
      environmentId: "environment-a",
      threadId: "active",
    };
    const queues: Record<string, TestRekeyableFollowUp[]> = {
      [followUpQueueStateKey(removedServerTarget)]: [
        {
          id: "queued-1",
          environmentId: "environment-a",
          threadId: "removed-server-thread",
          blockedReason: null,
          serverHandoffTarget: null,
        },
      ],
    };

    const next = rekeyQueuedFollowUpsForActiveThread<string, string, TestRekeyableFollowUp>({
      queuesByThreadKey: queues,
      activeTarget,
      activeThreadIsServerBacked: true,
      previousActiveTarget: removedServerTarget,
      knownThreadKeys: new Set([followUpQueueStateKey(activeTarget)]),
    });

    expect(next).toBe(queues);
  });

  it("does not move one local draft's queue when another draft becomes active", () => {
    const firstDraftTarget = {
      environmentId: "environment-a",
      threadId: "draft-first",
    };
    const secondDraftTarget = {
      environmentId: "environment-a",
      threadId: "draft-second",
    };
    const queues: Record<string, TestRekeyableFollowUp[]> = {
      [followUpQueueStateKey(firstDraftTarget)]: [
        {
          id: "queued-1",
          environmentId: "environment-a",
          threadId: "draft-first",
          blockedReason: null,
          serverHandoffTarget: firstDraftTarget,
        },
      ],
    };

    const next = rekeyQueuedFollowUpsForActiveThread<string, string, TestRekeyableFollowUp>({
      queuesByThreadKey: queues,
      activeTarget: secondDraftTarget,
      activeThreadIsServerBacked: false,
      previousActiveTarget: firstDraftTarget,
      knownThreadKeys: new Set(),
    });

    expect(next).toBe(queues);
  });

  it("does not move a draft queue onto an unrelated server route", () => {
    const draftTarget = {
      environmentId: "environment-a",
      threadId: "draft-thread",
    };
    const expectedServerTarget = {
      environmentId: "environment-a",
      threadId: "expected-server-thread",
    };
    const unrelatedServerTarget = {
      environmentId: "environment-a",
      threadId: "unrelated-server-thread",
    };
    const queues: Record<string, TestRekeyableFollowUp[]> = {
      [followUpQueueStateKey(draftTarget)]: [
        {
          id: "queued-1",
          environmentId: "environment-a",
          threadId: "draft-thread",
          blockedReason: null,
          serverHandoffTarget: expectedServerTarget,
        },
      ],
    };

    const next = rekeyQueuedFollowUpsForActiveThread<string, string, TestRekeyableFollowUp>({
      queuesByThreadKey: queues,
      activeTarget: unrelatedServerTarget,
      activeThreadIsServerBacked: true,
      previousActiveTarget: draftTarget,
      knownThreadKeys: new Set([followUpQueueStateKey(unrelatedServerTarget)]),
    });

    expect(next).toBe(queues);
  });

  it("never moves a draft queue across environments", () => {
    const draftTarget = {
      environmentId: "environment-a",
      threadId: "draft-thread",
    };
    const activeTarget = {
      environmentId: "environment-b",
      threadId: "server-thread",
    };
    const queues: Record<string, TestRekeyableFollowUp[]> = {
      [followUpQueueStateKey(draftTarget)]: [
        {
          id: "queued-1",
          environmentId: "environment-a",
          threadId: "draft-thread",
          blockedReason: null,
          serverHandoffTarget: draftTarget,
        },
      ],
    };

    const next = rekeyQueuedFollowUpsForActiveThread<string, string, TestRekeyableFollowUp>({
      queuesByThreadKey: queues,
      activeTarget,
      activeThreadIsServerBacked: true,
      previousActiveTarget: draftTarget,
      knownThreadKeys: new Set([followUpQueueStateKey(activeTarget)]),
    });

    expect(next).toBe(queues);
  });
});
