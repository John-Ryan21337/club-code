import {
  CODEX_AUTO_DELEGATE_OPTION_ID,
  CODEX_SUBAGENT_THREAD_LIMIT_OPTION_ID,
  type ProviderDriverKind,
  type ProviderOptionSelection,
} from "@cafecode/contracts";
import {
  getProviderOptionBooleanSelectionValue,
  parseCodexSubagentThreadLimitOption,
} from "@cafecode/shared/model";

/** Keep thread controls outside the model capability descriptor list. */
export function getProviderThreadOptions(
  provider: ProviderDriverKind,
  options: ReadonlyArray<ProviderOptionSelection> | null | undefined,
): ReadonlyArray<ProviderOptionSelection> {
  if (provider !== "codex") return [];
  const limit = parseCodexSubagentThreadLimitOption(options);
  const autoDelegate = getProviderOptionBooleanSelectionValue(
    options,
    CODEX_AUTO_DELEGATE_OPTION_ID,
  );
  return [
    ...(limit === null
      ? []
      : [{ id: CODEX_SUBAGENT_THREAD_LIMIT_OPTION_ID, value: String(limit) }]),
    ...(autoDelegate === undefined
      ? []
      : [{ id: CODEX_AUTO_DELEGATE_OPTION_ID, value: autoDelegate }]),
  ];
}
