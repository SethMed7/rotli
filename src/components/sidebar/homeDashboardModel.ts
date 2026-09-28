import { NOW_TICK_MS } from "../../lib/useNow";
import type { NoteSummary } from "../../types";

export const WEEK_MS = 7 * 24 * 60 * 60 * 1_000;

/** In the window [since, now]. `nowMs` is a ticking clock, so anything up to one
 * tick past it (a new vault's Welcome lessons, made just after the tick) is
 * "now"; a timestamp further ahead is clock skew and stays out. */
export function inWindow(ts: number, since: number, nowMs: number): boolean {
  return ts >= since && ts <= nowMs + NOW_TICK_MS;
}

/** A truthful snapshot from fields Rotli already owns. These are note counts,
 * not invented word/authorship telemetry; the corpus does not yet record
 * per-edit human-vs-AI attribution. */
export function homeDashboardSnapshot(
  notes: readonly NoteSummary[],
  chatModels: Record<string, string>,
  chats: readonly { slug: string; modifiedMs: number }[],
  nowMs: number,
  windowMs = WEEK_MS,
) {
  const since = nowMs - windowMs;
  const modelIds = chats.flatMap((chat) => {
    const id = chatModels[chat.slug];
    return id ? [id] : [];
  });
  const counts = new Map<string, number>();
  for (const id of modelIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  let favoriteModelId: string | null = null;
  let favoriteCount = 0;
  for (const chat of chats) {
    const id = chatModels[chat.slug];
    const count = id ? (counts.get(id) ?? 0) : 0;
    if (id && count > favoriteCount) {
      favoriteModelId = id;
      favoriteCount = count;
    }
  }
  return {
    notes: {
      newInRange: notes.filter((note) => inWindow(note.createdAt, since, nowMs)).length,
      updatedInRange: notes.filter((note) => inWindow(note.updatedAt, since, nowMs)).length,
      total: notes.length,
    },
    chat: {
      activeInRange: chats.filter((chat) => inWindow(chat.modifiedMs, since, nowMs)).length,
      total: chats.length,
      modelsUsed: new Set(modelIds).size,
      favoriteModelId,
    },
  };
}
