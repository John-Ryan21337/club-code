import { describe, expect, it } from "vitest";

import {
  approvedProviderCliVersion,
  approvedVersionForNpmPackage,
  normalizeProviderVersionOutput,
  PROVIDER_COMPATIBILITY_MATRIX,
} from "./providerCompatibility.ts";

describe("provider compatibility matrix", () => {
  it("pins exact public CLI and protocol versions", () => {
    expect(approvedProviderCliVersion("codex")).toBe("0.169.1");
    expect(approvedProviderCliVersion("claude")).toBe("2.1.327");
    expect(PROVIDER_COMPATIBILITY_MATRIX.providers.codex.protocolRef).toHaveLength(40);
    expect(PROVIDER_COMPATIBILITY_MATRIX.providers.claude.agentSdkVersion).toBe("0.3.327");
  });

  it("maps only compatibility-managed npm packages", () => {
    expect(approvedVersionForNpmPackage("@openai/codex")).toBe("0.169.1");
    expect(approvedVersionForNpmPackage("@anthropic-ai/claude-code")).toBe("2.1.327");
    expect(approvedVersionForNpmPackage("opencode-ai")).toBeNull();
  });

  it("strictly decodes provider version probes", () => {
    expect(normalizeProviderVersionOutput("codex", "codex-cli 0.169.1\n")).toBe("0.169.1");
    expect(normalizeProviderVersionOutput("claude", "2.1.327 (Claude Code)\n")).toBe("2.1.327");
    expect(normalizeProviderVersionOutput("codex", "warning\ncodex-cli 0.169.1")).toBe("0.169.1");
    expect(
      normalizeProviderVersionOutput("claude", "update available\n2.1.327 (Claude Code)"),
    ).toBe("2.1.327");
    expect(normalizeProviderVersionOutput("codex", "warning only")).toBeNull();
    expect(normalizeProviderVersionOutput("claude", "update available\n2.1.304")).toBeNull();
    expect(normalizeProviderVersionOutput("claude", "2.1.327+local (Claude Code)")).toBe("2.1.327");
    expect(normalizeProviderVersionOutput("claude", "2.1.304-rc.1 (Claude Code)")).toBe(
      "2.1.304-rc.1",
    );
  });
});
