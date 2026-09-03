export interface ChatMemoryDocument {
  slug: string;
  title: string;
  body: string;
  modifiedMs: number;
}

export interface RankedChatMemory {
  id: string;
  title: string;
  snippet: string;
  source: "chat";
  score: number;
}

export interface KeywordSearchHit {
  id: string;
  rank: number;
  updatedAt: number;
}

/** Merge exact-phrase + per-keyword note searches. Title hits and the complete
 * phrase score highest; recency only breaks relevance ties. */
export function mergeKeywordHits<T extends KeywordSearchHit>(resultSets: readonly T[][]): T[] {
  const merged = new Map<string, { hit: T; score: number }>();
  resultSets.forEach((hits, queryIndex) => {
    for (const hit of hits) {
      // ranks 0–1 are title hits (whole query, or every word), 2+ body/index hits
      const score = (hit.rank <= 1 ? 8 : 4) + (queryIndex === 0 ? 6 : 0);
      const previous = merged.get(hit.id);
      if (previous) previous.score += score;
      else merged.set(hit.id, { hit, score });
    }
  });
  return [...merged.values()]
    .sort(
      (a, b) => b.score - a.score || b.hit.updatedAt - a.hit.updatedAt || a.hit.id.localeCompare(b.hit.id),
    )
    .map((entry) => entry.hit);
}

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "and",
  "are",
  "before",
  "can",
  "did",
  "for",
  "from",
  "have",
  "how",
  "into",
  "its",
  "notes",
  "past",
  "that",
  "the",
  "their",
  "this",
  "was",
  "we",
  "what",
  "when",
  "where",
  "with",
  "you",
  "your",
  "in",
  "chat",
  "chats",
  "conversation",
  "conversations",
]);

/** Transparent keyword extraction for the master memory search. No embeddings
 * or hidden index: the same words can be inspected and reproduced. */
export function memoryKeywords(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((word) => word.length > 1 && !STOP_WORDS.has(word)),
    ),
  ];
}

function snippetAround(body: string, keywords: readonly string[], max = 260): string {
  const compact = body
    .replace(/^---[\s\S]*?---\s*/m, "")
    .replace(/\s+/g, " ")
    .trim();
  const lower = compact.toLowerCase();
  const positions = keywords.map((word) => lower.indexOf(word)).filter((at) => at >= 0);
  const at = positions.length ? Math.min(...positions) : 0;
  const start = Math.max(0, at - 70);
  const slice = compact.slice(start, start + max);
  return `${start > 0 ? "…" : ""}${slice}${start + max < compact.length ? "…" : ""}`;
}

export function rankChatMemories(
  chats: readonly ChatMemoryDocument[],
  query: string,
  limit: number,
): RankedChatMemory[] {
  const keywords = memoryKeywords(query);
  if (!keywords.length) return [];
  return chats
    .map((chat) => {
      const title = chat.title.toLowerCase();
      const body = chat.body.toLowerCase();
      let score = 0;
      for (const keyword of keywords) {
        if (title.includes(keyword)) score += 6;
        const matches = body.split(keyword).length - 1;
        score += Math.min(matches, 4);
      }
      return {
        id: `chat:${chat.slug}`,
        title: chat.title,
        snippet: snippetAround(chat.body, keywords),
        source: "chat" as const,
        score,
        modifiedMs: chat.modifiedMs,
      };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || b.modifiedMs - a.modifiedMs || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, limit))
    .map(({ modifiedMs: _modifiedMs, ...result }) => result);
}
