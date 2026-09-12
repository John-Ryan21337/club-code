import { expect, it, vi } from "vitest";
import { ProviderDriverKind, ProviderInstanceId, ServerSettings } from "@cafecode/contracts";
import * as Schema from "effect/Schema";
import { checkSavedProviderAccess } from "./checkSavedProviderAccess";

const input = { instanceId: ProviderInstanceId.make("claudeAgent"), model: "claude-test" };
const saved = Schema.decodeUnknownSync(ServerSettings)({});
const changed = {
  ...saved,
  providerInstances: {
    [input.instanceId]: {
      driver: ProviderDriverKind.make("claudeAgent"),
      config: { binaryPath: "/synthetic/claude" },
    },
  },
};
const result = { ...input, status: "verified" as const, checkedAt: "2026-09-11T00:00:00.000Z" };

it("does not probe an older saved account after an optimistic save fails", async () => {
  const api = {
    getConfig: vi.fn(async () => ({ settings: saved })),
    checkProviderAccess: vi.fn(async () => result),
  };
  await expect(checkSavedProviderAccess(input, changed, api)).rejects.toThrow(
    "Save provider settings",
  );
  expect(api.checkProviderAccess).not.toHaveBeenCalled();
});

it("rejects a result when persisted settings change during the request", async () => {
  const api = {
    getConfig: vi
      .fn()
      .mockResolvedValueOnce({ settings: saved })
      .mockResolvedValueOnce({ settings: changed }),
    checkProviderAccess: vi.fn(async () => result),
  };
  await expect(checkSavedProviderAccess(input, saved, api)).rejects.toThrow("changed during");
  expect(api.checkProviderAccess).toHaveBeenCalledExactlyOnceWith(input);
});

it("returns the exact result only for matching settings before and after the request", async () => {
  const api = {
    getConfig: vi.fn(async () => JSON.parse(JSON.stringify({ settings: saved }))),
    checkProviderAccess: vi.fn(async () => result),
  };
  await expect(checkSavedProviderAccess(input, saved, api)).resolves.toBe(result);
  expect(api.getConfig).toHaveBeenCalledTimes(2);
});
