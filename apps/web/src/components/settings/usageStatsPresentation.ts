import type { ProviderDriverKind, UsageStatsTokenBreakdownEntry } from "@cafecode/contracts";

export interface UsageModelBreakdownView {
  readonly model: string;
  readonly outputTokens: number;
}

export interface UsageProviderBreakdownView {
  readonly provider: ProviderDriverKind;
  readonly outputTokens: number;
  readonly models: ReadonlyArray<UsageModelBreakdownView>;
}

export interface UsageTokenBreakdownView {
  readonly providers: ReadonlyArray<UsageProviderBreakdownView>;
  readonly attributedOutputTokens: number;
  readonly unattributedOutputTokens: number;
}

export interface UsageModelEfficiencyView {
  readonly model: string;
  readonly cachedInputTokens: number;
  readonly cacheWriteInputTokens: number;
  readonly compactedInputTokens: number;
}

export interface UsageProviderEfficiencyView {
  readonly provider: ProviderDriverKind;
  readonly cachedInputTokens: number;
  readonly cacheWriteInputTokens: number;
  readonly compactedInputTokens: number;
  readonly models: ReadonlyArray<UsageModelEfficiencyView>;
}

export interface UsageTokenEfficiencyView {
  readonly providers: ReadonlyArray<UsageProviderEfficiencyView>;
  readonly cachedInputTokens: number;
  readonly cacheWriteInputTokens: number;
  readonly compactedInputTokens: number;
  readonly maxModelCachedInputTokens: number;
  readonly maxModelCompactedInputTokens: number;
}

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

/**
 * Collapse defensive duplicate rows and prepare a deterministic dense view.
 * The server normally returns one row per provider/model, but merging here
 * keeps stale or mixed-version servers from rendering duplicated model lines.
 */
export function buildUsageTokenBreakdownView(
  rows: ReadonlyArray<UsageStatsTokenBreakdownEntry>,
  lifetimeOutputTokens: number,
): UsageTokenBreakdownView {
  const byProvider = new Map<ProviderDriverKind, Map<string, number>>();

  for (const row of rows) {
    if (row.outputTokens <= 0) {
      continue;
    }
    let models = byProvider.get(row.provider);
    if (models === undefined) {
      models = new Map();
      byProvider.set(row.provider, models);
    }
    models.set(row.model, (models.get(row.model) ?? 0) + row.outputTokens);
  }

  const providers = Array.from(byProvider.entries(), ([provider, models]) => {
    const modelRows = Array.from(models.entries(), ([model, outputTokens]) => ({
      model,
      outputTokens,
    })).toSorted(
      (left, right) =>
        right.outputTokens - left.outputTokens || compareText(left.model, right.model),
    );
    return {
      provider,
      outputTokens: modelRows.reduce((sum, row) => sum + row.outputTokens, 0),
      models: modelRows,
    };
  }).toSorted(
    (left, right) =>
      right.outputTokens - left.outputTokens || compareText(left.provider, right.provider),
  );

  const attributedOutputTokens = providers.reduce(
    (sum, provider) => sum + provider.outputTokens,
    0,
  );

  return {
    providers,
    attributedOutputTokens,
    // Migration 61 intentionally did not guess provider/model attribution for
    // older aggregate rows. Surface that honest remainder instead of silently
    // making the visible provider totals appear to equal lifetime usage.
    unattributedOutputTokens: Math.max(0, lifetimeOutputTokens - attributedOutputTokens),
  };
}

/**
 * Build per-model efficiency signals without combining them into a synthetic
 * "tokens saved" billing number. Cache reuse is provider-reported, context
 * removal is locally observed across compaction, and cache writes are useful
 * overhead diagnostics; the three counters have different semantics.
 */
export function buildUsageTokenEfficiencyView(
  rows: ReadonlyArray<UsageStatsTokenBreakdownEntry>,
): UsageTokenEfficiencyView {
  const byProvider = new Map<
    ProviderDriverKind,
    Map<string, Omit<UsageModelEfficiencyView, "model">>
  >();

  for (const row of rows) {
    if (
      row.cachedInputTokens <= 0 &&
      row.cacheWriteInputTokens <= 0 &&
      row.compactedInputTokens <= 0
    ) {
      continue;
    }
    let models = byProvider.get(row.provider);
    if (models === undefined) {
      models = new Map();
      byProvider.set(row.provider, models);
    }
    const current = models.get(row.model) ?? {
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      compactedInputTokens: 0,
    };
    models.set(row.model, {
      cachedInputTokens: current.cachedInputTokens + row.cachedInputTokens,
      cacheWriteInputTokens: current.cacheWriteInputTokens + row.cacheWriteInputTokens,
      compactedInputTokens: current.compactedInputTokens + row.compactedInputTokens,
    });
  }

  let maxModelCachedInputTokens = 0;
  let maxModelCompactedInputTokens = 0;
  const providers = Array.from(byProvider.entries(), ([provider, models]) => {
    const modelRows = Array.from(models.entries(), ([model, counters]) => {
      maxModelCachedInputTokens = Math.max(maxModelCachedInputTokens, counters.cachedInputTokens);
      maxModelCompactedInputTokens = Math.max(
        maxModelCompactedInputTokens,
        counters.compactedInputTokens,
      );
      return { model, ...counters };
    }).toSorted(
      (left, right) =>
        right.cachedInputTokens +
          right.compactedInputTokens -
          (left.cachedInputTokens + left.compactedInputTokens) ||
        compareText(left.model, right.model),
    );
    return {
      provider,
      cachedInputTokens: modelRows.reduce((sum, row) => sum + row.cachedInputTokens, 0),
      cacheWriteInputTokens: modelRows.reduce((sum, row) => sum + row.cacheWriteInputTokens, 0),
      compactedInputTokens: modelRows.reduce((sum, row) => sum + row.compactedInputTokens, 0),
      models: modelRows,
    };
  }).toSorted(
    (left, right) =>
      right.cachedInputTokens +
        right.compactedInputTokens -
        (left.cachedInputTokens + left.compactedInputTokens) ||
      compareText(left.provider, right.provider),
  );

  return {
    providers,
    cachedInputTokens: providers.reduce((sum, provider) => sum + provider.cachedInputTokens, 0),
    cacheWriteInputTokens: providers.reduce(
      (sum, provider) => sum + provider.cacheWriteInputTokens,
      0,
    ),
    compactedInputTokens: providers.reduce(
      (sum, provider) => sum + provider.compactedInputTokens,
      0,
    ),
    maxModelCachedInputTokens,
    maxModelCompactedInputTokens,
  };
}

export function formatUsageProviderLabel(provider: ProviderDriverKind): string {
  switch (provider) {
    case "codex":
      return "Codex";
    case "claudeAgent":
      return "Claude";
    case "opencode":
      return "OpenCode";
    default:
      return provider
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/[_-]+/g, " ")
        .trim()
        .replace(/\b\w/g, (character) => character.toUpperCase());
  }
}

export function formatUsageModelLabel(model: string): string {
  return model === "unknown" ? "Unknown model" : model;
}

export function formatUsagePercentage(part: number, whole: number): string {
  if (part <= 0 || whole <= 0) {
    return "0%";
  }
  const percentage = Math.min(100, (part / whole) * 100);
  if (percentage < 0.1) {
    return "<0.1%";
  }
  return percentage < 10 ? `${percentage.toFixed(1)}%` : `${Math.round(percentage)}%`;
}
