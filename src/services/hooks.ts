// The seam components actually consume: TanStack Query hooks over the typed
// service. No component touches notesService directly.

import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { replaceTitleLine } from "../lib/noteTitle";
import {
  corpusFileStat,
  corpusMoveFileToSink,
  corpusTasks,
  isTauri,
  organizerSecureHints,
  organizerStatus,
  secureRepairScan,
} from "../lib/tauri";
import { useUiStore } from "../state/ui";
import type { Note, NoteSummary } from "../types";
import { readJournal } from "./brainJournalStore";
import { summaryOrder } from "./derive";
import { DEST, isChats, isChatsPath, isSink } from "./destinations";
import { trashVirtualFolderItems } from "./folderTrash";
import { memexRootMarkers, scopeCorpusNotes } from "./fsNotes";
import { archiveNoteWithImages, trashNoteWithImages } from "./noteLifecycle";
import { notesService } from "./notes";
import { queryClient } from "./query";

/** Surface a lifecycle failure inline instead of swallowing it — the memex write
 * gate can refuse a move, and a silent rejection reads as "nothing happened"
 * (the maintainer, 2026-07-07). Rendered by the sidebar's row-action error banner. */
export const lifecycleError = (verb: string) => (e: unknown) =>
  useUiStore
    .getState()
    .setRowActionError(`Couldn’t ${verb} this note — ${e instanceof Error ? e.message : String(e)}`);

export const keys = {
  folders: ["folders"] as const,
  // null is the ALL-notes sentinel — a real folder named "all" must get its
  // own cache entry, not share (and clobber) the default view's (#77, audit
  // 2026-07). null can never collide with a folder id (ids are strings).
  notes: (folderId?: string) => ["notes", folderId ?? null] as const,
  note: (id: string) => ["note", id] as const,
  memexRoots: ["memex-root-markers"] as const,
  journal: ["journal"] as const,
  organizer: ["organizer-status"] as const,
  secureRepair: ["secure-repair"] as const,
  secureHints: ["secure-hints"] as const,
  tasks: ["tasks"] as const,
};

/** The note universe's whole-corpus fetch rides a reserved folderId sentinel so
 * it shares the `["notes"]` invalidation umbrella (invalidateNotes refetches it,
 * applyNoteWrite patches it) while never colliding with a real folder id — real
 * ids are ULIDs, paths, or "<root>:" markers, none of which start with NUL. */
export const UNIVERSE_KEY = "\u0000universe";
const EMPTY_MARKERS: ReadonlySet<string> = new Set();

export function useFolders() {
  return useQuery({ queryKey: keys.folders, queryFn: () => notesService.listFolders() });
}

export function useNotes(folderId?: string) {
  return useQuery({
    queryKey: keys.notes(folderId),
    queryFn: () => notesService.listNotes(folderId),
  });
}

/** Every listing that can hold a note — the default view, the roots it hides
 * (Board = STAGED wiki/_inbox notes, Archive, Trash), the external Vault, AND
 * every ADDED root ("<rootid>:" — a note there is as real as a vault note: its
 * Main ref must survive GC, its tab needs a title).
 *
 * ONE query, not seven (perf audit 2026-08): this fanned out `useQueries` over
 * 7+ folderIds, and each `listNotes(folderId)` walks the WHOLE corpus
 * (corpus_list) then filters — so an invalidation serialized the whole corpus
 * across the IPC boundary once PER view. It now fetches the whole corpus ONCE
 * (`listAll`, a flat NoteSummary[] under the `["notes"]` prefix so
 * applyNoteWrite/invalidateNotes keep patching it unchanged) and derives the 7
 * views client-side with the SAME scope rule listNotes uses (`scopeCorpusNotes`,
 * zero drift). Returns the lists (undefined until the corpus loads) plus
 * `complete` — true only when the roots list, the corpus, AND the memex markers
 * have all SUCCEEDED.
 *
 * TanStack's structural sharing keeps the raw corpus identity stable when its
 * content is unchanged, so the deriving useMemo doesn't recompute per 400ms sync
 * tick; stableLists then reuses the previous lists array whenever every derived
 * view is identical, keeping every downstream useMemo (note index, searchable
 * notes, tab titles, list sorts, wikilink re-decoration) from re-deriving while
 * typing (the findings-8/9/11/12 shared trigger). */
let lastUniverseLists: (NoteSummary[] | undefined)[] = [];
function stableLists(next: (NoteSummary[] | undefined)[]): (NoteSummary[] | undefined)[] {
  if (next.length === lastUniverseLists.length && next.every((list, i) => list === lastUniverseLists[i]))
    return lastUniverseLists;
  lastUniverseLists = next;
  return next;
}

/** The active vault's folder views, in stable order. Connected vaults exist only
 * as switcher targets; their notes never enter this webview's universe. */
function universeFolderIds(): (string | undefined)[] {
  return [
    undefined,
    DEST.board,
    // Binary files stay out of ordinary note search below, but belong in the
    // identity universe so Main, tabs, and typed embed pickers can resolve them.
    DEST.storage,
    DEST.archive,
    DEST.trash,
  ];
}

function useNoteUniverse(): { lists: (NoteSummary[] | undefined)[]; complete: boolean } {
  // Whether the active root's chats/ means transcripts. Consulted only for the
  // All-Notes view's chats/ exclusion.
  const memexQ = useQuery({
    queryKey: keys.memexRoots,
    queryFn: (): Promise<ReadonlySet<string>> | ReadonlySet<string> =>
      isTauri() ? memexRootMarkers() : new Set([DEST.vault]),
    staleTime: Infinity,
  });
  // the WHOLE corpus, once — a flat listing keyed under ["notes"] so the mutation
  // helpers (applyNoteWrite patch, invalidateNotes) treat it exactly like a
  // per-folder list and keep it fresh with no extra wiring.
  const corpus = useQuery({
    queryKey: keys.notes(UNIVERSE_KEY),
    queryFn: () => notesService.listAll(),
  });
  const memex = memexQ.data;
  const raw = corpus.data;
  const lists = useMemo(() => {
    const folderIds = universeFolderIds();
    if (!raw) return stableLists(folderIds.map(() => undefined));
    return stableLists(
      folderIds.map((folderId) =>
        // the All-Notes view needs the markers; until they load it isn't ready
        // (mirrors the old listNotes(undefined), which awaited them) — every
        // scoped view resolves from the corpus alone
        !folderId && !memex ? undefined : scopeCorpusNotes(raw, folderId, memex ?? EMPTY_MARKERS),
      ),
    );
  }, [raw, memex]);
  const complete = corpus.isSuccess && memexQ.isSuccess;
  return { lists, complete };
}

/** The ONE id → summary index over EVERY note that exists. useNotes() alone is
 * a VIEW, not the universe; anything that treats it as "all notes" silently
 * loses staged/vaulted/added-root notes (the bug that GC'd the maintainer's seeded Main
 * and labeled his tab "Untitled"). The Main projection, tab titles, and the
 * row-menu lookup read THIS instead. */
export function useNoteIndex(): Map<string, NoteSummary> {
  const { lists } = useNoteUniverse();
  return useMemo(() => {
    const index = new Map<string, NoteSummary>();
    for (const list of lists) for (const n of list ?? []) index.set(n.id, n);
    return index;
  }, [lists]);
}

/** liveIds for the Main-manifest GC — undefined until EVERY listing has
 * SUCCEEDED (setTree treats undefined as skip-GC). A vault on a disconnected
 * drive (its query errors forever) or the first render frames (lists still
 * loading) must never read as "these notes don't exist": passing a shrunken
 * set pruned live refs out of the COMMITTED .rotli/main.json for good — the
 * exact silent-GC failure this index fixed for staged notes, re-armed through
 * a narrower door. Better to skip a GC than to amputate the manifest. */
export function useMainGcIds(): Set<string> | undefined {
  const { lists, complete } = useNoteUniverse();
  return useMemo(() => {
    if (!complete) return undefined;
    const ids = new Set<string>();
    for (const list of lists) for (const n of list ?? []) ids.add(n.id);
    return ids;
  }, [lists, complete]);
}

/** Every SEARCHABLE note — the merged universe (staged Board + Brain wiki/ +
 * Vault + added roots + plain folders) minus what note search never lists:
 * binary files, memex chats/ transcripts (the Chat front owns them; a PLAIN
 * root's "chats" folder is just a folder and stays in), and the two sinks
 * (Archive stays reachable via its own row AND full-text search; Trash never
 * surfaces). The ⌘K palette, All notes, and the Quick ⌘P picker all read
 * THIS — useNotes() alone is a VIEW that silently misses staged notes (the
 * 2026-07-01 search audit's P0: a staged Main note was unfindable everywhere).
 * `ready` = every listing has SUCCEEDED (the same completeness bar as the GC). */
export function useSearchableNotes(): { notes: NoteSummary[]; ready: boolean } {
  const { lists, complete } = useNoteUniverse();
  // which roots' chats/ means transcripts — session-static, like the roots list.
  // Browser twin: the one seeded memex is the Vault brain (mirrors notes.ts).
  const memexQ = useQuery({
    queryKey: keys.memexRoots,
    queryFn: (): Promise<ReadonlySet<string>> | ReadonlySet<string> =>
      isTauri() ? memexRootMarkers() : new Set([DEST.vault]),
    staleTime: Infinity,
  });
  const memex = memexQ.data;
  const notes = useMemo(() => {
    const seen = new Map<string, NoteSummary>();
    for (const list of lists)
      for (const n of list ?? []) {
        // until the markers load, fall back to the pure shape test — the
        // conservative transient (a plain root's chats/ appears a beat later,
        // never flashes in and out)
        const chats = memex ? isChats(n.folderId, memex) : isChatsPath(n.folderId);
        if (n.kind === "file" || isSink(n.folderId) || chats) continue;
        seen.set(n.id, n);
      }
    return [...seen.values()];
  }, [lists, memex]);
  return { notes, ready: complete };
}

/** A value that settles `ms` after its source stops changing. */
function useDebouncedValue<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

/** FULL-TEXT body search (corpus_search / the browser twin), debounced 180ms,
 * min 2 chars. keepPreviousData keeps rows steady between keystrokes; the
 * short staleTime means an edit made seconds ago is re-findable (search sits
 * outside the ["notes"] invalidation beat). Consumers must gate on their OWN
 * live query length — a placeholder can briefly carry the previous query's
 * hits. */
export function useNoteSearch(query: string) {
  const q = useDebouncedValue(query.trim(), 180);
  return useQuery({
    queryKey: ["search", q],
    queryFn: () => notesService.searchNotes(q, 50),
    enabled: q.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 5_000,
  });
}

export function useNote(id: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: keys.note(id),
    queryFn: () => notesService.getNote(id),
    enabled: options.enabled ?? true,
  });
}

/** Seed one just-created note before an optimistic tab retargets. This is a
 * presentation handoff only; structural list caches still refresh through the
 * ordinary create workflow. */
export function primeNote(note: Note): void {
  queryClient.setQueryData(keys.note(note.id), note);
}

export async function invalidateNotes(): Promise<void> {
  // the three umbrellas hit independent Rust commands — refetch them together,
  // not one after another (each await was a serialized IPC round trip)
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["notes"] }),
    queryClient.invalidateQueries({ queryKey: ["note"] }),
    // a body edit can add/complete checkboxes — the Tasks projection re-derives
    queryClient.invalidateQueries({ queryKey: keys.tasks }),
  ]);
}

/** A NEW item exists but no existing note changed: refetch the listings only.
 * Creation used invalidateNotes(), which also refetched every open tab's body
 * (`["note"]`) and re-walked the Tasks projection — three corpus round trips
 * for a blank note nobody has typed into yet (Command-T lag, 2026-09-01). */
export async function invalidateNoteLists(): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: ["notes"] });
}

/** Scoped cache refresh after ONE note's body sync — the editor's 400ms tick.
 * invalidateNotes() here fanned into ~9 uncached full-vault walks per tick
 * (perf audit 2026-07-30, #1): with staleTime ∞, invalidating ["notes"]
 * refetches every mounted listing, and each listing is a corpus_list walk.
 * A body sync already HAS the fresh note — so patch it into the caches
 * directly: zero refetches, zero walks. Structural ops (create/move/trash/
 * restore/external change) still use invalidateNotes().
 *
 * List caches are touched ONLY when a row would visibly change (title,
 * snippet, pin, or the updatedAt label drifting past a minute) — steady
 * mid-body typing leaves every list identity untouched, so useNoteIndex,
 * TabStrip, and the note lists don't re-derive per tick. */
export function applyNoteWrite(note: Note, opts?: { tasksChanged?: boolean }): Promise<void> {
  const { body: _body, ...summary } = note;
  queryClient.setQueryData(keys.note(note.id), note);
  const entries = queryClient.getQueriesData<NoteSummary[]>({ queryKey: ["notes"] });
  // judge rowChanged against the FRESHEST cached copy across every list — if
  // caches ever diverged (an interrupted earlier patch), the stalest copy must
  // not answer "nothing changed" for the rest (Greptile, PR #13)
  let cached: NoteSummary | undefined;
  for (const [, data] of entries) {
    const hit = data?.find((n) => n.id === note.id);
    if (hit && (!cached || hit.updatedAt > cached.updatedAt)) cached = hit;
  }
  const rowChanged =
    !!cached &&
    (cached.title !== summary.title ||
      cached.snippet !== summary.snippet ||
      cached.bodyEmpty !== summary.bodyEmpty ||
      cached.pinned !== summary.pinned ||
      Math.abs(summary.updatedAt - cached.updatedAt) >= 60_000);
  if (rowChanged) {
    for (const [key, data] of entries) {
      if (!data?.some((n) => n.id === note.id)) continue;
      const next = data.map((n) => (n.id === note.id ? { ...n, ...summary } : n)).sort(summaryOrder);
      queryClient.setQueryData(key, next);
    }
  }
  // a checkbox add/toggle re-derives the Tasks projection; anything else skips
  // the corpus_tasks walk entirely
  return opts?.tasksChanged ? queryClient.invalidateQueries({ queryKey: keys.tasks }) : Promise.resolve();
}

export async function invalidateFolders(): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: keys.folders });
}

/** Notes AND folders together — a lifecycle change shifts both the lists and
 * the hidden-root counts (restore can even resurrect a folder). */
async function invalidateBoth(): Promise<void> {
  await invalidateNotes();
  await invalidateFolders();
}

/** The brain change journal, raw — consumers fold it with `deriveJournal` (the
 * one grammar). Refreshed by the daemon's `rotli:brain-journal` event (App.tsx)
 * and after every frontend journal write (approve/dismiss/undo/file). */
export function useJournal() {
  return useQuery({ queryKey: keys.journal, queryFn: readJournal });
}

/** Live daemon status (Activity's secure-skip + offline lines, Settings → Brain).
 * Rides the journal invalidation beat — the daemon emits `rotli:brain-journal`
 * on STATUS-ONLY changes too (secrets skipped, model offline/back), every cycle
 * boundary emits `rotli:organizer-progress`, and the watcher that grows the
 * queue emits `rotli:corpus-changed`. All three are invalidation sources in
 * App.tsx, so the 60s backstop poll was pure duplication (perf audit
 * 2026-07-30, finding 23). */
export function useOrganizerStatus() {
  return useQuery({ queryKey: keys.organizer, queryFn: organizerStatus });
}

/** Legacy secure-intake notes awaiting the explicit repair (decision
 * 2026-07-22) — the Activity pane's preview. Rides the journal invalidation
 * beat (event-driven; see useOrganizerStatus). */
export function useSecureRepair() {
  return useQuery({ queryKey: keys.secureRepair, queryFn: secureRepairScan });
}

/** The secure-review rows (feature B): detector-only notes awaiting the user's
 * Make secure / Not sensitive answer, plus flagged leftovers. Same beat — and
 * this one is mounted for the app's lifetime (the sidebar badge), so its poll
 * was the one that never stopped. */
export function useSecureHints() {
  return useQuery({ queryKey: keys.secureHints, queryFn: organizerSecureHints });
}

/** The Tasks projection (decision 2026-07-25) — every open checkbox, derived
 * per call. Rides the notes invalidation beat (a toggle IS a note edit). */
export function useTasks() {
  return useQuery({ queryKey: keys.tasks, queryFn: corpusTasks });
}

export async function invalidateJournal(): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: keys.journal });
  await queryClient.invalidateQueries({ queryKey: keys.organizer });
  await queryClient.invalidateQueries({ queryKey: keys.secureRepair });
  await queryClient.invalidateQueries({ queryKey: keys.secureHints });
}

// ——— lifecycle (Phase 2c): a note's home changes (archive/trash/restore).

export function useArchiveNote() {
  return useMutation({
    mutationFn: (id: string) => archiveNoteWithImages(id),
    onSuccess: invalidateBoth,
    onError: lifecycleError("archive"),
  });
}

export function useTrashNote() {
  return useMutation({
    mutationFn: (id: string) => trashNoteWithImages(id),
    onSuccess: invalidateBoth,
    onError: lifecycleError("delete"),
  });
}

/** Trash every durable item referenced by one virtual Main/view folder. Files
 * are preflighted before the first write; notes/boards then use the same
 * lifecycle lanes as their individual menus. A partial runtime failure keeps
 * the virtual folder in place and reports exact progress instead of pretending
 * the batch was atomic. */
export function useTrashItems() {
  return useMutation({
    mutationFn: (items: NoteSummary[]) =>
      trashVirtualFolderItems(items, {
        fileStat: corpusFileStat,
        moveFile: corpusMoveFileToSink,
        trashNote: (id) => trashNoteWithImages(id),
      }),
    onError: (error) =>
      useUiStore
        .getState()
        .setRowActionError(
          `Couldn’t move these items to Trash — ${error instanceof Error ? error.message : String(error)}`,
        ),
    onSettled: invalidateBoth,
  });
}

/** Rename a note = rewrite its first H1. H1-less legacy notes adopt one at
 * their former first-non-empty title line. Composed from getNote + updateNote. */
export function useRenameNote() {
  return useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => {
      const t = title.trim();
      if (!t) return;
      const note = await notesService.getNote(id);
      if (!note) throw new Error(`unknown note: ${id}`);
      await notesService.updateNote(id, replaceTitleLine(note.body ?? "", t), note.revision, note.body);
    },
    onSuccess: async () => {
      await invalidateNotes();
    },
  });
}

export function useRestoreNote() {
  return useMutation({
    mutationFn: (id: string) => notesService.restoreNote(id),
    onSuccess: invalidateBoth,
    onError: lifecycleError("restore"),
  });
}
