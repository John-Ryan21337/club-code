import { expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@cafecode/contracts";
import {
  correlateSnapshotWithSource,
  mergeProviderSnapshot,
  mergeProviderAccountRateLimitSnapshot,
} from "./Layers/ProviderRegistry.ts";

const provider: ServerProvider = {
  instanceId: ProviderInstanceId.make("synthetic-claude"),
  driver: ProviderDriverKind.make("claudeAgent"),
  enabled: true,
  installed: true,
  status: "ready",
  version: "2.1.266",
  checkedAt: "2026-09-12T00:00:00Z",
  auth: { status: "authenticated", type: "max", email: "synthetic@example.invalid" },
  models: [],
  slashCommands: [],
  skills: [],
  accountRateLimits: {
    checkedAt: "2026-09-12T00:00:00Z",
    rateLimits: { primary: { usedPercent: 20 } },
    paidUsage: { status: "enabled", checkedAt: "2026-09-12T00:00:00Z", used: "12" },
  },
};
it("retains Claude usage only for the same authenticated account", () => {
  const { accountRateLimits: _, ...withoutUsage } = provider;
  expect(mergeProviderSnapshot(provider, withoutUsage).accountRateLimits).toEqual(
    provider.accountRateLimits,
  );
  for (const auth of [
    { status: "unauthenticated" },
    { status: "authenticated", type: "max", email: "other@example.invalid" },
    { status: "authenticated", type: "apiKey" },
  ] as const) {
    expect(
      mergeProviderSnapshot(provider, { ...withoutUsage, auth }).accountRateLimits,
    ).toBeUndefined();
  }
});
it("preserves separately dated paid metadata across a sparse quota event", () => {
  const result = mergeProviderAccountRateLimitSnapshot({
    previous: provider.accountRateLimits,
    limitId: "claude-sonnet",
    snapshot: { secondary: { usedPercent: 40 } },
    checkedAt: "2026-09-12T01:00:00Z",
  });
  expect(result.paidUsage).toEqual(provider.accountRateLimits!.paidUsage);
  expect(result.checkedAt).toBe("2026-09-12T01:00:00Z");
});
it("honors an explicit unsupported usage capability even when a driver has the method", async () => {
  const snapshot = {
    ...provider,
    runtimeCapabilities: {
      liveSteer: "supported",
      threadGoals: "unsupported",
      accountUsage: false,
    },
  } as const;
  const result = await Effect.runPromise(
    correlateSnapshotWithSource(
      {
        instanceId: provider.instanceId,
        driverKind: provider.driver,
        getSnapshot: Effect.succeed(snapshot),
        refresh: Effect.succeed(snapshot),
        refreshModels: Effect.succeed(snapshot),
        refreshAccountUsage: Effect.succeed(snapshot),
        streamChanges: Stream.empty,
      },
      snapshot,
    ),
  );
  expect(result.runtimeCapabilities?.accountUsage).toBe(false);
});

it("does not renew untouched windows when a named bucket receives a sparse notification", () => {
  const oldTime = "2026-09-12T00:00:00Z";
  const newTime = "2026-09-12T01:00:00Z";
  const result = mergeProviderAccountRateLimitSnapshot({
    previous: {
      checkedAt: oldTime,
      rateLimits: { primary: { usedPercent: 20 } },
      rateLimitsByLimitId: {
        codex: { primary: { usedPercent: 20 }, secondary: { usedPercent: 30 } },
        other: { secondary: { usedPercent: 40 } },
      },
    },
    limitId: "codex",
    snapshot: { primary: { usedPercent: 25 } },
    checkedAt: newTime,
  });
  expect(result.rateLimits.primary?.checkedAt).toBe(newTime);
  expect(result.rateLimits.secondary?.checkedAt).toBe(oldTime);
  expect(result.rateLimitsByLimitId?.other?.secondary?.checkedAt).toBe(oldTime);
  expect(result.checkedAt).toBe(newTime);
});
