import { describe, expect, it } from "vitest";

import {
  AUTO_NUDGE_PROJECTION_ACK_TIMEOUT_MS,
  AUTO_NUDGE_BACKGROUND_STORAGE_KEY,
  BackgroundAutoNudgeController,
  type BackgroundAutoNudgeObservation,
} from "./backgroundAutoNudger";
import { autoNudgeDispatchIdentityForTurn } from "./autoNudger";

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
const firstTerminalTurnKey = "local:thread-a:turn-1";
const firstAutoNudgeMessageId = String(
  autoNudgeDispatchIdentityForTurn(firstTerminalTurnKey).messageId,
);
type ExistingThread = Extract<BackgroundAutoNudgeObservation["thread"], { readonly exists: true }>;

function existingThread(overrides: Partial<ExistingThread> = {}): ExistingThread {
  return {
    exists: true,
    archived: false,
    terminalTurnKey: firstTerminalTurnKey,
    latestUserMessageAt: "2026-07-23T23:59:00.000Z",
    sessionReady: true,
    sessionStarting: false,
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
    ...overrides,
  };
}

describe("background auto nudge controller", () => {
  it("dispatches exactly once after the owner navigates offscreen", () => {
    const controller = new BackgroundAutoNudgeController(null);
    controller.start(owner, "2026-07-23T23:59:00.000Z", startedAt);
    controller.observe(observation(startedAt));
    const dueAt = Date.parse(controller.getSnapshot().scheduled?.dueAt ?? "");

    // No observation occurs while the thread route is offscreen. The global
    // coordinator later observes the authoritative shell after the deadline.
    expect(controller.observe(observation(dueAt + 10_000))).toMatchObject({
      terminalTurnKey: firstTerminalTurnKey,
      messageId: firstAutoNudgeMessageId,
    });
    expect(controller.observe(observation(dueAt + 10_001))).toBeNull();
    expect(
      controller
        .getSnapshot()
        .ledger.filter(
          (entry) => entry.kind === "sent" && entry.terminalTurnKey === firstTerminalTurnKey,
        ),
    ).toHaveLength(1);
  });

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
  });

  it("stays active while its dispatched turn is starting", () => {
    const controller = new BackgroundAutoNudgeController(null);
    controller.start(owner, "2026-07-23T23:59:00.000Z", startedAt);
    controller.observe(observation(startedAt));
    const dueAt = Date.parse(controller.getSnapshot().scheduled?.dueAt ?? "");
    expect(controller.observe(observation(dueAt))).not.toBeNull();

    expect(
      controller.observe(
        observation(dueAt + 1, {
          thread: existingThread({
            terminalTurnKey: null,
            sessionReady: false,
            sessionStarting: true,
          }),
          alreadyConsumed: () => true,
        }),
      ),
    ).toBeNull();
    expect(controller.getSnapshot()).toMatchObject({
      status: "active",
      reason: null,
      scheduled: null,
    });
  });

  it("pauses for a genuinely closed session", () => {
    const controller = new BackgroundAutoNudgeController(null);
    controller.start(owner, "2026-07-23T23:59:00.000Z", startedAt);

    controller.observe(
      observation(startedAt, {
        thread: existingThread({
          sessionReady: false,
          sessionStarting: false,
          isRunning: false,
        }),
      }),
    );

    expect(controller.getSnapshot()).toMatchObject({
      status: "paused",
      reason: "Provider or transport is not ready.",
    });
  });

  it("ignores an overlong terminal identity instead of throwing at dispatch time", () => {
    const controller = new BackgroundAutoNudgeController(null);
    controller.start(owner, "2026-07-23T23:59:00.000Z", startedAt);

    expect(() =>
      controller.observe(
        observation(startedAt, {
          thread: existingThread({ terminalTurnKey: "x".repeat(513) }),
        }),
      ),
    ).not.toThrow();
    expect(controller.getSnapshot().scheduled).toBeNull();
  });

  it("cannot dispatch when disabled while a terminal turn is armed", () => {
    const controller = new BackgroundAutoNudgeController(null);
    controller.start(owner, "2026-07-23T23:59:00.000Z", startedAt);
    controller.observe(observation(startedAt));
    const dueAt = Date.parse(controller.getSnapshot().scheduled?.dueAt ?? "");

    expect(
      controller.observe(
        observation(dueAt, {
          settings: {
            mode: "steady-progress",
            enabled: false,
            maxRounds: 5,
            maxMinutes: 30,
          },
        }),
      ),
    ).toBeNull();
    expect(controller.observe(observation(dueAt + 1))).toBeNull();
    expect(controller.getSnapshot()).toMatchObject({
      owner: null,
      status: "stopped",
      reason: "Background continuation was disabled.",
    });
  });

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
      messageId: firstAutoNudgeMessageId,
      round: 1,
    });
    expect(controller.getSnapshot().ledger.at(-1)).toMatchObject({
      kind: "sent",
      messageId: firstAutoNudgeMessageId,
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

  it("rehydrates the deterministic identity for a maximum-length terminal key", () => {
    const { storage } = storageFixture();
    const terminalTurnKey = "t".repeat(512);
    const controller = new BackgroundAutoNudgeController(storage);
    controller.start(owner, "2026-07-23T23:59:00.000Z", startedAt);
    controller.observe(
      observation(startedAt, {
        thread: existingThread({ terminalTurnKey }),
      }),
    );
    const dueAt = Date.parse(controller.getSnapshot().scheduled?.dueAt ?? "");
    const dispatch = controller.observe(
      observation(dueAt, {
        thread: existingThread({ terminalTurnKey }),
      }),
    );

    expect(dispatch?.messageId.length).toBeGreaterThan(512);
    expect(new BackgroundAutoNudgeController(storage).getSnapshot().ledger.at(-1)).toMatchObject({
      terminalTurnKey,
      messageId: dispatch?.messageId,
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

  it("pauses instead of dispatching when the durable exactly-once claim cannot be saved", () => {
    const controller = new BackgroundAutoNudgeController({
      getItem: () => null,
      setItem: () => {
        throw new Error("quota unavailable");
      },
      removeItem: () => undefined,
    });
    controller.start(owner, "2026-07-23T23:59:00.000Z", startedAt);

    expect(controller.observe(observation(startedAt))).toBeNull();
    expect(controller.getSnapshot()).toMatchObject({
      status: "paused",
      reason: "Durable background state could not be saved.",
    });
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

  it("refreshes the projection deadline when an operator resumes", () => {
    const controller = new BackgroundAutoNudgeController(null);
    controller.start(owner, "2026-07-23T23:59:00.000Z", startedAt);
    controller.observe(observation(startedAt));
    const dueAt = Date.parse(controller.getSnapshot().scheduled?.dueAt ?? "");
    controller.observe(observation(dueAt));
    const resumedAt = dueAt + AUTO_NUDGE_PROJECTION_ACK_TIMEOUT_MS + 1;

    controller.pause("Paused by operator.", dueAt + 1);
    controller.resume(resumedAt);
    expect(controller.getSnapshot().expectedAutomatedUserMessageDeadlineAt).toBe(
      new Date(resumedAt + AUTO_NUDGE_PROJECTION_ACK_TIMEOUT_MS).toISOString(),
    );

    controller.observe(
      observation(resumedAt, {
        thread: existingThread({
          terminalTurnKey: null,
          sessionReady: false,
          sessionStarting: true,
        }),
        alreadyConsumed: () => true,
      }),
    );
    expect(controller.getSnapshot().status).toBe("active");
  });

  it("recovers after durable storage becomes writable again", () => {
    const values = new Map<string, string>();
    let failWrites = true;
    const controller = new BackgroundAutoNudgeController({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        if (failWrites) throw new Error("storage unavailable");
        values.set(key, value);
      },
      removeItem: (key) => values.delete(key),
    });
    controller.start(owner, "2026-07-23T23:59:00.000Z", startedAt);

    failWrites = false;
    controller.observe(observation(startedAt));
    expect(controller.getSnapshot().status).toBe("paused");

    controller.resume(startedAt + 1);
    controller.observe(observation(startedAt + 1));
    expect(controller.getSnapshot()).toMatchObject({
      status: "active",
      reason: null,
      scheduled: { terminalTurnKey: firstTerminalTurnKey },
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
        messageId: firstAutoNudgeMessageId,
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

    controller.markDispatchFailed(firstAutoNudgeMessageId, "late rejection", dueAt + 3);

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
