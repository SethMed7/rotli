// The tool layer — retrieval over the memex (the knowledge base) + the dispatcher.
// Retrieval leans on the user's organization + metadata: notes are grouped by their
// folder (an area), ranked by title/folder/snippet overlap. Small corpus ⇒ a linear
// scan beats any index.

import type { CorpusNoteMeta } from "../lib/tauri";
export { buildIndex } from "../memex/modelMap";
import type { Budget } from "./budget";
import type { Host, NoteHit, ScratchStep, ToolName } from "./types";

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

/** Strip a LEADING frontmatter fence from a model-authored note body. The
 * model reads notes as full file text (fences included), so a faithful
 * rewrite often echoes the metadata back — but the write lane (corpus_write)
 * preserves frontmatter itself, and passing the fence through would embed a
 * duplicate copy INSIDE the body. Content only crosses the write boundary. */
export function stripLeadingFrontmatter(body: string): string {
  // fence lines tolerate trailing spaces — gemma emits "--- \n" (live eval
  // 2026-07-30, the frontmatter-leak case)
  const m = body.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*\n?/);
  if (!m) return body;
  // strip ONLY a block that reads as metadata (key: value lines, plus yaml
  // list/continuation lines) — a body OPENING with a thematic break must not
  // lose real prose sitting between two --- lines (Greptile PR #19)
  const lines = (m[1] ?? "").split("\n").filter((line) => line.trim() !== "");
  const metadataish =
    lines.length > 0 && lines.every((line) => /^([A-Za-z_][\w-]*[ \t]*:|[ \t]|-)/.test(line));
  if (!metadataish) return body;
  return body.slice(m[0].length).replace(/^\n+/, "");
}

/** Truncate a READ body (note / memory / file) with an EXPLICIT marker. A bare
 * "…" read as end-of-content and the model presented partial lists as complete
 * (the 2026-07-29 people-list failure); the marker names what was cut so the
 * model can qualify its answer, and the prompts teach it to. */
export function truncateBody(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n[…truncated — the remaining ${s.length - max} characters were not shown]`;
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
    case "search_memory":
      return "searching your memory…";
    case "read_note":
      return "reading a note…";
    case "create_note":
      return "creating a note…";
    case "update_note":
      return "updating the note…";
    case "open_note":
      return "opening the note…";
    case "read_memory":
      return "reading a memory…";
    case "read_file":
      return "reading a file…";
    case "web_search":
      return "searching the web…";
    case "web_fetch":
      return "reading a web page…";
    case "generate_image":
      return "generating an image…";
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
    case "search_memory": {
      const q = String(args.query ?? "").trim();
      if (q === "") return 'error: search_memory needs a non-empty "query".';
      const hits = host.searchMemory
        ? await host.searchMemory(q, budget.maxHits)
        : (await host.searchNotes(q, budget.maxHits)).map((hit) => ({
            id: hit.id,
            title: hit.title,
            snippet: hit.snippet,
            source: "note" as const,
          }));
      return hits.length
        ? JSON.stringify(hits.map((hit) => ({ ...hit, snippet: truncate(hit.snippet, budget.snippetChars) })))
        : "no matching notes or chats — try fewer or different keywords.";
    }
    case "read_memory": {
      const id = String(args.id ?? "").trim();
      if (!id) return 'error: read_memory needs an "id" from search_memory.';
      const body = host.readMemory
        ? await host.readMemory(id)
        : id.startsWith("chat:")
          ? "error: this host cannot read prior chats."
          : await host.readNote(id);
      return truncateBody(body, budget.readNoteChars);
    }
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
      return truncateBody(await host.readNote(id), budget.readNoteChars);
    }
    case "create_note": {
      const title = String(args.title ?? "").trim();
      const body = String(args.body ?? args.text ?? args.content ?? "").trim();
      if (title === "" && body === "") {
        return 'error: create_note needs a "title" and a markdown "body".';
      }
      return await host.createNote(title, body);
    }
    case "update_note": {
      const id = String(args.id ?? "").trim();
      const body = String(args.body ?? args.text ?? args.content ?? "").trim();
      if (id === "" || body === "") {
        return 'error: update_note needs an "id" and the COMPLETE new markdown "body" (it replaces the whole note — read_note first).';
      }
      if (!host.updateNote) return "error: this host cannot edit notes.";
      return await host.updateNote(id, body);
    }
    case "open_note": {
      const id = String(args.id ?? "").trim();
      if (id === "") return 'error: open_note needs an "id" from search_notes or the index.';
      if (!host.openNote) return "error: this host cannot open notes on screen.";
      return await host.openNote(id);
    }
    case "read_file": {
      const q = String(args.query ?? args.name ?? args.file ?? "").trim();
      if (q === "") return 'error: read_file needs a "query" — the filename (e.g. report.csv).';
      return truncateBody(await host.readFile(q), budget.readNoteChars * 2);
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
    case "generate_image": {
      const prompt = String(args.prompt ?? "").trim();
      if (prompt === "") return 'error: generate_image needs a "prompt" describing the image.';
      const rel = await host.generateImage(prompt);
      return `saved: ${rel} — it's in this chat's assets. Tell the user it's ready (mention the filename).`;
    }
  }
}
