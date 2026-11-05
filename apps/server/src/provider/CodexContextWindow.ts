import type { ModelSelection, ProviderOptionDescriptor } from "@cafecode/contracts";

// Exact input-context capacities from the pinned Codex 0.166.0 model catalog.
// These are configurable budgets, not larger capacities for unknown/local models.
const CAPACITIES: Readonly<Record<string, readonly [number, number]>> = {
  "gpt-6-astra": [272_000, 872_000],
  "gpt-6.1-sol": [272_000, 872_000],
  "gpt-6.1-terra": [500_000, 872_000],
  "gpt-6-sol": [272_000, 872_000],
  "gpt-6-luna": [272_000, 872_000],
  "gpt-5.6-sol": [272_000, 872_000],
  "gpt-5.6-terra": [272_000, 872_000],
  "gpt-5.6-luna": [272_000, 872_000],
  "gpt-daybreak-blue-latest": [272_000, 872_000],
  "gpt-daybreak-red-latest": [372_000, 372_000],
  "gpt-5.5": [272_000, 272_000],
};

export function codexContextWindowDescriptor(model: string): ProviderOptionDescriptor | undefined {
  const capacity = Object.hasOwn(CAPACITIES, model) ? CAPACITIES[model] : undefined;
  if (!capacity) return undefined;
  return {
    id: "contextWindow",
    label: "Context",
    type: "select",
    currentValue: "200k",
    options: [...new Set([200_000, ...capacity])].map((tokens) => ({
      id: `${tokens / 1000}k`,
      label: `${tokens / 1000}K tokens`,
      ...(tokens === 200_000 ? { isDefault: true } : {}),
    })),
  };
}

export function resolveCodexContextWindow(
  selection: ModelSelection | undefined,
  ossMode = false,
): number | undefined {
  if (ossMode || !selection) return undefined;
  const descriptor = codexContextWindowDescriptor(selection.model);
  if (descriptor?.type !== "select") return undefined;
  const saved = selection.options?.find((option) => option.id === "contextWindow")?.value;
  const option = descriptor.options.find((option) => option.id === saved);
  return option ? Number(option.id.slice(0, -1)) * 1000 : 200_000;
}
