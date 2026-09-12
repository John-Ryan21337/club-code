import { ProviderInstanceId, type ServerProvider } from "@cafecode/contracts";
import * as Effect from "effect/Effect";
import { expect, it, vi } from "vitest";
import { refreshProviderUsage } from "./refreshProviderUsage.ts";

it("returns cached snapshots without invoking any provider when instance identity is absent", async () => {
  const cached: ServerProvider[] = [];
  const usage = vi.fn(() => Effect.succeed(cached));
  const registry = { getProviders: Effect.succeed(cached), refreshInstanceAccountUsage: usage };
  expect(await Effect.runPromise(refreshProviderUsage(registry, undefined))).toBe(cached);
  expect(usage).not.toHaveBeenCalled();
});

it("routes only the exact selected instance to usage refresh", async () => {
  const usage = vi.fn(() => Effect.succeed([] as ServerProvider[]));
  const registry = {
    getProviders: Effect.succeed([] as ServerProvider[]),
    refreshInstanceAccountUsage: usage,
  };
  const instanceId = ProviderInstanceId.make("second-codex-account");
  await Effect.runPromise(refreshProviderUsage(registry, instanceId));
  expect(usage).toHaveBeenCalledExactlyOnceWith(instanceId);
});
