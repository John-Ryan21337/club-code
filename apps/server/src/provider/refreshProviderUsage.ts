import type { ProviderInstanceId } from "@cafecode/contracts";
import type { ProviderRegistryShape } from "./Services/ProviderRegistry.ts";

/** Usage polling has exact-instance admission and never falls back to full probes. */
export function refreshProviderUsage(
  registry: Pick<ProviderRegistryShape, "getProviders" | "refreshInstanceAccountUsage">,
  instanceId: ProviderInstanceId | undefined,
) {
  return instanceId === undefined
    ? registry.getProviders
    : registry.refreshInstanceAccountUsage(instanceId);
}
