import type {
  ServerProviderAccessInput,
  ServerProviderAccessResult,
  ServerSettings,
} from "@cafecode/contracts";
import * as Equal from "effect/Equal";

type ProviderSettings = Pick<ServerSettings, "providers" | "providerInstances">;

/** Failed optimistic saves must not verify the account that was saved before them. */
export async function checkSavedProviderAccess(
  input: ServerProviderAccessInput,
  displayed: ProviderSettings | undefined,
  api: {
    getConfig: () => Promise<{ settings: ProviderSettings }>;
    checkProviderAccess: (input: ServerProviderAccessInput) => Promise<ServerProviderAccessResult>;
  },
): Promise<ServerProviderAccessResult> {
  const matches = (saved: ProviderSettings) =>
    displayed !== undefined &&
    Equal.equals(displayed.providers, saved.providers) &&
    Equal.equals(displayed.providerInstances, saved.providerInstances);
  if (!displayed || !matches((await api.getConfig()).settings)) {
    throw new Error("Save provider settings before checking access.");
  }
  const result = await api.checkProviderAccess(input);
  if (!matches((await api.getConfig()).settings)) {
    throw new Error("Provider settings changed during the access check.");
  }
  return result;
}
