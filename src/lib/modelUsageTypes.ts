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

/** The summary a shell that cannot inspect this computer answers with. */
export function emptyModelUsage(range: ModelUsageRange): ModelUsageSummary {
  return {
    range,
    readAtMs: Date.now(),
    sinceMs: Date.now(),
    untilMs: Date.now(),
    bucketMs: range === "24h" ? 60 * 60 * 1_000 : 24 * 60 * 60 * 1_000,
    totalSessions: 0,
    buckets: [],
    models: [],
    sources: [
      {
        provider: "claude",
        status: "missing",
        scannedFiles: 0,
        skippedFiles: 0,
        malformedRecords: 0,
        message: "The browser twin does not inspect this computer.",
      },
      {
        provider: "codex",
        status: "missing",
        scannedFiles: 0,
        skippedFiles: 0,
        malformedRecords: 0,
        message: "The browser twin does not inspect this computer.",
      },
    ],
  };
}
