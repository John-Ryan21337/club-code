import { describe, expect, it } from "vitest";

import {
  AUTO_NUDGE_PROJECTION_ACK_TIMEOUT_MS,
  AUTO_NUDGE_BACKGROUND_STORAGE_KEY,
  BackgroundAutoNudgeController,
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
const startedAt = Date.parse("2026-07-24T00:00:00.000Z");
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
    settings: {
      mode: "steady-progress",
      enabled: true,
      maxRounds: 5,
      maxMinutes: 30,
    },
    thread: existingThread(),
    alreadyConsumed: () => false,
    newMessageId: () => "message-auto-1",
    ...overrides,
  };
}

describe("background auto nudge controller", () => {
  it("arms one owned thread, waits for the delay, and records an attributable send", () => {
    const { storage } = storageFixture();
    const controller = new BackgroundAutoNudgeController(storage);
    controller.start(owner, "2026-07-23T23:59:00.000Z", startedAt);

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
      messageId: "message-auto-1",
      terminalTurnKey: "local:thread-a:turn-1",
    });
  });

  it("rehydrates without dispatching the same consumed terminal turn after reload", () => {
    const { storage, values } = storageFixture();
    const beforeReload = new BackgroundAutoNudgeController(storage);
    beforeReload.start(owner, "2026-07-23T23:59:00.000Z", startedAt);
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
    firstWindow.start(owner, "2026-07-23T23:59:00.000Z", startedAt);
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
      controller.start(owner, "2026-07-23T23:59:00.000Z", startedAt);
      expect(controller.observe(observation(startedAt, { thread }))).toBeNull();
      expect(controller.getSnapshot()).toMatchObject({ status: "paused", reason: label });
    }
  });

  it("stops for a missing thread and exhausts conservative round and time caps", () => {
    const missing = new BackgroundAutoNudgeController(null);
    missing.start(owner, null, startedAt);
    missing.observe(observation(startedAt, { thread: { exists: false } }));
    expect(missing.getSnapshot()).toMatchObject({ status: "stopped", owner: null });

    const rounds = new BackgroundAutoNudgeController(null);
    rounds.start(owner, "2026-07-23T23:59:00.000Z", startedAt);
    rounds.observe(
      observation(startedAt, {
        settings: {
          mode: "steady-progress",
          enabled: true,
          maxRounds: 1,
          maxMinutes: 30,
        },
      }),
    );
    const dueAt = Date.parse(rounds.getSnapshot().scheduled?.dueAt ?? "");
    rounds.observe(
      observation(dueAt, {
        settings: {
          mode: "steady-progress",
          enabled: true,
          maxRounds: 1,
          maxMinutes: 30,
        },
      }),
    );
    rounds.observe(
      observation(dueAt + 1, {
        settings: {
          mode: "steady-progress",
          enabled: true,
          maxRounds: 1,
          maxMinutes: 30,
        },
        thread: existingThread({
          terminalTurnKey: "local:thread-a:turn-2",
          latestUserMessageAt: new Date(dueAt).toISOString(),
        }),
      }),
    );
    expect(rounds.getSnapshot()).toMatchObject({ status: "exhausted", sentRounds: 1 });

    const time = new BackgroundAutoNudgeController(null);
    time.start(owner, null, startedAt);
    time.observe(
      observation(startedAt + 5 * 60_000, {
        settings: {
          mode: "steady-progress",
          enabled: true,
          maxRounds: 5,
          maxMinutes: 5,
        },
      }),
    );
    expect(time.getSnapshot()).toMatchObject({ status: "exhausted" });
  });

  it("invalidates a scheduled dispatch when stopped, paused, or the observed turn changes", () => {
    const controller = new BackgroundAutoNudgeController(null);
    controller.start(owner, "2026-07-23T23:59:00.000Z", startedAt);
    controller.observe(observation(startedAt));
    const firstDueAt = Date.parse(controller.getSnapshot().scheduled?.dueAt ?? "");
    controller.pause("Paused by operator.", startedAt + 1);
    expect(controller.observe(observation(firstDueAt))).toBeNull();

    controller.resume(firstDueAt + 1);
    controller.observe(
      observation(firstDueAt + 1, {
        thread: existingThread({
          terminalTurnKey: "local:thread-a:turn-2",
        }),
      }),
    );
    expect(controller.getSnapshot().scheduled?.terminalTurnKey).toBe("local:thread-a:turn-2");
    controller.stop("Stopped by operator.", firstDueAt + 2);
    expect(controller.observe(observation(firstDueAt + 10_000))).toBeNull();
  });

  it("pauses when a consumed send never projects its automated user row", () => {
    const controller = new BackgroundAutoNudgeController(null);
    controller.start(owner, "2026-07-23T23:59:00.000Z", startedAt);
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
    controller.start(owner, "2026-07-23T23:59:00.000Z", startedAt);
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
    controller.start(owner, "2026-07-23T23:59:00.000Z", startedAt);
    controller.observe(observation(startedAt));
    const dueAt = Date.parse(controller.getSnapshot().scheduled?.dueAt ?? "");
    controller.observe(observation(dueAt));

    for (let index = 0; index < 50; index += 1) {
      controller.pause(`operator pause ${index}`, dueAt + index + 1);
      controller.resume(dueAt + index + 1);
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

  it("does not let a late transport rejection pause a replacement run", () => {
    const controller = new BackgroundAutoNudgeController(null);
    controller.start(owner, "2026-07-23T23:59:00.000Z", startedAt);
    controller.observe(observation(startedAt));
    const dueAt = Date.parse(controller.getSnapshot().scheduled?.dueAt ?? "");
    controller.observe(observation(dueAt));
    controller.stop("operator stopped", dueAt + 1);
    controller.start({ environmentId: "local", threadId: "thread-b" }, null, dueAt + 2);

    controller.markDispatchFailed("message-auto-1", "late rejection", dueAt + 3);

    expect(controller.getSnapshot()).toMatchObject({
      owner: { environmentId: "local", threadId: "thread-b" },
      status: "active",
      reason: null,
    });
  });

  it("pauses rather than extending a run when the system clock moves backwards", () => {
    const controller = new BackgroundAutoNudgeController(null);
    controller.start(owner, null, startedAt);

    controller.observe(observation(startedAt - 1));

    expect(controller.getSnapshot()).toMatchObject({
      status: "paused",
      reason: "The system clock moved before the continuation start time.",
    });
  });

  it("fails closed for a persisted scheduled date that cannot be a five-second delay", () => {
    const { storage, values } = storageFixture();
    const beforeReload = new BackgroundAutoNudgeController(storage);
    beforeReload.start(owner, "2026-07-23T23:59:00.000Z", startedAt);
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
});
