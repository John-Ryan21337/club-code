import { ProviderInstanceId } from "@cafecode/contracts";
import { describe, expect, it } from "vitest";

import { ProviderPacingAccountIdentity } from "./providerPacingAccountIdentity.ts";

const salt = new Uint8Array(32).fill(7);

function provider(
  instanceId: string,
  auth: {
    readonly status: "authenticated" | "unauthenticated" | "unknown";
    readonly email?: string;
    readonly label?: string;
    readonly type?: string;
  },
) {
  return {
    instanceId: ProviderInstanceId.make(instanceId),
    auth,
  };
}

describe("ProviderPacingAccountIdentity", () => {
  it("normalizes the same authenticated identity to one opaque account id", () => {
    const identities = new ProviderPacingAccountIdentity(salt);
    const first = identities.forProvider(
      provider("claude-primary", {
        status: "authenticated",
        type: "Claude.AI",
        label: "  Personal Account ",
        email: "User@Example.COM",
      }),
    );
    const normalized = identities.forProvider(
      provider("claude-primary", {
        status: "authenticated",
        type: "claude.ai",
        label: "personal account",
        email: "user@example.com",
      }),
    );

    expect(normalized).toBe(first);
    expect(first).toMatch(/^account:[a-f0-9]{64}$/);
    expect(first).not.toContain("user");
    expect(first).not.toContain("example");
  });

  it("separates different authenticated accounts and process salts", () => {
    const providerA = provider("codex", {
      status: "authenticated",
      type: "chatgpt",
      email: "one@example.com",
    });
    const providerB = provider("codex", {
      status: "authenticated",
      type: "chatgpt",
      email: "two@example.com",
    });

    expect(new ProviderPacingAccountIdentity(salt).forProvider(providerA)).not.toBe(
      new ProviderPacingAccountIdentity(salt).forProvider(providerB),
    );
    expect(new ProviderPacingAccountIdentity(salt).forProvider(providerA)).not.toBe(
      new ProviderPacingAccountIdentity(new Uint8Array(32).fill(8)).forProvider(providerA),
    );
  });

  it("uses a distinct per-instance sentinel when account identity is unresolved", () => {
    const identities = new ProviderPacingAccountIdentity(salt);
    const first = identities.forProvider(
      provider("claude-primary", {
        status: "unknown",
        email: "stale@example.com",
      }),
    );
    const sameInstance = identities.forProvider(
      provider("claude-primary", {
        status: "unauthenticated",
      }),
    );
    const otherInstance = identities.forProvider(
      provider("claude-secondary", {
        status: "unknown",
      }),
    );

    expect(sameInstance).toBe(first);
    expect(first).toMatch(/^unresolved:[a-f0-9]{64}$/);
    expect(otherInstance).not.toBe(first);
  });

  it("copies caller salt material and rejects weak salts", () => {
    const mutableSalt = new Uint8Array(32).fill(1);
    const identities = new ProviderPacingAccountIdentity(mutableSalt);
    const input = provider("codex", {
      status: "authenticated",
      email: "user@example.com",
    });
    const beforeMutation = identities.forProvider(input);
    mutableSalt.fill(2);

    expect(identities.forProvider(input)).toBe(beforeMutation);
    expect(() => new ProviderPacingAccountIdentity(new Uint8Array(15))).toThrow(RangeError);
  });
});
