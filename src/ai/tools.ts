// The tool layer — retrieval over the memex (the knowledge base) + the dispatcher.
// Retrieval leans on the user's organization + metadata: notes are grouped by their
// folder (an area), ranked by title/folder/snippet overlap. Small corpus ⇒ a linear
// scan beats any index.

import type { CorpusNoteMeta } from "../lib/tauri";
export { buildIndex } from "../memex/modelMap";
import type { Budget } from "./budget";
import type { Host, NoteHit, ScratchStep, ToolName, WebEvidenceSource } from "./types";

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

/** Read one model-supplied tool argument as text. The model fills these in, so
 * every value is genuinely `unknown`: a small model that answers with
 * `{"query": {"text": "kaya"}}` instead of `{"query": "kaya"}` used to reach
 * `String()` and search the memex for the literal "[object Object]" — a silent
 * miss the model could never diagnose. Only real scalars convert; anything else
 * becomes "" so the caller's existing empty-check returns the honest
 * `error: … needs a non-empty "query"` feedback the model can correct. */
function argText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
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

/** Frame the `links:` line inside a READ note's metadata fence. That one line
 * reads like a roster — a run of [[names]] — but it mixes people, projects and
 * reference indiscriminately, and a small model kept answering "who are the
 * people in my vault" straight out of it (2026-08-01: the project "caminorx"
 * landed in a list of Seth's family). Same move as `truncateBody`: name the
 * hazard IN the observation, where the model is actually looking, and let the
 * prompts teach the rule. The line keeps its `key: value` shape, so a model
 * that echoes the fence back into update_note still hits
 * stripLeadingFrontmatter — no annotation can reach a note's body. */
export function frameLinksMetadata(body: string): string {
  const fence = body.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*\n?/);
  if (!fence) return body;
  const block = fence[1] ?? "";
  const framed = block.replace(
    /^(links[ \t]*:[ \t]*)(?!\(pointers\b)(\S.*)$/im,
    "$1(pointers to other notes — a mix of people, projects and reference; NOT a list of anything, never answer from them) $2",
  );
  if (framed === block) return body;
  const head = fence[0];
  const at = head.indexOf(block);
  return `${head.slice(0, at)}${framed}${head.slice(at + block.length)}${body.slice(head.length)}`;
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

/** Is this query worth matching against folder paths? A folder is named with a
 * word, not a sentence — matching a phrase against paths only adds noise, and
 * a 1-2 char query matches half the tree. Exported so a caller can skip the
 * corpus listing entirely when the answer is no. */
export function folderQuery(query: string): boolean {
  const q = query.trim();
  return q.length >= 3 && !/\s/.test(q);
}

/** Notes whose FOLDER path matches the query. The user's own organization is a
 * first-class retrieval signal that rotli's full-text search cannot see:
 * corpus_search (corpus.rs `search_match`) matches TITLE and BODY only, so
 * "people" never reaches the notes IN `wiki/people/**` — a person note's body
 * doesn't contain the word "people". Asked for a roster the model could reach
 * only the two index notes sitting beside them, and answered out of one's
 * metadata (2026-08-01). Boards/files are skipped for parity with rankNotes. */
export function folderHits(notes: CorpusNoteMeta[], query: string, limit: number): NoteHit[] {
  if (!folderQuery(query)) return [];
  const q = query.trim().toLowerCase();
  return notes
    .filter((n) => n.kind !== "board" && n.kind !== "file" && (n.folderId || "").toLowerCase().includes(q))
    .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map((n) => ({ id: n.id, title: n.title, snippet: n.snippet, folder: n.folderId || "" }));
}

/** Merge folder matches into full-text hits: TITLE hits (rank 0) first, then
 * the folder matches, then body-only hits — deduped, capped at `limit`. That
 * is the title > folder > body weighting rankNotes has always used, restored
 * on the Rust search path the AI actually rides. */
export function mergeFolderHits(
  ranked: { hit: NoteHit; rank: number }[],
  folder: NoteHit[],
  limit: number,
): NoteHit[] {
  const out: NoteHit[] = [];
  const seen = new Set<string>();
  const push = (hit: NoteHit) => {
    if (seen.has(hit.id)) return;
    seen.add(hit.id);
    out.push(hit);
  };
  for (const r of ranked) if (r.rank === 0) push(r.hit);
  for (const hit of folder) push(hit);
  for (const r of ranked) if (r.rank !== 0) push(r.hit);
  return out.slice(0, limit);
}

/** Does this hit look like an AREA INDEX — the Filer's generated `_index.md`,
 * whose H1 (and therefore title) is the bare area name? Its body is the one
 * complete roster of what's filed in that area, and nothing else in a search
 * result says so: note ids are opaque ULIDs (the `.rotli` index stamps one even
 * on a frontmatter-less file), and it shares its folder with the area's
 * hand-written README. Asked "who are the people in my vault", the model read
 * the README — a note that names nobody — and answered from its metadata
 * because the roster beside it looked like just another hit (2026-08-01). */
export function isAreaIndex(title: string, folder: string): boolean {
  const area = folder.split("/").filter(Boolean).pop() ?? "";
  return area !== "" && title.trim().toLowerCase() === area.toLowerCase();
}

/** Keep the scratchpad under a char budget so it can't grow unbounded across steps.
 * Oldest results are trimmed first — the most recent (most relevant) stay intact. */
export function pruneScratch(scratch: ScratchStep[], maxChars: number): ScratchStep[] {
  let total = 0;
  for (const e of scratch) total += e.action.length + (e.thought?.length ?? 0) + e.result.length;
  if (total <= maxChars) return scratch;
  const out = scratch.map((e) => ({ ...e }));
  for (let i = 0; i < out.length && total > maxChars; i++) {
    const cur = out[i]!;
    if (cur.thought && cur.thought.length > 80) {
      const over = total - maxChars;
      const keep = Math.max(60, cur.thought.length - over);
      total -= cur.thought.length - keep;
      cur.thought = `${cur.thought.slice(0, keep)}…(trimmed)`;
    }
    if (cur.result.length > 60) {
      const over = total - maxChars;
      const keep = Math.max(40, cur.result.length - over);
      total -= cur.result.length - keep;
      cur.result = `${cur.result.slice(0, keep)}…(trimmed)`;
    }
  }
  return out;
}

/** A short, human label for a live tool step — enriched with the call's own
 * argument (the query, the fetched host, the filename) so a multi-step research
 * answer shows LIFE ("searching the web for 'frontier ai'…") instead of one long
 * generic "thinking". `args` is model-supplied and untrusted, so the value is
 * clipped and never rendered as markup — the chat surface prints it as text. */
export function statusFor(tool: ToolName, args?: Record<string, unknown>): string {
  const q = args ? clipStatusArg(argText(args.query)) : "";
  switch (tool) {
    case "search_notes":
      return q ? `searching your notes for “${q}”…` : "searching your notes…";
    case "search_memory":
      return q ? `searching your memory for “${q}”…` : "searching your memory…";
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
    case "read_file": {
      const name = args ? clipStatusArg(argText(args.query ?? args.name ?? args.file)) : "";
      return name ? `reading “${name}”…` : "reading a file…";
    }
    case "web_search":
      return q ? `searching the web for “${q}”…` : "searching the web…";
    case "research_web":
      return q ? `researching the web for “${q}”…` : "researching the web…";
    case "web_fetch": {
      const host = args ? webHost(argText(args.url)) : "";
      return host ? `reading ${host}…` : "reading a web page…";
    }
    case "generate_image":
      return "generating an image…";
    case "draw_board":
      return "drawing the board…";
  }
}

/** Clip a status argument to a short, single-line snippet (untrusted model
 * text — newlines/controls stripped, capped). */
function clipStatusArg(value: string): string {
  const s = value.replace(/\s+/g, " ").trim();
  return s.length > 42 ? `${s.slice(0, 42)}…` : s;
}

/** The bare host of a fetch URL for the status line ("example.com"), or "" when
 * it isn't a parseable http(s) URL. */
function webHost(url: string): string {
  try {
    const u = new URL(url.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return u.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** A miss must hand the model its next move, not a dead end: the substring
 * engine finds nothing for "runtime" even when a note titled "Preferences"
 * holds the answer, and a small model will not travel back up to the map
 * buried in its prompt — observations are where it is actually looking. So a
 * zero-hit search carries a compact title index with it (same budgeted map
 * the prompt uses, smaller cap). Map failure degrades to the plain miss. */
async function emptySearchObservation(host: Host, query: string): Promise<string> {
  // Harvest-only budget: generous so AREA entries survive the map's own
  // truncation (we discard the note titles and render just names+counts,
  // so the observation stays small regardless).
  const MAP_CHARS = 8000;
  const index = await host.knowledgeMap(MAP_CHARS).catch(() => "");
  const base = `no matching notes for "${query}" — the search needs a word the note actually contains.`;
  if (!index.trim()) return `${base} Try one different, distinctive word.`;
  // Area names are COMPLETE at any vault size (a title list truncates and the
  // needed title loses the lottery — measured: a 700-char map dropped the
  // personality lane entirely). Search matches folder names too, so "pick the
  // area, search its one word" always lands; the area's generated index then
  // leads the hits (role:"area-index").
  const areas = areaLines(index);
  if (areas) {
    // Directive-first: a small model reads "no matching notes" as terminal and
    // apologizes even with the roll-call attached. Lead with the required next
    // action and a literal example step; the miss is a clause, not the verdict.
    return (
      `DO NOT answer "not found" yet — the word "${query}" appears in no note, but the answer is likely FILED under an area below. ` +
      `REQUIRED NEXT STEP: pick the area that would hold it and search that area's word (folder names match), like {"tool":"search_notes","args":{"query":"personality"}}. ` +
      `The vault's areas:\n${areas}`
    );
  }
  return `${base} These note titles exist — pick the one whose TITLE fits the question and search that exact title word:\n${index}`;
}

/** "personality (1 · Preferences) · wiki/people (13 · people) · …" from the
 * model-map JSON — each area carries its LEADING note title so the model can
 * string-match the question's words ("prefer" → Preferences) instead of
 * judging which folder a fact lives in. Empty string when the map isn't the
 * JSON shape (caller falls back to the raw index). */
function areaLines(mapJson: string): string {
  try {
    const parsed = JSON.parse(mapJson) as {
      areas?: { name?: unknown; count?: unknown; notes?: { title?: unknown }[] }[];
    };
    if (!Array.isArray(parsed.areas) || parsed.areas.length === 0) return "";
    return parsed.areas
      .filter((a) => typeof a.name === "string" && a.name)
      .map((a) => {
        const count = typeof a.count === "number" ? a.count : "?";
        const lead = Array.isArray(a.notes)
          ? a.notes.find((n) => typeof n.title === "string" && n.title)
          : undefined;
        return lead ? `${String(a.name)} (${count} · ${String(lead.title)})` : `${String(a.name)} (${count})`;
      })
      .join(" · ");
  } catch {
    return "";
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
      const q = argText(args.query).trim();
      if (q === "") return 'error: search_memory needs a non-empty "query".';
      const hits = host.searchMemory
        ? await host.searchMemory(q, budget.maxHits)
        : (await host.searchNotes(q, budget.maxHits)).map((hit) => ({
            id: hit.id,
            title: hit.title,
            snippet: hit.snippet,
            source: "note" as const,
            ...(isAreaIndex(hit.title, hit.folder) ? { role: "area-index" as const } : {}),
          }));
      // the area index leads here too — same rule as search_notes, since this
      // is the tool the prompts name first
      const ordered = [...hits].sort(
        (a, b) => Number(b.role === "area-index") - Number(a.role === "area-index"),
      );
      return ordered.length
        ? JSON.stringify(
            ordered.map((hit) => ({ ...hit, snippet: truncate(hit.snippet, budget.snippetChars) })),
          )
        : await emptySearchObservation(host, q);
    }
    case "read_memory": {
      const id = argText(args.id).trim();
      if (!id) return 'error: read_memory needs an "id" from search_memory.';
      const body = host.readMemory
        ? await host.readMemory(id)
        : id.startsWith("chat:")
          ? "error: this host cannot read prior chats."
          : await host.readNote(id);
      return truncateBody(frameLinksMetadata(body), budget.readNoteChars);
    }
    case "search_notes": {
      const q = argText(args.query).trim();
      if (q === "") return 'error: search_notes needs a non-empty "query".';
      const hits = await host.searchNotes(q, budget.maxHits);
      if (hits.length === 0) return emptySearchObservation(host, q);
      // an area's generated index leads its equals: it is the best first read
      // for any question ABOUT that area, and the alternative — a hand-written
      // README with the friendlier title — often names nothing at all.
      // Array.sort is stable, so every other hit keeps its rank order.
      const ordered = [...hits].sort(
        (a, b) => Number(isAreaIndex(b.title, b.folder)) - Number(isAreaIndex(a.title, a.folder)),
      );
      const trimmed = ordered.map((h) => ({
        id: h.id,
        title: h.title,
        folder: h.folder,
        // name the roster where the model is choosing what to read — the
        // `role:"area-index"` shape docs/design/local-model-retrieval-notes.md
        // §4.1 specified; both prompts say what the role means
        ...(isAreaIndex(h.title, h.folder) ? { role: "area-index" } : {}),
        snippet: truncate(h.snippet, budget.snippetChars),
      }));
      return JSON.stringify(trimmed);
    }
    case "read_note": {
      const id = argText(args.id).trim();
      if (id === "") return 'error: read_note needs an "id" from search_notes or the index.';
      return truncateBody(frameLinksMetadata(await host.readNote(id)), budget.readNoteChars);
    }
    case "create_note": {
      const title = argText(args.title).trim();
      const body = argText(args.body ?? args.text ?? args.content).trim();
      if (title === "" && body === "") {
        return 'error: create_note needs a "title" and a markdown "body".';
      }
      return await host.createNote(title, body);
    }
    case "update_note": {
      const id = argText(args.id).trim();
      const body = argText(args.body ?? args.text ?? args.content).trim();
      if (id === "" || body === "") {
        return 'error: update_note needs an "id" and the COMPLETE new markdown "body" (it replaces the whole note — read_note first).';
      }
      if (!host.updateNote) return "error: this host cannot edit notes.";
      return await host.updateNote(id, body);
    }
    case "open_note": {
      const id = argText(args.id).trim();
      if (id === "") return 'error: open_note needs an "id" from search_notes or the index.';
      if (!host.openNote) return "error: this host cannot open notes on screen.";
      return await host.openNote(id);
    }
    case "read_file": {
      const q = argText(args.query ?? args.name ?? args.file).trim();
      if (q === "") return 'error: read_file needs a "query" — the filename (e.g. report.csv).';
      return truncateBody(await host.readFile(q), budget.readNoteChars * 2);
    }
    case "web_search": {
      const q = argText(args.query).trim();
      if (q === "") return 'error: web_search needs a "query".';
      const hits = await host.webSearch(q, budget.maxHits);
      if (hits.length === 0) return "no web results.";
      const trimmed = hits.map((h, index) => ({
        sourceId: `S${index + 1}`,
        provider: h.provider,
        title: h.title,
        url: h.url,
        snippet: truncate(h.snippet, budget.snippetChars),
      }));
      return JSON.stringify(trimmed);
    }
    case "research_web": {
      const q = argText(args.query).trim();
      if (q === "") return 'error: research_web needs a "query".';
      const hits = await host.webSearch(q, budget.maxHits);
      if (hits.length === 0) {
        return JSON.stringify({
          kind: "web_research",
          evidenceAvailable: false,
          sources: [],
          guidance:
            "No search results were found. Say the answer could not be verified; do not guess from memory.",
        });
      }
      const selected = hits.slice(0, Math.min(3, hits.length));
      const pageChars = Math.max(600, Math.floor(budget.webFetchChars / selected.length));
      const sources = await Promise.all(
        selected.map(async (hit, index): Promise<WebEvidenceSource | null> => {
          try {
            const page = truncateBody(await host.webFetch(hit.url, pageChars), pageChars).trim();
            if (!page) return null;
            return {
              sourceId: `S${index + 1}`,
              provider: hit.provider,
              title: hit.title,
              url: hit.url,
              searchExcerpt: truncate(hit.snippet, budget.snippetChars),
              evidence: page,
            };
          } catch {
            return null;
          }
        }),
      );
      const evidence = sources.filter((source): source is WebEvidenceSource => source !== null);
      return JSON.stringify({
        kind: "web_research",
        provider: hits[0]?.provider,
        evidenceAvailable: evidence.length > 0,
        sources: evidence,
        guidance:
          evidence.length > 0
            ? "Answer only from this evidence. Cite factual claims with the matching sourceId values. If sources conflict, say so instead of choosing one confidently."
            : "Search returned links, but Rotli could not read usable page evidence. Say the answer could not be verified; do not guess from memory.",
      });
    }
    case "web_fetch": {
      const url = argText(args.url).trim();
      if (url === "") return 'error: web_fetch needs a "url".';
      return truncate(await host.webFetch(url, budget.webFetchChars), budget.webFetchChars);
    }
    case "generate_image": {
      const prompt = argText(args.prompt).trim();
      if (prompt === "") return 'error: generate_image needs a "prompt" describing the image.';
      const rel = await host.generateImage(prompt);
      return `saved: ${rel} — it's in this chat's assets. Tell the user it's ready (mention the filename).`;
    }
    case "draw_board": {
      const source = argText(args.mermaid ?? args.code ?? args.definition).trim();
      if (source === "") {
        return 'error: draw_board needs "mermaid" — Mermaid flowchart source (e.g. "flowchart TD\\n  A --> B").';
      }
      if (!host.drawBoard) return "error: this host cannot draw boards.";
      return host.drawBoard(argText(args.title).trim(), source);
    }
  }
}
