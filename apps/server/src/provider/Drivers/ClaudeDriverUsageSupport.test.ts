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

  it("accepts the decorated subscription strings the Claude CLI actually reports", () => {
    // Regression: a live `auth.type` of "Claude Max" reported account usage as
    // unsupported, which disabled the `/usage` probe and the sidebar refresh,
    // leaving the widget with only a reset time and "usage unknown".
    for (const type of [
      "Claude Max",
      "Claude Max Subscription",
      "Claude Max 20x Subscription",
      "claude_max",
      "Claude Pro Subscription",
      "Claude Team Subscription",
      "Claude Enterprise Subscription",
    ]) {
      expect(
        supportsClaudeAccountUsage(
          claudeProvider({
            auth: { status: "authenticated", type, email: "operator@example.com" },
          }),
        ),
      ).toBe(true);
    }
  });

  it("still refuses unentitled authentication however it is decorated", () => {
    for (const type of ["Claude Free Subscription", "free", "Anthropic API Key"]) {
      expect(
        supportsClaudeAccountUsage(
          claudeProvider({
            auth: { status: "authenticated", type, email: "operator@example.com" },
          }),
        ),
      ).toBe(false);
    }
  });
});
