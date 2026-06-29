// The tool layer — retrieval over the memex (the knowledge base) + the dispatcher.
// Retrieval leans on the user's organization + metadata: notes are grouped by their
// folder (an area), ranked by title/folder/snippet overlap. Small corpus ⇒ a linear
// scan beats any index.

import type { CorpusNoteMeta } from "../lib/tauri";
import type { Budget } from "./budget";
import type { Host, NoteHit, ScratchStep, ToolName } from "./types";

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

/** Keyword-rank the corpus for a query — title (×3) + folder/area (×2) + snippet (×1).
 * Boards/files are skipped (they aren't readable text for the model). */
export function rankNotes(notes: CorpusNoteMeta[], query: string, limit: number): NoteHit[] {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
  if (tokens.length === 0) return [];
  const scored: { hit: NoteHit; score: number }[] = [];
  for (const n of notes) {
    if (n.kind === "board" || n.kind === "file") continue;
    const title = n.title.toLowerCase();
    const folder = (n.folderId || "").toLowerCase();
    const snippet = n.snippet.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (title.includes(t)) score += 3;
      if (folder.includes(t)) score += 2;
      if (snippet.includes(t)) score += 1;
    }
    if (score > 0) {
      scored.push({
        hit: { id: n.id, title: n.title, snippet: n.snippet, folder: n.folderId || "" },
        score,
      });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.hit);
}

/** A bounded table-of-contents of the knowledge base, grouped by folder/area. If the
 * FULL per-note index (title + id) fits `maxChars`, the model gets it (small memex —
 * it can read_note by id directly). If it would overflow, the index degrades to an
 * AREAS MAP (area + note count + a few recent titles) so a huge memex never blows the
 * context — the model then drills in with search_notes. Boards/files are skipped. */
export function buildIndex(notes: CorpusNoteMeta[], maxChars = 3500): string {
  const groups = new Map<string, CorpusNoteMeta[]>();
  for (const n of notes) {
    if (n.kind === "board" || n.kind === "file") continue;
    const key = n.folderId || "Notes";
    const arr = groups.get(key);
    if (arr) arr.push(n);
    else groups.set(key, [n]);
  }
  const keys = [...groups.keys()].sort();

  // 1) full per-note index, if it fits the budget
  let full = "";
  for (const key of keys) {
    full += `\n## ${key}\n`;
    for (const n of groups.get(key)!) full += `- ${n.title}  {id: ${n.id}}\n`;
  }
  full = full.trim();
  if (full.length <= maxChars) return full;

  // 2) too big → an areas map: area + count + a few recent titles (no ids → search)
  let out = "";
  for (const key of keys) {
    const arr = groups.get(key)!;
    const recent = [...arr]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 3)
      .map((n) => `- ${n.title}`);
    out += `\n## ${key} (${arr.length})\n${recent.join("\n")}\n`;
    if (out.length > maxChars) {
      out += "\n…(more areas — use search_notes)\n";
      break;
    }
  }
  return out.trim();
}

/** Keep the scratchpad under a char budget so it can't grow unbounded across steps.
 * Oldest results are trimmed first — the most recent (most relevant) stay intact. */
export function pruneScratch(scratch: ScratchStep[], maxChars: number): ScratchStep[] {
  let total = 0;
  for (const e of scratch) total += e.result.length;
  if (total <= maxChars) return scratch;
  const out = scratch.map((e) => ({ action: e.action, result: e.result }));
  for (let i = 0; i < out.length && total > maxChars; i++) {
    const cur = out[i]!;
    if (cur.result.length > 60) {
      const over = total - maxChars;
      const keep = Math.max(40, cur.result.length - over);
      total -= cur.result.length - keep;
      cur.result = `${cur.result.slice(0, keep)}…(trimmed)`;
    }
  }
  return out;
}

export function statusFor(tool: ToolName): string {
  switch (tool) {
    case "search_notes":
      return "searching your notes…";
    case "read_note":
      return "reading a note…";
    case "web_search":
      return "searching the web…";
    case "web_fetch":
      return "reading a web page…";
  }
}

/** Dispatch one tool call to the host, honoring the model's `budget` (hit count,
 * snippet/body caps). Always resolves to an observation string — a tool error becomes
 * feedback the model sees, never a thrown exception. */
export async function runTool(
  host: Host,
  tool: ToolName,
  args: Record<string, unknown>,
  budget: Budget,
): Promise<string> {
  switch (tool) {
    case "search_notes": {
      const q = String(args.query ?? "").trim();
      if (q === "") return 'error: search_notes needs a non-empty "query".';
      const hits = await host.searchNotes(q, budget.maxHits);
      if (hits.length === 0) return "no matching notes — try different words, or the web if it's on.";
      const trimmed = hits.map((h) => ({
        id: h.id,
        title: h.title,
        folder: h.folder,
        snippet: truncate(h.snippet, budget.snippetChars),
      }));
      return JSON.stringify(trimmed);
    }
    case "read_note": {
      const id = String(args.id ?? "").trim();
      if (id === "") return 'error: read_note needs an "id" from search_notes or the index.';
      return truncate(await host.readNote(id), budget.readNoteChars);
    }
    case "web_search": {
      const q = String(args.query ?? "").trim();
      if (q === "") return 'error: web_search needs a "query".';
      const hits = await host.webSearch(q, budget.maxHits);
      if (hits.length === 0) return "no web results.";
      const trimmed = hits.map((h) => ({
        title: h.title,
        url: h.url,
        snippet: truncate(h.snippet, budget.snippetChars),
      }));
      return JSON.stringify(trimmed);
    }
    case "web_fetch": {
      const url = String(args.url ?? "").trim();
      if (url === "") return 'error: web_fetch needs a "url".';
      return truncate(await host.webFetch(url, budget.webFetchChars), budget.webFetchChars);
    }
  }
}
