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
  /** tool-use step cap */
  maxSteps: number;
}

export interface ModelMeta {
  id: string;
}

/** Approx context window (tokens), inferred from the model id family (with a
 * conservative default). The client uses this to size every retrieval budget. */
export function contextWindowFor(model: ModelMeta): number {
  const id = model.id.toLowerCase();
  if (id.includes("gemma-3") || id.includes("gemma3") || id.includes("gemma4")) return 128_000;
  if (id.includes("qwen2.5") || id.includes("qwen3") || id.includes("1.5b") || id.includes("3b")) return 32_000;
  return 8_000;
}

/** The retrieval budget for a model — a few tiers by context window. */
export function budgetFor(model: ModelMeta): Budget {
  const ctx = contextWindowFor(model);
  if (ctx >= 64_000) {
    return {
      maxHits: 6,
      snippetChars: 160,
      readNoteChars: 2000,
      webFetchChars: 6000,
      maxIndexChars: 3500,
      maxScratchChars: 9000,
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
    maxSteps: 4,
  };
}
