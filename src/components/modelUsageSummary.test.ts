import { describe, expect, test } from "bun:test";

import type { ModelUsageSummary } from "../lib/tauri";
import {
  compactUsageNumber,
  estimatedModelCost,
  formatUsageUsd,
  modelUsageCost,
  modelUsageSnapshot,
  modelUsageTrend,
} from "./modelUsageSummary";

const summary: ModelUsageSummary = {
  range: "7d",
  readAtMs: 700,
  sinceMs: 0,
  untilMs: 700,
  bucketMs: 100,
  totalSessions: 2,
  sources: [],
  buckets: [
    {
      bucketStartMs: 100,
      provider: "claude",
      model: "sonnet",
      tokens: {
        uncachedInputTokens: 10,
        cachedInputTokens: 20,
        cacheCreationTokens: 0,
        outputTokens: 5,
        reasoningTokens: 0,
      },
      responses: 1,
      sessions: 1,
    },
    {
      bucketStartMs: 100,
      provider: "codex",
      model: "sol",
      tokens: {
        uncachedInputTokens: 5,
        cachedInputTokens: 0,
        cacheCreationTokens: 0,
        outputTokens: 5,
        reasoningTokens: 2,
      },
      responses: 1,
      sessions: 1,
    },
  ],
  models: [
    {
      provider: "claude",
      model: "sonnet",
      tokens: {
        uncachedInputTokens: 10,
        cachedInputTokens: 20,
        cacheCreationTokens: 0,
        outputTokens: 5,
        reasoningTokens: 0,
      },
      responses: 1,
      sessions: 1,
    },
    {
      provider: "codex",
      model: "sol",
      tokens: {
        uncachedInputTokens: 5,
        cachedInputTokens: 0,
        cacheCreationTokens: 0,
        outputTokens: 5,
        reasoningTokens: 2,
      },
      responses: 1,
      sessions: 1,
    },
  ],
};

describe("model usage projection", () => {
  test("keeps reasoning as an output subset and preserves exact session totals", () => {
    const value = modelUsageSnapshot(summary);
    expect(value.tokens).toBe(45);
    expect(value.output).toBe(10);
    expect(value.reasoning).toBe(2);
    expect(value.sessions).toBe(2);
    expect(value.favorite?.model).toBe("sonnet");
  });

  test("fills empty chart buckets without duplicating provider buckets", () => {
    expect(modelUsageTrend(summary).map((point) => point.tokens)).toEqual([0, 45, 0, 0, 0, 0, 0]);
  });

  test("formats compact totals without fake precision", () => {
    expect(compactUsageNumber(999)).toBe("999");
    expect(compactUsageNumber(1_250)).toBe("1.3K");
    expect(compactUsageNumber(14_000_000)).toBe("14M");
  });

  test("prices only exact, recognized model ids and keeps unknown usage visible", () => {
    const priced = estimatedModelCost({
      ...summary.models[0]!,
      model: "claude-sonnet-5",
    });
    expect(priced.pricedTokens).toBe(35);
    expect(priced.unpricedTokens).toBe(0);
    expect(priced.usd).toBeCloseTo(0.000074, 12);

    const combined = modelUsageCost(summary.models);
    expect(combined.usd).toBe(0);
    expect(combined.pricedTokens).toBe(0);
    expect(combined.unpricedTokens).toBe(45);
  });

  test("formats estimated dollars without suggesting excessive precision", () => {
    expect(formatUsageUsd(0)).toBe("$0.00");
    expect(formatUsageUsd(0.005)).toBe("<$0.01");
    expect(formatUsageUsd(12.34)).toBe("$12.3");
    expect(formatUsageUsd(1_234.56)).toBe("$1,235");
  });
});
