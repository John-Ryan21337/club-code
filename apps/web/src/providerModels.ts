import {
  DEFAULT_MODEL,
  DEFAULT_MODEL_BY_PROVIDER,
  defaultInstanceIdForDriver,
  ProviderDriverKind,
  type ModelCapabilities,
  type ProviderInstanceId,
  type ServerProvider,
  type ServerProviderModel,
} from "@cafecode/contracts";
import { createModelCapabilities, normalizeModelSlug } from "@cafecode/shared/model";

const EMPTY_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
});
const DEFAULT_DRIVER_KIND = ProviderDriverKind.make("codex");

export function formatProviderDriverKindLabel(provider: ProviderDriverKind): string {
  return provider
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function getProviderModels(
  providers: ReadonlyArray<ServerProvider>,
  provider: ProviderDriverKind,
): ReadonlyArray<ServerProviderModel> {
  return getProviderSnapshot(providers, provider)?.models ?? [];
}

export function getProviderSnapshot(
  providers: ReadonlyArray<ServerProvider>,
  provider: ProviderDriverKind,
): ServerProvider | undefined {
  const defaultInstanceId = defaultInstanceIdForDriver(provider);
  return providers.find((candidate) => candidate.instanceId === defaultInstanceId);
}

export function getProviderDisplayName(
  providers: ReadonlyArray<ServerProvider>,
  provider: ProviderDriverKind,
): string {
  const snapshot = getProviderSnapshot(providers, provider);
  return snapshot?.displayName?.trim() || formatProviderDriverKindLabel(provider);
}

export function getProviderInteractionModeToggle(
  providers: ReadonlyArray<ServerProvider>,
  provider: ProviderDriverKind,
): boolean {
  return getProviderSnapshot(providers, provider)?.showInteractionModeToggle ?? true;
}

export function isProviderEnabled(
  providers: ReadonlyArray<ServerProvider>,
  provider: ProviderDriverKind,
): boolean {
  if (providers.length === 0) {
    return true;
  }
  return getProviderSnapshot(providers, provider)?.enabled ?? false;
}

// Resolve an instance selection to the correlated live driver. If the
// instance is absent, fall back to a live enabled provider instead of
// inferring a driver from the missing instance id.
export function resolveSelectableProvider(
  providers: ReadonlyArray<ServerProvider>,
  provider: ProviderDriverKind | ProviderInstanceId | null | undefined,
): ProviderDriverKind {
  const requestedEntry = providers.find((candidate) => candidate.instanceId === provider);
  if (requestedEntry?.enabled) {
    return requestedEntry.driver;
  }
  return providers.find((candidate) => candidate.enabled)?.driver ?? DEFAULT_DRIVER_KIND;
}

export function getProviderModelCapabilities(
  models: ReadonlyArray<ServerProviderModel>,
  model: string | null | undefined,
  provider: ProviderDriverKind,
): ModelCapabilities {
  const slug = normalizeModelSlug(model, provider);
  const caps = models.find((candidate) => candidate.slug === slug)?.capabilities;
  if (!caps) return EMPTY_CAPABILITIES;
  // Composer defaults are a product preference. Keep the provider snapshot
  // intact, and let explicit saved selections override these defaults later.
  return {
    ...caps,
    optionDescriptors: (caps.optionDescriptors ?? [])
      .map((descriptor) => {
        if (descriptor.type !== "select") return descriptor;
        const isEffort = ["reasoningEffort", "effort", "variant"].includes(descriptor.id);
        const isContext = descriptor.id === "contextWindow";
        if (!isEffort && !isContext) return descriptor;
        const concreteOptions = descriptor.options.filter(
          (option) =>
            !/^(?:cli[\s_-]*)?default$/i.test(option.id) &&
            !/^(?:cli[\s_-]*)?default$/i.test(option.label),
        );
        const options = concreteOptions;
        const contextSize = (id: string) => {
          const match = /^(\d+(?:\.\d+)?)([km])?$/i.exec(id);
          return match
            ? Number(match[1]) * (match[2]?.toLowerCase() === "m" ? 1e6 : match[2] ? 1e3 : 1)
            : Infinity;
        };
        const smallestContext = isContext
          ? options
              .filter((option) => Number.isFinite(contextSize(option.id)))
              .toSorted((a, b) => contextSize(a.id) - contextSize(b.id))[0]?.id
          : undefined;
        const defaultValue =
          isEffort &&
          options.some((option) => option.id === "high") &&
          !descriptor.promptInjectedValues?.includes("high")
            ? "high"
            : (smallestContext ??
              options.find((option) => option.isDefault)?.id ??
              options.find((option) => option.id === descriptor.currentValue)?.id ??
              options[0]?.id);
        return {
          ...descriptor,
          label: isEffort ? "Reasoning effort" : "Context window",
          ...(defaultValue ? { currentValue: defaultValue } : {}),
          options: options.map((option) => ({ ...option, isDefault: option.id === defaultValue })),
        };
      })
      .filter((descriptor) => descriptor.type !== "select" || descriptor.options.length > 0),
  };
}

export function getDefaultServerModel(
  providers: ReadonlyArray<ServerProvider>,
  provider: ProviderDriverKind,
): string {
  const models = getProviderModels(providers, provider);
  return (
    models.find((model) => !model.isCustom)?.slug ??
    models[0]?.slug ??
    DEFAULT_MODEL_BY_PROVIDER[provider] ??
    DEFAULT_MODEL
  );
}
