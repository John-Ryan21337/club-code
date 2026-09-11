export const PROVIDER_COMPATIBILITY_MATRIX = {
  schemaVersion: 1,
  approvedAt: "2026-09-07",
  providers: {
    codex: {
      cliVersion: "0.153.4",
      npmPackage: "@openai/codex",
      protocolRef: "3d2ee51ca2d5db578f328aa75e20aa22c0197c9a",
    },
    claude: {
      cliVersion: "2.1.224",
      npmPackage: "@anthropic-ai/claude-code",
      agentSdkVersion: "0.3.239",
    },
  },
  requiredGates: [
    "fmt:check",
    "lint",
    "typecheck",
    "test",
    "build:desktop",
    "provider-conformity-smoke",
  ],
} as const;

export type ProviderCompatibilityName = keyof typeof PROVIDER_COMPATIBILITY_MATRIX.providers;

export function approvedProviderCliVersion(provider: ProviderCompatibilityName): string {
  return PROVIDER_COMPATIBILITY_MATRIX.providers[provider].cliVersion;
}

export function approvedVersionForNpmPackage(packageName: string): string | null {
  for (const provider of Object.values(PROVIDER_COMPATIBILITY_MATRIX.providers)) {
    if (provider.npmPackage === packageName) {
      return provider.cliVersion;
    }
  }
  return null;
}

export function normalizeProviderVersionOutput(
  provider: ProviderCompatibilityName,
  output: string,
): string | null {
  for (const line of output.split(/\r?\n/u)) {
    const trimmed = line.trim();
    const match =
      provider === "codex"
        ? /^codex-cli\s+(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\+[0-9A-Za-z.-]+)?$/u.exec(trimmed)
        : /^(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\+[0-9A-Za-z.-]+)?\s+\(Claude Code\)$/u.exec(
            trimmed,
          );
    if (match?.[1]) return match[1];
  }
  return null;
}
