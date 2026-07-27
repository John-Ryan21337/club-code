import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@cafecode/contracts";
import { describe, expect, it } from "vitest";

import { supportsClaudeAccountUsage } from "./ClaudeDriver.ts";

function claudeProvider(overrides: Partial<ServerProvider> = {}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make("claude"),
    driver: ProviderDriverKind.make("claudeAgent"),
    enabled: true,
    installed: true,
    version: "2.1.216",
    status: "ready",
    auth: {
      status: "authenticated",
      type: "max",
      email: "operator@example.com",
    },
    checkedAt: "2026-07-27T09:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    ...overrides,
  };
}

describe("supportsClaudeAccountUsage", () => {
  it("requires a reviewed subscription auth type and minimum CLI version", () => {
    expect(supportsClaudeAccountUsage(claudeProvider())).toBe(true);
    expect(
      supportsClaudeAccountUsage(
        claudeProvider({
          version: "2.1.215",
        }),
      ),
    ).toBe(false);
    expect(supportsClaudeAccountUsage(claudeProvider({ version: "unknown" }))).toBe(false);
    expect(
      supportsClaudeAccountUsage(
        claudeProvider({
          auth: { status: "authenticated", type: "apiKey" },
        }),
      ),
    ).toBe(false);
    expect(
      supportsClaudeAccountUsage(
        claudeProvider({
          auth: { status: "authenticated" },
        }),
      ),
    ).toBe(false);
    expect(
      supportsClaudeAccountUsage(
        claudeProvider({
          auth: { status: "unauthenticated", type: "max" },
        }),
      ),
    ).toBe(false);
  });
});
