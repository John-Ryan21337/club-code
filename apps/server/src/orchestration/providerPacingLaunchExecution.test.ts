import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ServerProvider,
} from "@cafecode/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { describe, expect, it, vi } from "vitest";

import { PacingAdmissionCancelledError } from "./boundedPacingAdmission.ts";
import { makeProviderPacingActiveTurnLifecycle } from "./Layers/ProviderPacingActiveTurnLifecycle.ts";
import { makeProviderPacingAdmission } from "./Layers/ProviderPacingAdmission.ts";
import {
  prepareProviderPacingLaunch,
  ProviderPacingLaunchAdmissionError,
} from "./providerPacingLaunchExecution.ts";

const environmentId = EnvironmentId.make("environment-a");
const threadId = ThreadId.make("thread-a");
const CHECKED_AT = "2026-07-26T17:00:00.000Z";

function provider(usedPercent: number): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make("claude-primary"),
    driver: ProviderDriverKind.make("claudeAgent"),
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: {
      status: "authenticated",
      type: "oauth",
      email: "user@example.com",
    },
    checkedAt: CHECKED_AT,
    models: [],
    slashCommands: [],
    skills: [],
    accountRateLimits: {
      rateLimits: {
        primary: {
          usedPercent,
          windowDurationMins: 300,
          resetsAt: 1_800_000_000,
        },
      },
      checkedAt: CHECKED_AT,
    },
  };
}

function makeHarness(snapshot?: ServerProvider) {
  const admission = makeProviderPacingAdmission({
    identitySalt: new Uint8Array(32).fill(7),
  });
  const activeTurnLifecycle = makeProviderPacingActiveTurnLifecycle(admission);
  if (snapshot !== undefined) {
    admission.applyProviderSnapshots({
      environmentId,
      providers: [snapshot],
      settings: { enabled: true, minimumPauseMinutes: 0 },
      observedAtMs: Date.parse(CHECKED_AT),
    });
  }
  return { admission, activeTurnLifecycle };
}

describe("prepareProviderPacingLaunch", () => {
  it("transfers an admitted provider ACK into active-turn accounting", async () => {
    const snapshot = provider(10);
    const { admission, activeTurnLifecycle } = makeHarness(snapshot);
    activeTurnLifecycle.noteProjectedSession({ environmentId, threadId, status: "starting" });

    const execution = prepareProviderPacingLaunch({
      admission,
      activeTurnLifecycle,
      environmentId,
      provider: snapshot,
      threadId,
      dispatchSource: "user",
      launch: Effect.succeed("acknowledged"),
    });

    await expect(Effect.runPromise(execution.result)).resolves.toEqual({
      status: "launched",
      value: "acknowledged",
    });
    expect(admission.getCounts()).toEqual({ active: 1, waiting: 0 });
    expect(activeTurnLifecycle.getCounts().activeLeases).toBe(1);
  });

  it("fails Auto Nudge fast without retaining a delayed launch", async () => {
    const snapshot = provider(95);
    const { admission, activeTurnLifecycle } = makeHarness(snapshot);
    const launch = vi.fn(() => "must-not-run");

    const execution = prepareProviderPacingLaunch({
      admission,
      activeTurnLifecycle,
      environmentId,
      provider: snapshot,
      threadId,
      dispatchSource: "auto-nudge",
      launch: Effect.sync(launch),
    });

    await expect(Effect.runPromise(execution.result)).resolves.toEqual({ status: "deferred" });
    expect(launch).not.toHaveBeenCalled();
    expect(execution.cancelWaiting()).toBe(false);
    expect(admission.getCounts()).toEqual({ active: 0, waiting: 0 });
  });

  it("lets an explicit interrupt cancel a waiting manual launch", async () => {
    const snapshot = provider(95);
    const { admission, activeTurnLifecycle } = makeHarness(snapshot);
    const launch = vi.fn(() => "must-not-run");
    const execution = prepareProviderPacingLaunch({
      admission,
      activeTurnLifecycle,
      environmentId,
      provider: snapshot,
      threadId,
      dispatchSource: "user",
      launch: Effect.sync(launch),
    });

    expect(admission.getCounts().waiting).toBe(1);
    expect(execution.cancelWaiting()).toBe(true);
    const error = await Effect.runPromise(
      execution.result.pipe(
        Effect.match({
          onFailure: (failure) => failure,
          onSuccess: () => null,
        }),
      ),
    );
    expect(error).toBeInstanceOf(ProviderPacingLaunchAdmissionError);
    expect((error as ProviderPacingLaunchAdmissionError).cause).toBeInstanceOf(
      PacingAdmissionCancelledError,
    );
    expect(launch).not.toHaveBeenCalled();
  });

  it("cannot cancel provider work after admission begins", async () => {
    const snapshot = provider(10);
    const { admission, activeTurnLifecycle } = makeHarness(snapshot);
    let finish!: () => void;
    const providerWork = new Promise<string>((resolve) => {
      finish = () => resolve("acknowledged");
    });
    const execution = prepareProviderPacingLaunch({
      admission,
      activeTurnLifecycle,
      environmentId,
      provider: snapshot,
      threadId,
      dispatchSource: "user",
      launch: Effect.promise(() => providerWork),
    });

    expect(execution.cancelWaiting()).toBe(false);
    expect(admission.getCounts().active).toBe(1);
    finish();
    await expect(Effect.runPromise(execution.result)).resolves.toMatchObject({
      status: "launched",
    });
  });

  it("lets admitted provider work finish after its waiting result fiber is interrupted", async () => {
    const snapshot = provider(10);
    const { admission, activeTurnLifecycle } = makeHarness(snapshot);
    activeTurnLifecycle.noteProjectedSession({ environmentId, threadId, status: "starting" });
    let finishProviderWork!: () => void;
    let confirmProviderFinished!: () => void;
    const providerWork = new Promise<void>((resolve) => {
      finishProviderWork = resolve;
    });
    const providerFinished = new Promise<void>((resolve) => {
      confirmProviderFinished = resolve;
    });
    const execution = prepareProviderPacingLaunch({
      admission,
      activeTurnLifecycle,
      environmentId,
      provider: snapshot,
      threadId,
      dispatchSource: "user",
      launch: Effect.promise(() => providerWork).pipe(
        Effect.tap(() => Effect.sync(confirmProviderFinished)),
      ),
    });

    const waitingResultFiber = Effect.runFork(execution.result);
    await Effect.runPromise(Fiber.interrupt(waitingResultFiber));
    expect(execution.cancelWaiting()).toBe(false);
    expect(admission.getCounts().active).toBe(1);

    finishProviderWork();
    await providerFinished;
    await Promise.resolve();

    expect(admission.getCounts()).toEqual({ active: 1, waiting: 0 });
    expect(activeTurnLifecycle.getCounts().activeLeases).toBe(1);
  });
});
