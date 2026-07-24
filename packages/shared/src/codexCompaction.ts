// The canonical default lives in `@cafecode/contracts` (the CodexSettings
// `autoCompactTokenLimit` schema default) so `packages/contracts`, which
// cannot depend on `packages/shared`, and every runtime consumer here share
// one source of truth instead of duplicating the magic number.
import { CODEX_ULTRA_CACHING_AUTO_COMPACT_TOKEN_LIMIT } from "@cafecode/contracts";

export {
  CODEX_DEFAULT_AUTO_COMPACT_TOKEN_LIMIT,
  CODEX_ULTRA_CACHING_AUTO_COMPACT_TOKEN_LIMIT,
} from "@cafecode/contracts";
export const CODEX_DEFAULT_AUTO_COMPACT_TOKEN_LIMIT_SCOPE = "total";
export const CODEX_AUTO_COMPACT_POLICY_SOURCE = "cafecode-thread-config";

export function resolveCodexAutoCompactTokenLimit(input: {
  readonly configuredLimit: number;
  readonly ultraCaching: boolean;
}): number {
  return input.ultraCaching
    ? Math.min(input.configuredLimit, CODEX_ULTRA_CACHING_AUTO_COMPACT_TOKEN_LIMIT)
    : input.configuredLimit;
}
