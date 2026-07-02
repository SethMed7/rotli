// Context budgets — the client's rules for HOW MUCH it feeds the model, sized to the
// MODEL. A small-context model gets a tight prompt (compact index, fewer/shorter
// results, an aggressively pruned scratchpad); a large-context one gets more. This is
// what keeps tool-use from blowing the window AND keeps the model on RELEVANT notes
// (the index degrades to an areas map instead of dumping every note).

export interface Budget {
  /** max results returned by search_notes / web_search */
  maxHits: number;
  /** per-result snippet cap (chars) */
  snippetChars: number;
  /** read_note body cap (chars) */
  readNoteChars: number;
  /** web_fetch page cap (chars) */
  webFetchChars: number;
  /** knowledge-index cap — a full per-note index is used only if it fits this; else
   *  the index collapses to an areas map (counts + a few titles) */
  maxIndexChars: number;
  /** total scratchpad cap fed back each step (oldest results trimmed first) */
  maxScratchChars: number;
  /** conversation-history cap fed into every prompt (oldest turns trimmed
   *  first) — a long chat must not overflow a small model's window (#65) */
  maxHistoryChars: number;
  /** tool-use step cap */
  maxSteps: number;
}

export interface ModelMeta {
  id: string;
  /** Transport hint: "cli" = a connected subscription CLI (frontier-class);
   * "openai"/"generate" = the local server wire shapes. Optional — existing
   * `{ id }` callers keep their local tiers untouched. */
  api?: string;
}

/** Approx context window (tokens), inferred from the model id family (with a
 * conservative default). The client uses this to size every retrieval budget. */
export function contextWindowFor(model: ModelMeta): number {
  const id = model.id.toLowerCase();
  // the connected lanes (subscription CLIs + the Gemini key lane) are all
  // 200k-class. Checked FIRST, and strictly above the local families, so no
  // local id can drift into the frontier tier (nor the reverse).
  if (
    model.api === "cli" ||
    /\b(sonnet|opus|haiku|fable)\b/.test(id) ||
    id.includes("gpt-5") ||
    id.includes("gemini-")
  ) {
    return 200_000;
  }
  if (id.includes("gemma-3") || id.includes("gemma3") || id.includes("gemma4")) return 128_000;
  if (id.includes("qwen2.5") || id.includes("qwen3") || id.includes("1.5b") || id.includes("3b")) return 32_000;
  return 8_000;
}

/** The retrieval budget for a model — a few tiers by context window. */
export function budgetFor(model: ModelMeta): Budget {
  const ctx = contextWindowFor(model);
  // the frontier tier sits ABOVE the local 128k family on purpose — gemma-3
  // (128k) must keep its tuned local budget, not inherit the frontier one
  if (ctx >= 180_000) {
    return {
      maxHits: 8,
      snippetChars: 220,
      readNoteChars: 6000,
      webFetchChars: 12_000,
      maxIndexChars: 6000,
      maxScratchChars: 20_000,
      maxHistoryChars: 24_000,
      maxSteps: 8,
    };
  }
  if (ctx >= 64_000) {
    return {
      maxHits: 6,
      snippetChars: 160,
      readNoteChars: 2000,
      webFetchChars: 6000,
      maxIndexChars: 3500,
      maxScratchChars: 9000,
      maxHistoryChars: 12_000,
      maxSteps: 5,
    };
  }
  if (ctx >= 24_000) {
    return {
      maxHits: 5,
      snippetChars: 120,
      readNoteChars: 1400,
      webFetchChars: 4000,
      maxIndexChars: 2000,
      maxScratchChars: 5000,
      maxHistoryChars: 6000,
      maxSteps: 5,
    };
  }
  // small context (≤ ~8k): be frugal
  return {
    maxHits: 4,
    snippetChars: 90,
    readNoteChars: 900,
    webFetchChars: 2500,
    maxIndexChars: 1200,
    maxScratchChars: 3000,
    maxHistoryChars: 2500,
    maxSteps: 4,
  };
}
