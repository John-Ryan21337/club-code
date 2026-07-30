import { describe, expect, it } from "vitest";

import type { AutoNudgeThreadPolicy } from "./autoNudgeThreadPolicy";
import {
  AUTO_NUDGE_PROJECTION_ACK_TIMEOUT_MS,
  BackgroundAutoNudgeController,
  decideBackgroundAutoNudgeRootAction,
  type BackgroundAutoNudgeObservation,
} from "./backgroundAutoNudger";

function storageFixture() {
  const values = new Map<string, string>();
  return {
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  };
}

const owner = { environmentId: "local", threadId: "thread-a" };
const completedAt = Date.parse("2026-07-24T00:00:00.000Z");
const latestUserMessageAt = "2026-07-23T23:59:00.000Z";
const backgroundPolicy: AutoNudgeThreadPolicy = {
  mode: "steady-progress",
  backgroundContinuation: true,
  maxRounds: 5,
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
  it("dispatches immediately from a newly completed response", () => {
    const controller = new BackgroundAutoNudgeController(null);
    expect(
      controller.start(owner, latestUserMessageAt, null, backgroundPolicy, completedAt - 1),
    ).toBe(true);

    expect(controller.observe(observation(completedAt))).toMatchObject({
      owner,
      terminalTurnKey: "local:thread-a:turn-1",
      prompt: expect.stringContaining("Select the highest-priority unblocked operator ask"),
      messageId: "message-auto-1",
      round: 1,
    });
    expect(controller.getSnapshot()).toMatchObject({
      status: "active",
      sentRounds: 1,
      baselineTerminalTurnKey: "local:thread-a:turn-1",
    });
  });

  it("baselines an already-completed response when background mode starts", () => {
    const controller = new BackgroundAutoNudgeController(null);
    controller.start(
      owner,
      "2026-07-23T23:59:00.000Z",
      "local:thread-a:turn-1",
      backgroundPolicy,
      completedAt - 1,
    );

    expect(controller.observe(observation(completedAt))).toBeNull();
    expect(
      controller.observe(
        observation(completedAt + 1, {
          thread: existingThread({ terminalTurnKey: "local:thread-a:turn-2" }),
        }),
      ),
    ).not.toBeNull();
  });

  it("does not dispatch from wall-clock passage without a completed response", () => {
    const controller = new BackgroundAutoNudgeController(null);
    controller.start(owner, latestUserMessageAt, null, backgroundPolicy, completedAt - 1);

    expect(
      controller.observe(
        observation(completedAt + 60_000, {
          thread: existingThread({ isRunning: true, terminalTurnKey: null }),
        }),
      ),
    ).toBeNull();
    expect(
      controller.observe(
        observation(completedAt + 24 * 60 * 60_000, {
          thread: existingThread({ terminalTurnKey: null }),
        }),
      ),
    ).toBeNull();
    expect(controller.getSnapshot().sentRounds).toBe(0);
  });

  it("deduplicates repeated completion observations across reloads", () => {
    const { storage } = storageFixture();
    const beforeReload = new BackgroundAutoNudgeController(storage);
    beforeReload.start(owner, latestUserMessageAt, null, backgroundPolicy, completedAt - 1);
    expect(beforeReload.observe(observation(completedAt))).not.toBeNull();

    const afterReload = new BackgroundAutoNudgeController(storage);
    expect(afterReload.observe(observation(completedAt))).toBeNull();
    expect(afterReload.getSnapshot().sentRounds).toBe(1);
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
      controller.start(owner, "2026-07-23T23:59:00.000Z", null, backgroundPolicy, completedAt - 1);
      expect(controller.observe(observation(completedAt, { thread }))).toBeNull();
      expect(controller.getSnapshot()).toMatchObject({ status: "paused", reason });
    }
  });

  it("exhausts only the configured round cap", () => {
    const controller = new BackgroundAutoNudgeController(null);
    controller.start(
      owner,
      latestUserMessageAt,
      null,
      { ...backgroundPolicy, maxRounds: 1 },
      completedAt - 1,
    );
    expect(controller.observe(observation(completedAt))).not.toBeNull();

    expect(
      controller.observe(
        observation(completedAt + 1, {
          thread: existingThread({ terminalTurnKey: "local:thread-a:turn-2" }),
        }),
      ),
    ).toBeNull();
    expect(controller.getSnapshot()).toMatchObject({
      status: "exhausted",
      reason: "Round cap reached (1).",
    });
  });

  it("pauses if the consumed prompt is not projected within the ACK timeout", () => {
    const controller = new BackgroundAutoNudgeController(null);
    controller.start(owner, latestUserMessageAt, null, backgroundPolicy, completedAt - 1);
    expect(controller.observe(observation(completedAt))).not.toBeNull();

    expect(
      controller.observe(
        observation(completedAt + AUTO_NUDGE_PROJECTION_ACK_TIMEOUT_MS, {
          alreadyConsumed: () => true,
        }),
      ),
    ).toBeNull();
    expect(controller.getSnapshot()).toMatchObject({
      status: "paused",
      reason: "The automated prompt was not projected within 60 seconds; continuation paused.",
    });
  });

  it("fails closed for an invalid or disabled thread policy", () => {
    const controller = new BackgroundAutoNudgeController(null);
    expect(
      controller.start(
        owner,
        null,
        null,
        { ...backgroundPolicy, backgroundContinuation: false },
        completedAt,
      ),
    ).toBe(false);
    expect(controller.getSnapshot().owner).toBeNull();
  });

  it("scopes pause and stop mutations to the exact owner", () => {
    const controller = new BackgroundAutoNudgeController(null);
    controller.start(owner, null, null, backgroundPolicy, completedAt);
    const other = { environmentId: "local", threadId: "thread-b" };

    controller.pause(other, "wrong owner", completedAt + 1);
    controller.stop(other, "wrong owner", completedAt + 2);
    expect(controller.getSnapshot()).toMatchObject({ owner, status: "active" });
  });
});

describe("background root decision", () => {
  it("requires exact-thread manual queue truth before root observation", () => {
    expect(decideBackgroundAutoNudgeRootAction(false)).toBe("pause-missing-manual-queue-truth");
    expect(decideBackgroundAutoNudgeRootAction(true)).toBe("observe-exact-thread");
  });
});
