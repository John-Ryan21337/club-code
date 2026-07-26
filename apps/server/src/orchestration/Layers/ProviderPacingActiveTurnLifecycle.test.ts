import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ServerProvider,
} from "@cafecode/contracts";
import { describe, expect, it } from "vitest";

import { makeProviderPacingAdmission } from "./ProviderPacingAdmission.ts";
import { makeProviderPacingActiveTurnLifecycle } from "./ProviderPacingActiveTurnLifecycle.ts";

const environmentId = EnvironmentId.make("environment-a");
const threadId = ThreadId.make("thread-a");
const CHECKED_AT = "2026-07-26T17:00:00.000Z";

function provider(
  input: {
    readonly instanceId?: string;
    readonly email?: string;
    readonly usedPercent?: number;
  } = {},
): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(input.instanceId ?? "claude-primary"),
    driver: ProviderDriverKind.make("claudeAgent"),
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: {
      status: "authenticated",
      type: "oauth",
      email: input.email ?? "user@example.com",
    },
    checkedAt: CHECKED_AT,
    models: [],
    slashCommands: [],
    skills: [],
    accountRateLimits: {
      rateLimits: {
        primary: {
          usedPercent: input.usedPercent ?? 20,
          windowDurationMins: 300,
          resetsAt: 1_800_000_000,
        },
      },
      checkedAt: CHECKED_AT,
    },
  };
}

function makeHarness() {
  const admission = makeProviderPacingAdmission({
    identitySalt: new Uint8Array(32).fill(9),
  });
  const lifecycle = makeProviderPacingActiveTurnLifecycle(admission);
  return { admission, lifecycle };
}

describe("makeProviderPacingActiveTurnLifecycle", () => {
  it("transfers an accepted launch into accounting until projected quiescence", async () => {
    const { admission, lifecycle } = makeHarness();
    const snapshot = provider();
    lifecycle.noteProjectedSession({
      environmentId,
      threadId,
      status: "starting",
    });

    const launch = admission.submitNewLaunch({
      environmentId,
      provider: snapshot,
      dispatchSource: "user",
      launch: () => {
        expect(lifecycle.adoptAcceptedLaunch({ environmentId, provider: snapshot, threadId })).toBe(
          true,
        );
        return "acknowledged";
      },
    });

    await expect(launch.promise).resolves.toBe("acknowledged");
    expect(admission.getCounts()).toEqual({ active: 1, waiting: 0 });
    expect(lifecycle.getCounts()).toEqual({ trackedSessions: 1, activeLeases: 1 });

    lifecycle.noteProjectedSession({
      environmentId,
      threadId,
      status: "ready",
    });
    expect(admission.getCounts()).toEqual({ active: 0, waiting: 0 });
    expect(lifecycle.getCounts()).toEqual({ trackedSessions: 1, activeLeases: 0 });
  });

  it("does not create a lease when terminal truth wins the ACK race", async () => {
    const { admission, lifecycle } = makeHarness();
    const snapshot = provider();
    lifecycle.noteProjectedSession({
      environmentId,
      threadId,
      status: "starting",
    });

    const launch = admission.submitNewLaunch({
      environmentId,
      provider: snapshot,
      dispatchSource: "user",
      launch: () => {
        lifecycle.noteProjectedSession({
          environmentId,
          threadId,
          status: "error",
        });
        expect(lifecycle.adoptAcceptedLaunch({ environmentId, provider: snapshot, threadId })).toBe(
          false,
        );
        return "late-acknowledgement";
      },
    });

    await expect(launch.promise).resolves.toBe("late-acknowledgement");
    expect(admission.getCounts()).toEqual({ active: 0, waiting: 0 });
    expect(lifecycle.getCounts()).toEqual({ trackedSessions: 1, activeLeases: 0 });
  });

  it("adopts already-running work idempotently after startup", () => {
    const { admission, lifecycle } = makeHarness();
    const snapshot = provider();

    expect(lifecycle.adoptObservedRunning({ environmentId, provider: snapshot, threadId })).toBe(
      true,
    );
    expect(lifecycle.adoptObservedRunning({ environmentId, provider: snapshot, threadId })).toBe(
      false,
    );
    expect(admission.getCounts()).toEqual({ active: 1, waiting: 0 });

    lifecycle.noteProjectedSession({
      environmentId,
      threadId,
      status: "interrupted",
    });
    expect(admission.getCounts()).toEqual({ active: 0, waiting: 0 });
  });

  it("does not move an active lease to a different provider account mid-turn", () => {
    const { admission, lifecycle } = makeHarness();
    const originalAccount = provider({ email: "original@example.com" });
    const replacementAccount = provider({ email: "replacement@example.com" });

    expect(
      lifecycle.adoptObservedRunning({
        environmentId,
        provider: originalAccount,
        threadId,
      }),
    ).toBe(true);
    expect(
      lifecycle.adoptObservedRunning({
        environmentId,
        provider: replacementAccount,
        threadId,
      }),
    ).toBe(false);
    expect(admission.getCounts()).toEqual({ active: 1, waiting: 0 });

    lifecycle.noteProjectedSession({
      environmentId,
      threadId,
      status: "ready",
    });
    expect(admission.getCounts()).toEqual({ active: 0, waiting: 0 });
  });

  it("releases only accounting when a thread is forgotten or the layer disposes", () => {
    const { admission, lifecycle } = makeHarness();
    const snapshot = provider();
    expect(lifecycle.adoptObservedRunning({ environmentId, provider: snapshot, threadId })).toBe(
      true,
    );
    expect(lifecycle.forgetThread(environmentId, threadId)).toBe(true);
    expect(lifecycle.forgetThread(environmentId, threadId)).toBe(false);
    expect(admission.getCounts()).toEqual({ active: 0, waiting: 0 });

    expect(lifecycle.adoptObservedRunning({ environmentId, provider: snapshot, threadId })).toBe(
      true,
    );
    lifecycle.dispose();
    lifecycle.dispose();
    expect(admission.getCounts()).toEqual({ active: 0, waiting: 0 });
    expect(lifecycle.getCounts()).toEqual({ trackedSessions: 0, activeLeases: 0 });
  });
});
