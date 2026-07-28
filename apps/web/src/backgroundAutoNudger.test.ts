import { describe, expect, it, vi } from "vitest";

import {
  AUTO_NUDGE_PROJECTION_ACK_TIMEOUT_MS,
  AUTO_NUDGE_BACKGROUND_STORAGE_KEY,
  __resetBackgroundAutoNudgeControllerForTests,
  BackgroundAutoNudgeController,
  getBackgroundAutoNudgeController,
  type BackgroundAutoNudgeObservation,
} from "./backgroundAutoNudger";

function storageFixture() {
  const values = new Map<string, string>();
  return {
    values,
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  };
}

const owner = { environmentId: "local", threadId: "thread-a" };
const replacementOwner = { environmentId: "local", threadId: "thread-b" };
const startedAt = Date.parse("2026-07-24T00:00:00.000Z");
const backgroundPolicy = {
  mode: "steady-progress" as const,
  backgroundContinuation: true,
  maxRounds: 5,
  maxMinutes: 30,
};
type ExistingThread = Extract<BackgroundAutoNudgeObservation["thread"], { readonly exists: true }>;

function existingThread(overrides: Partial<ExistingThread> = {}): ExistingThread {
  return {
    exists: true,
    archived: false,
    terminalTurnKey: "local:thread-a:turn-1",
    latestUserMessageAt: "2026-07-23T23:59:00.000Z",
    sessionReady: true,
    isRunning: false,
    hasPendingWork: false,
    providerAvailable: true,
    ...overrides,
  };
}

function observation(
  nowMs: number,
  overrides: Partial<BackgroundAutoNudgeObservation> = {},
): BackgroundAutoNudgeObservation {
  return {
    nowMs,
    thread: existingThread(),
    alreadyConsumed: () => false,
    newMessageId: () => "message-auto-1",
    ...overrides,
  };
}

describe("background auto nudge controller", () => {
  it("notifies subscribers when a cross-window lock reloads durable ownership", () => {
    const { storage } = storageFixture();
    const firstWindow = new BackgroundAutoNudgeController(storage);
    const secondWindow = new BackgroundAutoNudgeController(storage);
    let notifications = 0;
    secondWindow.subscribe(() => {
      notifications += 1;
    });

    firstWindow.start(owner, null, startedAt);
    secondWindow.reloadFromStorage();

    expect(notifications).toBe(1);
    expect(secondWindow.getSnapshot()).toMatchObject({ owner, status: "active" });

    secondWindow.reloadFromStorage();
    expect(notifications).toBe(1);
  });

  it("does not let start silently replace a different active owner", () => {
    const controller = new BackgroundAutoNudgeController(null);
    expect(controller.start(owner, "2026-07-23T23:59:00.000Z", startedAt)).toBe(true);

    expect(controller.start(replacementOwner, null, startedAt + 1)).toBe(false);

    expect(controller.getSnapshot()).toMatchObject({
      owner,
      lastOwner: owner,
      status: "active",
      baselineUserMessageAt: "2026-07-23T23:59:00.000Z",
    });
    expect(controller.getSnapshot().ledger).toHaveLength(1);
    expect(controller.getSnapshot().ledger[0]).toMatchObject({ owner, kind: "started" });
  });

  it("transfers only when the caller names the exact current owner", () => {
    const controller = new BackgroundAutoNudgeController(null);
    controller.start(owner, "2026-07-23T23:59:00.000Z", startedAt);
    const staleExpectedOwner = { environmentId: "remote", threadId: owner.threadId };

    expect(controller.transfer(staleExpectedOwner, replacementOwner, null, startedAt + 1)).toBe(
      false,
    );
    expect(controller.getSnapshot()).toMatchObject({ owner, status: "active" });

    expect(controller.transfer(owner, replacementOwner, null, startedAt + 2)).toBe(true);
    expect(controller.getSnapshot()).toMatchObject({
      owner: replacementOwner,
      lastOwner: replacementOwner,
      status: "active",
    });
  });

  it("does not carry one thread's ledger through an explicit ownership transfer", () => {
    const { storage } = storageFixture();
    const controller = new BackgroundAutoNudgeController(storage);
    controller.start(owner, "2026-07-23T23:59:00.000Z", startedAt);
    controller.observe(observation(startedAt));
    const dueAt = Date.parse(controller.getSnapshot().scheduled?.dueAt ?? "");
    expect(controller.observe(observation(dueAt))).not.toBeNull();
    expect(
      controller.getSnapshot().ledger.some((entry) => entry.owner.threadId === "thread-a"),
    ).toBe(true);

    expect(
      controller.transfer(owner, replacementOwner, "2026-07-23T23:59:00.000Z", dueAt + 1),
    ).toBe(true);

    const transferred = controller.getSnapshot();
    expect(transferred.ledger).toHaveLength(1);
    expect(transferred.ledger.every((entry) => entry.owner.threadId === "thread-b")).toBe(true);
    expect(transferred.ledger.some((entry) => entry.messageId === "message-auto-1")).toBe(false);
    expect(new BackgroundAutoNudgeController(storage).getSnapshot().ledger).toEqual(
      transferred.ledger,
    );
  });

  it("discards legacy persisted ledger rows that have no exact owner", () => {
    const { storage, values } = storageFixture();
    const controller = new BackgroundAutoNudgeController(storage);
    controller.start(owner, null, startedAt);
    const persisted = JSON.parse(values.get(AUTO_NUDGE_BACKGROUND_STORAGE_KEY) ?? "{}") as {
      ledger?: Array<Record<string, unknown>>;
    };
    if (!persisted.ledger?.[0]) throw new Error("expected a persisted ledger row");
    delete persisted.ledger[0].owner;
    values.set(AUTO_NUDGE_BACKGROUND_STORAGE_KEY, JSON.stringify(persisted));

    const rehydrated = new BackgroundAutoNudgeController(storage).getSnapshot();

    expect(rehydrated).toMatchObject({ owner, status: "active" });
    expect(rehydrated.ledger).toEqual([]);
  });

  it("synchronizes a Stop written by another renderer", () => {
    const { storage } = storageFixture();
    const storageListeners: Array<(event: { readonly key: string | null }) => void> = [];
    vi.stubGlobal("window", {
      localStorage: storage,
      addEventListener: (
        type: string,
        listener: (event: { readonly key: string | null }) => void,
      ) => {
        if (type === "storage") storageListeners.push(listener);
      },
      removeEventListener: (
        type: string,
        listener: (event: { readonly key: string | null }) => void,
      ) => {
        if (type !== "storage") return;
        const index = storageListeners.indexOf(listener);
        if (index >= 0) storageListeners.splice(index, 1);
      },
    });

    try {
      __resetBackgroundAutoNudgeControllerForTests();
      const observingWindow = getBackgroundAutoNudgeController();
      const stoppingWindow = new BackgroundAutoNudgeController(storage);
      stoppingWindow.start(owner, null, startedAt);
      storageListeners[0]?.({ key: AUTO_NUDGE_BACKGROUND_STORAGE_KEY });
      expect(observingWindow.getSnapshot()).toMatchObject({ owner, status: "active" });

      stoppingWindow.stop(owner, "Stopped in another renderer.", startedAt + 1);
      storageListeners[0]?.({ key: AUTO_NUDGE_BACKGROUND_STORAGE_KEY });

      expect(observingWindow.getSnapshot()).toMatchObject({
        owner: null,
        status: "stopped",
        reason: "Stopped in another renderer.",
      });
    } finally {
      __resetBackgroundAutoNudgeControllerForTests();
      vi.unstubAllGlobals();
    }
  });

  it("arms one owned thread, waits for the delay, and records an attributable send", () => {
    const { storage } = storageFixture();
    const controller = new BackgroundAutoNudgeController(storage);
    controller.start(owner, "2026-07-23T23:59:00.000Z", backgroundPolicy, startedAt);

    expect(controller.observe(observation(startedAt))).toBeNull();
    const dueAt = Date.parse(controller.getSnapshot().scheduled?.dueAt ?? "");
    const dispatch = controller.observe(observation(dueAt));

    expect(dispatch).toMatchObject({
      owner,
      terminalTurnKey: "local:thread-a:turn-1",
      prompt: "Keep a few lanes going, make steady progress",
      messageId: "message-auto-1",
      round: 1,
    });
    expect(controller.getSnapshot().ledger.at(-1)).toMatchObject({
      kind: "sent",
      owner,
      messageId: "message-auto-1",
      terminalTurnKey: "local:thread-a:turn-1",
    });
  });

  it("rehydrates without dispatching the same consumed terminal turn after reload", () => {
    const { storage, values } = storageFixture();
    const beforeReload = new BackgroundAutoNudgeController(storage);
    beforeReload.start(owner, "2026-07-23T23:59:00.000Z", backgroundPolicy, startedAt);
    beforeReload.observe(observation(startedAt));
    const dueAt = Date.parse(beforeReload.getSnapshot().scheduled?.dueAt ?? "");
    expect(beforeReload.observe(observation(dueAt))).not.toBeNull();
    expect(values.has(AUTO_NUDGE_BACKGROUND_STORAGE_KEY)).toBe(true);

    const afterReload = new BackgroundAutoNudgeController(storage);
    const expectedAt = beforeReload.getSnapshot().expectedAutomatedUserMessageAt;
    expect(
      afterReload.observe(
        observation(dueAt + 1, {
          // Durable background ledger remains sufficient even when a full app
          // restart has replaced sessionStorage.
          alreadyConsumed: () => false,
        }),
      ),
    ).toBeNull();
    expect(afterReload.getSnapshot().sentRounds).toBe(1);
    expect(afterReload.getSnapshot().scheduled).toBeNull();
    expect(afterReload.getSnapshot().expectedAutomatedUserMessageAt).toBe(expectedAt);

    expect(
      afterReload.observe(
        observation(dueAt + 2, {
          thread: existingThread({
            latestUserMessageAt: expectedAt,
            isRunning: true,
            terminalTurnKey: null,
          }),
          alreadyConsumed: () => true,
        }),
      ),
    ).toBeNull();
    expect(afterReload.getSnapshot()).toMatchObject({
      status: "active",
      baselineUserMessageAt: expectedAt,
      expectedAutomatedUserMessageAt: null,
    });
  });

  it("makes a second shared-storage controller re-read the durable claim before dispatch", () => {
    const { storage } = storageFixture();
    const firstWindow = new BackgroundAutoNudgeController(storage);
    firstWindow.start(owner, "2026-07-23T23:59:00.000Z", backgroundPolicy, startedAt);
    const secondWindow = new BackgroundAutoNudgeController(storage);
    firstWindow.observe(observation(startedAt));
    const dueAt = Date.parse(firstWindow.getSnapshot().scheduled?.dueAt ?? "");

    const firstDispatch = firstWindow.observe(observation(dueAt));
    // This mirrors the exclusive Web Locks callback: the contender must not
    // trust the state it loaded before the first window consumed the turn.
    secondWindow.reloadFromStorage();
    const secondDispatch = secondWindow.observe(observation(dueAt));

    expect(firstDispatch).not.toBeNull();
    expect(secondDispatch).toBeNull();
    expect(secondWindow.getSnapshot().sentRounds).toBe(1);
  });

  it("pauses on manual activity, queued work, and provider trouble", () => {
    for (const [label, thread] of [
      [
        "Manual thread activity detected.",
        existingThread({
          latestUserMessageAt: "2026-07-24T00:00:01.000Z",
        }),
      ],
      [
        "Queued work or operator attention is pending.",
        existingThread({
          hasPendingWork: true,
        }),
      ],
      [
        "Provider or transport is not ready.",
        existingThread({
          providerAvailable: false,
        }),
      ],
    ] as const) {
      const controller = new BackgroundAutoNudgeController(null);
      controller.start(owner, "2026-07-23T23:59:00.000Z", backgroundPolicy, startedAt);
      expect(controller.observe(observation(startedAt, { thread }))).toBeNull();
      expect(controller.getSnapshot()).toMatchObject({ status: "paused", reason: label });
    }
  });

  it("stops for a missing thread and exhausts conservative round and time caps", () => {
    const missing = new BackgroundAutoNudgeController(null);
    missing.start(owner, null, backgroundPolicy, startedAt);
    missing.observe(observation(startedAt, { thread: { exists: false } }));
    expect(missing.getSnapshot()).toMatchObject({ status: "stopped", owner: null });

    const rounds = new BackgroundAutoNudgeController(null);
    rounds.start(
      owner,
      "2026-07-23T23:59:00.000Z",
      { ...backgroundPolicy, maxRounds: 1 },
      startedAt,
    );
    rounds.observe(observation(startedAt));
    const dueAt = Date.parse(rounds.getSnapshot().scheduled?.dueAt ?? "");
    rounds.observe(observation(dueAt));
    rounds.observe(
      observation(dueAt + 1, {
        thread: existingThread({
          terminalTurnKey: "local:thread-a:turn-2",
          latestUserMessageAt: new Date(dueAt).toISOString(),
        }),
      }),
    );
    expect(rounds.getSnapshot()).toMatchObject({ status: "exhausted", sentRounds: 1 });

    const time = new BackgroundAutoNudgeController(null);
    time.start(owner, null, { ...backgroundPolicy, maxMinutes: 5 }, startedAt);
    time.observe(observation(startedAt + 5 * 60_000));
    expect(time.getSnapshot()).toMatchObject({ status: "exhausted" });
  });

  it("invalidates a scheduled dispatch when stopped, paused, or the observed turn changes", () => {
    const controller = new BackgroundAutoNudgeController(null);
    controller.start(owner, "2026-07-23T23:59:00.000Z", backgroundPolicy, startedAt);
    controller.observe(observation(startedAt));
    const firstDueAt = Date.parse(controller.getSnapshot().scheduled?.dueAt ?? "");
    controller.pause(owner, "Paused by operator.", startedAt + 1);
    expect(controller.observe(observation(firstDueAt))).toBeNull();

    controller.resume(owner, firstDueAt + 1);
    controller.observe(
      observation(firstDueAt + 1, {
        thread: existingThread({
          terminalTurnKey: "local:thread-a:turn-2",
        }),
      }),
    );
    expect(controller.getSnapshot().scheduled?.terminalTurnKey).toBe("local:thread-a:turn-2");
    controller.stop(owner, "Stopped by operator.", firstDueAt + 2);
    expect(controller.observe(observation(firstDueAt + 10_000))).toBeNull();
  });

  it("pauses when a consumed send never projects its automated user row", () => {
    const controller = new BackgroundAutoNudgeController(null);
    controller.start(owner, "2026-07-23T23:59:00.000Z", backgroundPolicy, startedAt);
    controller.observe(observation(startedAt));
    const dueAt = Date.parse(controller.getSnapshot().scheduled?.dueAt ?? "");
    expect(controller.observe(observation(dueAt))).not.toBeNull();

    controller.observe(
      observation(dueAt + AUTO_NUDGE_PROJECTION_ACK_TIMEOUT_MS, {
        alreadyConsumed: () => true,
      }),
    );

    expect(controller.getSnapshot()).toMatchObject({
      status: "paused",
      reason: "The automated prompt was not projected within 60 seconds; continuation paused.",
    });
  });

  it("fails closed when the expected projection arrives after its ACK deadline", () => {
    const controller = new BackgroundAutoNudgeController(null);
    controller.start(owner, "2026-07-23T23:59:00.000Z", backgroundPolicy, startedAt);
    controller.observe(observation(startedAt));
    const dueAt = Date.parse(controller.getSnapshot().scheduled?.dueAt ?? "");
    controller.observe(observation(dueAt));
    const expectedAt = controller.getSnapshot().expectedAutomatedUserMessageAt;

    controller.observe(
      observation(dueAt + AUTO_NUDGE_PROJECTION_ACK_TIMEOUT_MS + 1, {
        alreadyConsumed: () => true,
        thread: existingThread({
          latestUserMessageAt: expectedAt,
          isRunning: true,
          terminalTurnKey: null,
        }),
      }),
    );

    expect(controller.getSnapshot()).toMatchObject({
      status: "paused",
      reason: "The automated prompt was not projected within 60 seconds; continuation paused.",
    });
  });

  it("retains sent terminal identities through bounded status-ledger churn", () => {
    const controller = new BackgroundAutoNudgeController(null);
    controller.start(owner, "2026-07-23T23:59:00.000Z", backgroundPolicy, startedAt);
    controller.observe(observation(startedAt));
    const dueAt = Date.parse(controller.getSnapshot().scheduled?.dueAt ?? "");
    controller.observe(observation(dueAt));

    for (let index = 0; index < 50; index += 1) {
      controller.pause(owner, `operator pause ${index}`, dueAt + index + 1);
      controller.resume(owner, dueAt + index + 1);
    }

    expect(controller.getSnapshot().ledger).toHaveLength(40);
    expect(controller.getSnapshot().ledger).toContainEqual(
      expect.objectContaining({
        kind: "sent",
        terminalTurnKey: "local:thread-a:turn-1",
        messageId: "message-auto-1",
      }),
    );
  });

  it("does not let stale owner callbacks mutate a replacement after explicit transfer", () => {
    const controller = new BackgroundAutoNudgeController(null);
    controller.start(owner, "2026-07-23T23:59:00.000Z", backgroundPolicy, startedAt);
    controller.observe(observation(startedAt));
    const dueAt = Date.parse(controller.getSnapshot().scheduled?.dueAt ?? "");
    controller.observe(observation(dueAt));
    controller.stop(owner, "operator stopped", dueAt + 1);
    controller.start(
      { environmentId: "local", threadId: "thread-b" },
      null,
      backgroundPolicy,
      dueAt + 2,
    );

    controller.markDispatchFailed("message-auto-1", "late rejection", dueAt + 3);

    expect(controller.pause(owner, "stale pause", startedAt + 2)).toBe(false);
    expect(controller.stop(owner, "stale stop", startedAt + 3)).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({
      owner: replacementOwner,
      status: "active",
      reason: null,
    });

    expect(controller.pause(replacementOwner, "current pause", startedAt + 4)).toBe(true);
    expect(controller.resume(owner, startedAt + 5)).toBe(false);
    expect(controller.getSnapshot()).toMatchObject({
      owner: replacementOwner,
      status: "paused",
      reason: "current pause",
    });
    expect(controller.resume(replacementOwner, startedAt + 6)).toBe(true);

    controller.observe(
      observation(startedAt + 7, {
        thread: existingThread({ terminalTurnKey: "local:thread-b:turn-1" }),
        newMessageId: () => "message-auto-b",
      }),
    );
    const dueAt = Date.parse(controller.getSnapshot().scheduled?.dueAt ?? "");
    expect(
      controller.observe(
        observation(dueAt, {
          thread: existingThread({ terminalTurnKey: "local:thread-b:turn-1" }),
          newMessageId: () => "message-auto-b",
        }),
      ),
    ).not.toBeNull();

    controller.markDispatchFailed(owner, "message-auto-b", "late rejection", dueAt + 1);

    expect(controller.getSnapshot()).toMatchObject({
      owner: replacementOwner,
      status: "active",
      reason: null,
      expectedAutomatedUserMessageAt: new Date(dueAt).toISOString(),
    });
  });

  it("pauses rather than extending a run when the system clock moves backwards", () => {
    const controller = new BackgroundAutoNudgeController(null);
    controller.start(owner, null, backgroundPolicy, startedAt);

    controller.observe(observation(startedAt - 1));

    expect(controller.getSnapshot()).toMatchObject({
      status: "paused",
      reason: "The system clock moved before the continuation start time.",
    });
  });

  it("fails closed for a persisted scheduled date that cannot be a five-second delay", () => {
    const { storage, values } = storageFixture();
    const beforeReload = new BackgroundAutoNudgeController(storage);
    beforeReload.start(owner, "2026-07-23T23:59:00.000Z", backgroundPolicy, startedAt);
    beforeReload.observe(observation(startedAt));
    const persisted = JSON.parse(values.get(AUTO_NUDGE_BACKGROUND_STORAGE_KEY) ?? "{}") as {
      scheduled?: { dueAt: string };
    };
    if (!persisted.scheduled) throw new Error("expected scheduled state");
    persisted.scheduled.dueAt = new Date(startedAt + 60_000).toISOString();
    values.set(AUTO_NUDGE_BACKGROUND_STORAGE_KEY, JSON.stringify(persisted));

    const afterReload = new BackgroundAutoNudgeController(storage);
    afterReload.observe(observation(startedAt));

    expect(afterReload.getSnapshot()).toMatchObject({
      status: "paused",
      reason: "The scheduled nudge deadline is invalid or the system clock moved backwards.",
    });
  });

  it("captures the exact owner's mode and caps durably for the run", () => {
    const { storage } = storageFixture();
    const firstWindow = new BackgroundAutoNudgeController(storage);
    firstWindow.start(
      owner,
      "2026-07-23T23:59:00.000Z",
      {
        mode: "hardcore-fanout",
        backgroundContinuation: true,
        maxRounds: 1,
        maxMinutes: 5,
      },
      startedAt,
    );

    const afterReload = new BackgroundAutoNudgeController(storage);
    expect(afterReload.getSnapshot().runPolicy).toEqual({
      mode: "hardcore-fanout",
      backgroundContinuation: true,
      maxRounds: 1,
      maxMinutes: 5,
    });
    afterReload.observe(observation(startedAt));
    const dueAt = Date.parse(afterReload.getSnapshot().scheduled?.dueAt ?? "");
    expect(afterReload.observe(observation(dueAt))).toMatchObject({
      prompt: "Fan out and keep going",
      round: 1,
    });
    afterReload.observe(
      observation(dueAt + 1, {
        thread: existingThread({
          terminalTurnKey: "local:thread-a:turn-2",
          latestUserMessageAt: new Date(dueAt).toISOString(),
        }),
      }),
    );
    expect(afterReload.getSnapshot().status).toBe("exhausted");
  });

  it("never lets another thread's disabled policy stop the active owner", () => {
    const controller = new BackgroundAutoNudgeController(null);
    controller.start(owner, null, backgroundPolicy, startedAt);

    controller.synchronizePolicy(
      { environmentId: "local", threadId: "thread-b" },
      { ...backgroundPolicy, mode: "off", backgroundContinuation: false },
      startedAt + 1,
    );
    expect(controller.getSnapshot()).toMatchObject({ owner, status: "active" });

    controller.synchronizePolicy(
      owner,
      { ...backgroundPolicy, mode: "off", backgroundContinuation: false },
      startedAt + 2,
    );
    expect(controller.getSnapshot()).toMatchObject({ owner: null, status: "stopped" });
  });

  it("does not dispatch or interrupt while the provider agent is in progress", () => {
    const controller = new BackgroundAutoNudgeController(null);
    controller.start(owner, "2026-07-23T23:59:00.000Z", backgroundPolicy, startedAt);
    controller.observe(observation(startedAt));
    const dueAt = Date.parse(controller.getSnapshot().scheduled?.dueAt ?? "");

    expect(
      controller.observe(
        observation(dueAt, {
          thread: existingThread({
            isRunning: true,
            sessionReady: false,
            terminalTurnKey: null,
          }),
        }),
      ),
    ).toBeNull();
    expect(controller.getSnapshot()).toMatchObject({
      owner,
      status: "active",
      sentRounds: 0,
      scheduled: null,
    });
  });

  it("fails closed for a legacy active owner until that exact owner is migrated", () => {
    const { storage, values } = storageFixture();
    const beforeReload = new BackgroundAutoNudgeController(storage);
    beforeReload.start(owner, null, backgroundPolicy, startedAt);
    const persisted = JSON.parse(values.get(AUTO_NUDGE_BACKGROUND_STORAGE_KEY) ?? "{}") as {
      runPolicy?: unknown;
    };
    delete persisted.runPolicy;
    values.set(AUTO_NUDGE_BACKGROUND_STORAGE_KEY, JSON.stringify(persisted));

    const afterReload = new BackgroundAutoNudgeController(storage);
    expect(afterReload.getSnapshot()).toMatchObject({ owner, runPolicy: null, status: "active" });
    expect(afterReload.observe(observation(startedAt))).toBeNull();
    expect(afterReload.getSnapshot()).toMatchObject({ owner: null, status: "stopped" });
  });
});
