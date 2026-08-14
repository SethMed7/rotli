import type { ModelUsageSummary, ModelUsageTokens, ModelUsageTotal } from "../lib/tauri";

/**
 * API-equivalent USD rates per token. These are deliberately a small,
 * versioned table for models Rotli can identify exactly from provider-owned
 * histories. Unknown or ambiguous aliases stay unpriced instead of quietly
 * inheriting a family rate.
 *
 * Snapshot: 2026-08-12. This is a comparison estimate, never a subscription
 * invoice. Update this table deliberately when provider-owned pricing changes.
 */
interface ModelRate {
  input: number;
  cachedInput: number;
  cacheCreation: number;
  output: number;
}

const MODEL_RATES: Readonly<Record<string, ModelRate>> = {
  "claude:claude-sonnet-5": {
    input: 2e-6,
    cachedInput: 0.2e-6,
    cacheCreation: 2.5e-6,
    output: 10e-6,
  },
  "claude:claude-opus-5": {
    input: 5e-6,
    cachedInput: 0.5e-6,
    cacheCreation: 6.25e-6,
    output: 25e-6,
  },
  "claude:claude-fable-5": {
    input: 10e-6,
    cachedInput: 1e-6,
    cacheCreation: 12.5e-6,
    output: 50e-6,
  },
  "codex:gpt-5.6-sol": {
    input: 5e-6,
    cachedInput: 0.5e-6,
    cacheCreation: 6.25e-6,
    output: 30e-6,
  },
  "codex:gpt-5.6-terra": {
    input: 2e-6,
    cachedInput: 0.2e-6,
    cacheCreation: 2.5e-6,
    output: 12e-6,
  },
  "codex:gpt-5.6-luna": {
    input: 0.2e-6,
    cachedInput: 0.02e-6,
    cacheCreation: 0.25e-6,
    output: 1.2e-6,
  },
  "codex:gpt-5.5": {
    input: 5e-6,
    cachedInput: 0.5e-6,
    cacheCreation: 6.25e-6,
    output: 30e-6,
  },
  "codex:gpt-5.4": {
    input: 2.5e-6,
    cachedInput: 0.25e-6,
    cacheCreation: 3.125e-6,
    output: 15e-6,
  },
  "codex:gpt-5.4-mini": {
    input: 0.75e-6,
    cachedInput: 0.075e-6,
    cacheCreation: 0.9375e-6,
    output: 4.5e-6,
  },
};

function normalizedModel(model: string): string {
  const value = model.trim().toLowerCase();
  const slash = value.lastIndexOf("/");
  return slash >= 0 ? value.slice(slash + 1) : value;
}

function rateFor(provider: string, model: string): ModelRate | null {
  return MODEL_RATES[`${provider}:${normalizedModel(model)}`] ?? null;
}

export interface ModelCostEstimate {
  usd: number;
  pricedTokens: number;
  unpricedTokens: number;
}

export function estimatedModelCost(model: ModelUsageTotal): ModelCostEstimate {
  const rate = rateFor(model.provider, model.model);
  const tokens = usageTokenTotal(model.tokens);
  if (!rate) return { usd: 0, pricedTokens: 0, unpricedTokens: tokens };
  return {
    usd:
      model.tokens.uncachedInputTokens * rate.input +
      model.tokens.cachedInputTokens * rate.cachedInput +
      model.tokens.cacheCreationTokens * rate.cacheCreation +
      model.tokens.outputTokens * rate.output,
    pricedTokens: tokens,
    unpricedTokens: 0,
  };
}

export function modelUsageCost(models: readonly ModelUsageTotal[]): ModelCostEstimate {
  return models.reduce(
    (total, model) => {
      const estimate = estimatedModelCost(model);
      total.usd += estimate.usd;
      total.pricedTokens += estimate.pricedTokens;
      total.unpricedTokens += estimate.unpricedTokens;
      return total;
    },
    { usd: 0, pricedTokens: 0, unpricedTokens: 0 },
  );
}

export function formatUsageUsd(value: number): string {
  if (value > 0 && value < 0.01) return "<$0.01";
  if (value >= 1_000) return `$${Math.round(value).toLocaleString()}`;
  if (value >= 100) return `$${value.toFixed(0)}`;
  if (value >= 10) return `$${value.toFixed(1)}`;
  return `$${value.toFixed(2)}`;
}

export function usageTokenTotal(tokens: ModelUsageTokens): number {
  return (
    tokens.uncachedInputTokens + tokens.cachedInputTokens + tokens.cacheCreationTokens + tokens.outputTokens
  );
}

export function compactUsageNumber(value: number): string {
  if (value < 1_000) return Math.round(value).toLocaleString();
  if (value < 1_000_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}K`;
  if (value < 1_000_000_000) return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 1 : 0)}M`;
  return `${(value / 1_000_000_000).toFixed(value < 10_000_000_000 ? 1 : 0)}B`;
}

export function modelUsageSnapshot(summary: ModelUsageSummary | undefined) {
  const models = [...(summary?.models ?? [])].sort(
    (a, b) => usageTokenTotal(b.tokens) - usageTokenTotal(a.tokens),
  );
  const totals = models.reduce(
    (value, model) => ({
      tokens: value.tokens + usageTokenTotal(model.tokens),
      output: value.output + model.tokens.outputTokens,
      reasoning: value.reasoning + model.tokens.reasoningTokens,
      cached: value.cached + model.tokens.cachedInputTokens,
      cacheCreation: value.cacheCreation + model.tokens.cacheCreationTokens,
      uncached: value.uncached + model.tokens.uncachedInputTokens,
      responses: value.responses + model.responses,
    }),
    { tokens: 0, output: 0, reasoning: 0, cached: 0, cacheCreation: 0, uncached: 0, responses: 0 },
  );
  const input = totals.cached + totals.cacheCreation + totals.uncached;
  return {
    ...totals,
    sessions: summary?.totalSessions ?? 0,
    cacheShare: input > 0 ? totals.cached / input : 0,
    models,
    favorite: models[0] ?? null,
  };
}

export function modelUsageTrend(summary: ModelUsageSummary | undefined): Array<{
  at: number;
  tokens: number;
}> {
  if (!summary) return [];
  const byTime = new Map<number, number>();
  for (let at = summary.sinceMs; at < summary.untilMs; at += summary.bucketMs) byTime.set(at, 0);
  for (const bucket of summary.buckets) {
    byTime.set(
      bucket.bucketStartMs,
      (byTime.get(bucket.bucketStartMs) ?? 0) + usageTokenTotal(bucket.tokens),
    );
  }
  return [...byTime].map(([at, tokens]) => ({ at, tokens }));
}

export function providerTotals(models: readonly ModelUsageTotal[]) {
  const totals = new Map<
    string,
    { tokens: number; responses: number; sessions: number; cost: ModelCostEstimate }
  >();
  for (const model of models) {
    const current = totals.get(model.provider) ?? {
      tokens: 0,
      responses: 0,
      sessions: 0,
      cost: { usd: 0, pricedTokens: 0, unpricedTokens: 0 },
    };
    const estimate = estimatedModelCost(model);
    current.tokens += usageTokenTotal(model.tokens);
    current.responses += model.responses;
    current.sessions += model.sessions;
    current.cost.usd += estimate.usd;
    current.cost.pricedTokens += estimate.pricedTokens;
    current.cost.unpricedTokens += estimate.unpricedTokens;
    totals.set(model.provider, current);
  }
  return [...totals].sort((a, b) => b[1].tokens - a[1].tokens);
}
