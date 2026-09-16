// The shapes of `model_usage` (Settings → Models → Usage): counts only, never
// transcript text, paths, prompts, responses, or session identifiers. Kept
// beside the seam that returns them (./tauri.ts re-exports these names).

export type ModelUsageRange = "24h" | "7d" | "30d" | "90d";

export interface ModelUsageTokens {
  uncachedInputTokens: number;
  cachedInputTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  /** A subset of output tokens; never add it to a total. */
  reasoningTokens: number;
}

export interface ModelUsageBucket {
  bucketStartMs: number;
  provider: "claude" | "codex";
  model: string;
  tokens: ModelUsageTokens;
  responses: number;
  sessions: number;
}

export interface ModelUsageTotal {
  provider: "claude" | "codex";
  model: string;
  tokens: ModelUsageTokens;
  responses: number;
  sessions: number;
}

export interface ModelUsageSource {
  provider: "claude" | "codex";
  status: "ok" | "missing" | "partial";
  scannedFiles: number;
  skippedFiles: number;
  malformedRecords: number;
  message?: string;
}

export interface ModelUsageSummary {
  range: ModelUsageRange;
  readAtMs: number;
  sinceMs: number;
  untilMs: number;
  bucketMs: number;
  totalSessions: number;
  buckets: ModelUsageBucket[];
  models: ModelUsageTotal[];
  sources: ModelUsageSource[];
}
