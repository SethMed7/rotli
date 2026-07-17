// The brain change JOURNAL — the audit + undo log for AI Filer actions (design §4.4).
// Frontend-owned `.rotli/brain-journal.jsonl`, one JSON action per line. TWO writers
// speak the same shape: the Phase-3 USER-triggered actions ("file this note") and the
// Phase-4 daemon (organizer.rs, ULID ids — never colliding with the ts36-counter36
// ids below). A same-id re-append is a STATUS TRANSITION; the LAST line wins. Undo
// works off `before`/`after` (no git dependency) — see and reverse every AI write
// before anything becomes automatic.

export interface BrainAction {
  id: string;
  ts: number;
  action: "file" | "field" | "index";
  /** The note's rel path AS OF the row's write — display + the [Open] target.
   * A rel pins a moment: a sibling filing or a title rename strands it, so
   * apply/undo resolve through `noteUlid` when present. For an "index" row:
   * `wiki/<area>/_index.md`. */
  noteId: string;
  /** The note's frontmatter ULID (daemon rows) — the STABLE handle that
   * survives filings and renames between proposal and Approve/Undo. */
  noteUlid?: string;
  noteTitle: string;
  area?: string;
  /** file: the old folder · field: the old value ("" if it was unset) ·
   * index: the current on-disk `_index.md` body ("" when none). */
  before: string;
  /** file: the new folder · field: the new value · index: the FULL proposed
   * body (§4.5 — carried whole so review can show a side-by-side diff). */
  after: string;
  /** for action "field" — the key that changed. */
  field?: string;
  /** daemon rows only — the local model that decided ("" for the deterministic
   * index render, where no model ran). */
  model?: string;
  /** classify rows only — the model's 0..1 confidence in the area. */
  confidence?: number;
  status: "proposed" | "applied" | "reverted" | "dismissed";
}

// ─── the ONE derivation every consumer shares (Activity pane, sidebar badge) ──

export interface JournalView {
  /** Latest-status "proposed" rows, newest first — awaiting Approve/Dismiss. */
  pending: BrainAction[];
  /** Latest-status "applied" or "reverted" rows, newest first. A "reverted"
   * row renders as history with an "undone" badge, never as actionable. */
  history: BrainAction[];
}

/** Fold the append-only jsonl into current state: LAST line per id WINS (an
 * approve/dismiss/undo is a re-append of the same id with a new status).
 * Unknown statuses (a future writer) fold in but surface nowhere — forward-
 * compatible, never a crash. */
export function deriveJournal(actions: BrainAction[]): JournalView {
  const latest = new Map<string, BrainAction>();
  for (const a of actions) {
    if (typeof a.id === "string" && a.id) latest.set(a.id, a);
  }
  const rows = [...latest.values()].sort((a, b) => b.ts - a.ts);
  return {
    pending: rows.filter((a) => a.status === "proposed"),
    history: rows.filter((a) => a.status === "applied" || a.status === "reverted"),
  };
}

/** The corpus calls the transitions ride — injectable so the transition
 * grammar (same-id re-append, journal:false, freshness guards) is testable
 * without a Tauri shell. The live adapter is chosen in
 * brainJournalComposition.ts. */
export interface JournalDeps {
  fileNote: (noteId: string, area: string, opts?: { journal?: boolean }) => Promise<string>;
  setAiField: (id: string, key: string, value: string) => Promise<void>;
  writeIndex: (area: string, body: string) => Promise<void>;
  filerMove: (id: string, targetFolder: string) => Promise<unknown>;
  notePath: (id: string) => Promise<string>;
  frontmatter: (id: string) => Promise<{ fields: string[] } | null>;
  append: (line: string) => Promise<void>;
  /** The current on-disk `wiki/<area>/_index.md` body ("" when none) — the
   * index branch's freshness read (#26, audit 2026-07). */
  readIndex: (area: string) => Promise<string>;
  /** Teach the daemon an approved field value (#28) — best-effort; the caller
   * swallows a failure (the field stays user-owned until the next Approve). */
  learnField: (note: string, key: string, value: string) => Promise<void>;
}

/** The stable handle for a row's note: the ULID when the daemon recorded one
 * (survives filings/renames), else the rel path (Phase-3 rows, external drops). */
function handleOf(a: BrainAction): string {
  return a.noteUlid || a.noteId;
}

/** A field's current value off a frontmatter view ("" when unset) — mirrors the
 * daemon's own `split_once(':')` + trim parse. */
function fieldValue(lines: string[], key: string): string {
  for (const line of lines) {
    const i = line.indexOf(":");
    if (i > 0 && line.slice(0, i).trim() === key) return line.slice(i + 1).trim();
  }
  return "";
}

/** Apply a daemon PROPOSAL (the explicit-click path — the frontend never
 * auto-applies). The write rides the same v3.7 Filer gates the daemon uses
 * (locked is re-checked fresh inside them), then the proposal's own id is
 * re-appended `applied` so it resolves out of pending instead of double-logging.
 * §4.8 freshness: the row's `before` must still match disk — a note that moved
 * or a field the user changed since the proposal REFUSES rather than applying
 * a stale decision (the daemon re-proposes for the new state on its next pass). */
export async function approveProposal(p: BrainAction, deps: JournalDeps): Promise<void> {
  const marker: BrainAction = { ...p, status: "applied", ts: Date.now() };
  if (p.action === "file") {
    if (!p.area) throw new Error("file proposal without an area");
    const rel = await deps.notePath(handleOf(p));
    if (rel.slice(0, rel.lastIndexOf("/")) !== p.before) {
      throw new Error("The note moved since this was proposed — dismiss it; the AI will re-evaluate.");
    }
    // journal:false — this proposal row IS the journal entry; it transitions.
    const newRel = await deps.fileNote(handleOf(p), p.area, { journal: false });
    marker.noteId = newRel;
    marker.after = newRel.slice(0, newRel.lastIndexOf("/"));
    // filed_by/filed_at ride the approve exactly like a daemon auto-apply
    // (#90, audit 2026-07) — the audit trail must not depend on WHO clicked.
    // The decider is the row's model; a model-less row records the approval.
    // Stamped AFTER the move succeeds (review, 2026-07): stamping first left a
    // fileNote refusal (note locked mid-flight, area unwritable) with an
    // UNFILED note marked filed — the divergence #90 exists to remove, in the
    // opposite direction. Best-effort on the NEW rel: the filing is real by
    // now, so a failed stamp must not fail the approve (re-clicking would only
    // hit the "note moved" freshness refusal).
    await deps.setAiField(newRel, "filed_by", p.model || "user-approved").catch(() => {});
    await deps.setAiField(newRel, "filed_at", new Date().toISOString()).catch(() => {});
  } else if (p.action === "field") {
    if (!p.field) throw new Error("field proposal without a field");
    // resolve the CURRENT rel (a sibling filing may have moved the note) and
    // re-check the field is still as proposed-from before writing over it
    const rel = await deps.notePath(handleOf(p));
    const fm = await deps.frontmatter(rel);
    if (fieldValue(fm?.fields ?? [], p.field) !== p.before) {
      throw new Error(`${p.field} changed since this was proposed — dismiss it; the AI will re-evaluate.`);
    }
    await deps.setAiField(rel, p.field, p.after);
    marker.noteId = rel;
    // teach the daemon the approved value (#28) — else the never-clobber
    // baseline reads it as a user edit and freezes the field forever.
    // Best-effort: the write above already landed, so a learn failure must
    // not fail the approve (the row would re-approve into a freshness refusal).
    await deps.learnField(handleOf(p), p.field, p.after).catch(() => {});
    // a suggested_area proposal carries the classifier's confidence — persist it
    // beside the suggestion (same "{:.2}" shape the daemon writes at Tidy)
    if (p.field === "suggested_area" && typeof p.confidence === "number") {
      const conf = p.confidence.toFixed(2);
      await deps.setAiField(rel, "area_confidence", conf);
      await deps.learnField(handleOf(p), "area_confidence", conf).catch(() => {});
    }
  } else {
    if (!p.area) throw new Error("index proposal without an area");
    // §4.8 freshness for INDEX rows too (#26): the overview this row proposed
    // FROM must still be on disk — a filing or a sibling approve rewrote it
    // since, and applying this row would roll the overview back.
    if ((await deps.readIndex(p.area)) !== p.before) {
      throw new Error(
        "The overview changed since this was proposed — dismiss it; the AI will re-evaluate.",
      );
    }
    await deps.writeIndex(p.area, p.after);
  }
  await deps.append(JSON.stringify(marker));
}

/** Decline a proposal — journal-only, nothing touches the corpus. The daemon's
 * hash state keeps it from re-proposing until the note actually changes. */
export async function dismissProposal(p: BrainAction, deps: JournalDeps): Promise<void> {
  await deps.append(JSON.stringify({ ...p, status: "dismissed", ts: Date.now() }));
}

/** Reverse an applied action and append a `reverted` marker. A file moves back
 * to its `before` folder; a field restores its `before` value; an index restores
 * its `before` body — or, when no `_index.md` existed before the first apply
 * (`before` is ""), Rust removes the file so undo restores "no file", not a
 * 0-byte husk. (The daemon re-proposes on its next sweep if members differ.) */
export async function undoAction(a: BrainAction, deps: JournalDeps): Promise<void> {
  if (a.action === "file") {
    await deps.filerMove(handleOf(a), a.before);
  } else if (a.action === "field" && a.field) {
    await deps.setAiField(handleOf(a), a.field, a.before);
  } else if (a.action === "index" && a.area) {
    await deps.writeIndex(a.area, a.before);
  }
  await deps.append(JSON.stringify({ ...a, status: "reverted", ts: Date.now() }));
}
