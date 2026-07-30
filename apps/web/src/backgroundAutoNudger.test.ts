import { describe, expect, it } from "vitest";

import {
  AUTO_NUDGE_BACKGROUND_STORAGE_KEY,
  AUTO_NUDGE_PROJECTION_ACK_TIMEOUT_MS,
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
const completedAt = Date.parse("2026-07-24T00:00:00.000Z");
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
    },
    thread: existingThread(),
    alreadyConsumed: () => false,
    newMessageId: () => "message-auto-1",
    ...overrides,
  };
}

describe("background auto nudge controller", () => {
  it("dispatches immediately from a newly completed response and records the exact turn", () => {
    const { storage } = storageFixture();
    const controller = new BackgroundAutoNudgeController(storage);
    controller.start(owner, "2026-07-23T23:59:00.000Z", null, completedAt - 1);

    const dispatch = controller.observe(observation(completedAt));

    expect(dispatch).toMatchObject({
      owner,
      terminalTurnKey: "local:thread-a:turn-1",
      prompt: expect.stringContaining("Select the highest-priority unblocked operator ask"),
      messageId: "message-auto-1",
      createdAt: "2026-07-24T00:00:00.000Z",
      round: 1,
    });
    expect(controller.getSnapshot()).toMatchObject({
      status: "active",
      sentRounds: 1,
      expectedAutomatedUserMessageAt: "2026-07-24T00:00:00.000Z",
    });
    expect(controller.getSnapshot().ledger.at(-1)).toMatchObject({
      kind: "sent",
      messageId: "message-auto-1",
      terminalTurnKey: "local:thread-a:turn-1",
    });
  });

  it("treats an already-completed response as a baseline when background mode is enabled", () => {
    const controller = new BackgroundAutoNudgeController(null);
    controller.start(owner, "2026-07-23T23:59:00.000Z", "local:thread-a:turn-1", completedAt - 1);

    expect(controller.observe(observation(completedAt))).toBeNull();
    expect(controller.getSnapshot().sentRounds).toBe(0);
    expect(
      controller.observe(
        observation(completedAt + 1, {
          thread: existingThread({ terminalTurnKey: "local:thread-a:turn-2" }),
        }),
      ),
    ).not.toBeNull();
  });

  it("deduplicates repeated completion observations across reloads", () => {
    const { storage } = storageFixture();
    const beforeReload = new BackgroundAutoNudgeController(storage);
    beforeReload.start(owner, "2026-07-23T23:59:00.000Z", null, completedAt - 1);
    expect(beforeReload.observe(observation(completedAt))).not.toBeNull();

    const afterReload = new BackgroundAutoNudgeController(storage);
    expect(
      afterReload.observe(
        observation(completedAt + 1, {
          alreadyConsumed: () => true,
        }),
      ),
    ).toBeNull();
    expect(afterReload.getSnapshot().sentRounds).toBe(1);

    const expectedAt = afterReload.getSnapshot().expectedAutomatedUserMessageAt;
    expect(
      afterReload.observe(
        observation(completedAt + 2, {
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

  it("makes a second shared-storage controller re-read the durable claim", () => {
    const { storage } = storageFixture();
    const firstWindow = new BackgroundAutoNudgeController(storage);
    firstWindow.start(owner, "2026-07-23T23:59:00.000Z", null, completedAt - 1);
    const secondWindow = new BackgroundAutoNudgeController(storage);

    expect(firstWindow.observe(observation(completedAt))).not.toBeNull();
    secondWindow.reloadFromStorage();

    expect(secondWindow.observe(observation(completedAt))).toBeNull();
    expect(secondWindow.getSnapshot().sentRounds).toBe(1);
  });

  it("pauses on manual activity, queued work, and provider trouble", () => {
    for (const [reason, thread] of [
      [
        "Manual thread activity detected.",
        existingThread({ latestUserMessageAt: "2026-07-24T00:00:01.000Z" }),
      ],
      ["Queued work or operator attention is pending.", existingThread({ hasPendingWork: true })],
      ["Provider or transport is not ready.", existingThread({ providerAvailable: false })],
    ] as const) {
      const controller = new BackgroundAutoNudgeController(null);
      controller.start(owner, "2026-07-23T23:59:00.000Z", null, completedAt - 1);
      expect(controller.observe(observation(completedAt, { thread }))).toBeNull();
      expect(controller.getSnapshot()).toMatchObject({ status: "paused", reason });
    }
  });

  it("does not dispatch until a response is completed", () => {
    const controller = new BackgroundAutoNudgeController(null);
    controller.start(owner, null, null, completedAt - 1);

    expect(
      controller.observe(
        observation(completedAt, {
          thread: existingThread({ isRunning: true, terminalTurnKey: null }),
        }),
      ),
    ).toBeNull();
    expect(
      controller.observe(
        observation(completedAt + 60_000, {
          thread: existingThread({ isRunning: false, terminalTurnKey: null }),
        }),
      ),
    ).toBeNull();
    expect(controller.getSnapshot().sentRounds).toBe(0);
  });

  it("stops for a missing thread and exhausts only the round cap", () => {
    const missing = new BackgroundAutoNudgeController(null);
    missing.start(owner, null, null, completedAt - 1);
    missing.observe(observation(completedAt, { thread: { exists: false } }));
    expect(missing.getSnapshot()).toMatchObject({ status: "stopped", owner: null });

    const rounds = new BackgroundAutoNudgeController(null);
    rounds.start(owner, "2026-07-23T23:59:00.000Z", null, completedAt - 1);
    expect(
      rounds.observe(
        observation(completedAt, {
          settings: { mode: "steady-progress", enabled: true, maxRounds: 1 },
        }),
      ),
    ).not.toBeNull();
    rounds.observe(
      observation(completedAt + 1, {
        settings: { mode: "steady-progress", enabled: true, maxRounds: 1 },
        thread: existingThread({
          terminalTurnKey: "local:thread-a:turn-2",
          latestUserMessageAt: new Date(completedAt).toISOString(),
        }),
      }),
    );
    expect(rounds.getSnapshot()).toMatchObject({ status: "exhausted", sentRounds: 1 });
  });

  it("pauses when a consumed send never projects its automated user row", () => {
    const controller = new BackgroundAutoNudgeController(null);
    controller.start(owner, "2026-07-23T23:59:00.000Z", null, completedAt - 1);
    expect(controller.observe(observation(completedAt))).not.toBeNull();

    controller.observe(
      observation(completedAt + AUTO_NUDGE_PROJECTION_ACK_TIMEOUT_MS, {
        alreadyConsumed: () => true,
      }),
    );

    expect(controller.getSnapshot()).toMatchObject({
      status: "paused",
      reason: "The automated prompt was not projected within 60 seconds; continuation paused.",
    });
  });

  it("retains sent terminal identities through bounded status-ledger churn", () => {
    const controller = new BackgroundAutoNudgeController(null);
    controller.start(owner, "2026-07-23T23:59:00.000Z", null, completedAt - 1);
    controller.observe(observation(completedAt));

    for (let index = 0; index < 50; index += 1) {
      controller.pause(`operator pause ${index}`, completedAt + index + 1);
      controller.resume(completedAt + index + 1);
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
    controller.start(owner, "2026-07-23T23:59:00.000Z", null, completedAt - 1);
    controller.observe(observation(completedAt));
    controller.stop("operator stopped", completedAt + 1);
    controller.start({ environmentId: "local", threadId: "thread-b" }, null, null, completedAt + 2);

    controller.markDispatchFailed("message-auto-1", "late rejection", completedAt + 3);

    expect(controller.getSnapshot()).toMatchObject({
      owner: { environmentId: "local", threadId: "thread-b" },
      status: "active",
      reason: null,
    });
  });
});
