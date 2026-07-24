import { CODEX_ULTRA_CACHING_AUTO_COMPACT_TOKEN_LIMIT } from "@cafecode/contracts";

export { CODEX_ULTRA_CACHING_AUTO_COMPACT_TOKEN_LIMIT } from "@cafecode/contracts";

// Without an explicit override or Ultra Caching, Codex app-server resolves the
// model-specific threshold and accounting scope, matching the official CUI.
export const CODEX_AUTO_COMPACT_POLICY_SOURCE = "codex-app-server";

export function resolveCodexAutoCompactTokenLimit(input: {
  readonly configuredLimit: number | undefined;
  readonly ultraCaching: boolean;
}): number | undefined {
  if (!input.ultraCaching) {
    return input.configuredLimit;
  }
  return input.configuredLimit === undefined
    ? CODEX_ULTRA_CACHING_AUTO_COMPACT_TOKEN_LIMIT
    : Math.min(input.configuredLimit, CODEX_ULTRA_CACHING_AUTO_COMPACT_TOKEN_LIMIT);
}
