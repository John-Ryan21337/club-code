import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@cafecode/contracts";
import { describe, expect, it } from "vitest";

import {
  PacingAdmissionDisposedError,
  PacingAdmissionRetiredError,
} from "../boundedPacingAdmission.ts";
import { makeProviderPacingAdmission } from "./ProviderPacingAdmission.ts";

const environmentId = EnvironmentId.make("environment-a");
const CHECKED_AT = "2026-07-26T17:00:00.000Z";
const CHECKED_AT_MS = Date.parse(CHECKED_AT);

function provider(input: {
  readonly usedPercent: number;
  readonly email?: string;
}): ServerProvider {
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
      email: input.email ?? "user@example.com",
    },
    checkedAt: CHECKED_AT,
    models: [],
    slashCommands: [],
    skills: [],
    accountRateLimits: {
      rateLimits: {
        primary: {
          usedPercent: input.usedPercent,
          windowDurationMins: 300,
          resetsAt: 1_800_000_000,
        },
      },
      checkedAt: CHECKED_AT,
    },
  };
}

function observe(
  service: ReturnType<typeof makeProviderPacingAdmission>,
  providers: ReadonlyArray<ServerProvider>,
) {
  service.applyProviderSnapshots({
    environmentId,
    providers,
    settings: { enabled: true, minimumPauseMinutes: 0 },
    observedAtMs: CHECKED_AT_MS,
  });
}

describe("makeProviderPacingAdmission", () => {
  it("shares one exact provider key between observation and launch admission", async () => {
    const service = makeProviderPacingAdmission({
      identitySalt: new Uint8Array(32).fill(4),
    });
    const snapshot = provider({ usedPercent: 20 });
    observe(service, [snapshot]);

    await expect(
      service.submitNewLaunch({
        environmentId,
        provider: snapshot,
        dispatchSource: "auto-nudge",
        launch: () => "started",
      }).promise,
    ).resolves.toBe("started");
    expect(service.getCounts()).toEqual({ active: 0, waiting: 0 });
    expect(service.getSnapshot(environmentId, snapshot)?.phase).toBe("running");
  });

  it("keeps a closed provider launch queued until the provider is removed", async () => {
    const service = makeProviderPacingAdmission({
      identitySalt: new Uint8Array(32).fill(4),
    });
    const snapshot = provider({ usedPercent: 95 });
    observe(service, [snapshot]);
    const waiting = service.submitNewLaunch({
      environmentId,
      provider: snapshot,
      dispatchSource: "auto-nudge",
      launch: () => "must-not-start",
    });
    expect(service.getCounts().waiting).toBe(1);

    observe(service, []);
    await expect(waiting.promise).rejects.toBeInstanceOf(PacingAdmissionRetiredError);
    expect(service.getCounts().waiting).toBe(0);
  });

  it("uses opaque, account-specific keys without exposing auth identity", () => {
    const service = makeProviderPacingAdmission({
      identitySalt: new Uint8Array(32).fill(4),
    });
    const first = service.getKey(
      environmentId,
      provider({ usedPercent: 20, email: "first@example.com" }),
    );
    const second = service.getKey(
      environmentId,
      provider({ usedPercent: 20, email: "second@example.com" }),
    );

    expect(first).toMatchObject({
      environmentId: "environment-a",
      providerInstanceId: "claude-primary",
      providerAccountId: expect.stringMatching(/^account:[a-f0-9]{64}$/),
    });
    expect(first.providerAccountId).not.toBe(second.providerAccountId);
    expect(JSON.stringify([first, second])).not.toContain("@example.com");
  });

  it("rejects queued work on shutdown without owning active provider cancellation", async () => {
    const service = makeProviderPacingAdmission({
      identitySalt: new Uint8Array(32).fill(4),
    });
    const snapshot = provider({ usedPercent: 95 });
    observe(service, [snapshot]);
    const waiting = service.submitNewLaunch({
      environmentId,
      provider: snapshot,
      dispatchSource: "auto-nudge",
      launch: () => "must-not-start",
    });

    service.dispose();
    await expect(waiting.promise).rejects.toBeInstanceOf(PacingAdmissionDisposedError);
    expect(service.getCounts()).toEqual({ active: 0, waiting: 0 });
  });
});
