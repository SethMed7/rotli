// The Quick Note set (Seth, 2026-06-15): a small, capped, curated list of
// notes the floating Quick window cycles through. Mutations here apply to the
// ui store AND emit to the other webview — the same one-keymap-two-webviews
// sync the rebinds use (lib/tauri emitQuickSet/onQuickSet). Only the MAIN
// window persists (the single settings.json writer); the quick window emits its
// changes so main records them.

import { type QuickStatePayload, emitQuickSet } from "../lib/tauri";
import { useUiStore } from "./ui";

/** The cap — Seth: "maybe only have five notes within this." Search swaps the
 * set members out without raising the ceiling. */
export const QUICK_MAX = 5;

function snapshot(): QuickStatePayload {
  const s = useUiStore.getState();
  return { ids: s.quickNoteIds, activeId: s.quickActiveId, folder: s.quickFolder };
}

/** Apply locally + tell the other webview (no echo — the receiver uses
 * applyQuickState, which never re-emits). */
function commit(patch: Partial<QuickStatePayload>): void {
  const cur = snapshot();
  const next: QuickStatePayload = {
    ids: patch.ids ?? cur.ids,
    activeId: patch.activeId !== undefined ? patch.activeId : cur.activeId,
    folder: patch.folder ?? cur.folder,
  };
  useUiStore.setState({
    quickNoteIds: next.ids,
    quickActiveId: next.activeId,
    quickFolder: next.folder,
  });
  emitQuickSet(next);
}

/** Add a note to the set and make it active. Already in the set → just focus
 * it. Room left → insert right after the active note (kept adjacent), else
 * append. Full → swap the chosen note into the active slot ("change out those
 * five at any time"). */
export function addQuickNote(id: string): void {
  const { quickNoteIds: ids, quickActiveId: active } = useUiStore.getState();
  if (ids.includes(id)) {
    commit({ activeId: id });
    return;
  }
  const i = active ? ids.indexOf(active) : -1;
  if (ids.length < QUICK_MAX) {
    const next = i >= 0 ? [...ids.slice(0, i + 1), id, ...ids.slice(i + 1)] : [...ids, id];
    commit({ ids: next, activeId: id });
    return;
  }
  const at = i >= 0 ? i : 0;
  commit({ ids: ids.map((x, k) => (k === at ? id : x)), activeId: id });
}

/** Drop a note from the set; if it was active, fall to the note that slid into
 * its place (or the new last, or empty). */
export function removeQuickNote(id: string): void {
  const { quickNoteIds: ids, quickActiveId: active } = useUiStore.getState();
  if (!ids.includes(id)) return;
  const i = ids.indexOf(id);
  const next = ids.filter((x) => x !== id);
  const activeId = active === id ? (next[Math.min(i, next.length - 1)] ?? null) : active;
  commit({ ids: next, activeId });
}

export function setQuickActive(id: string): void {
  commit({ activeId: id });
}

/** Step the active note through the set, wrapping. dir = +1 next / -1 prev. */
export function cycleQuick(dir: 1 | -1): void {
  const { quickNoteIds: ids, quickActiveId: active } = useUiStore.getState();
  if (ids.length === 0) return;
  const i = active ? ids.indexOf(active) : -1;
  const base = i >= 0 ? i : 0;
  commit({ activeId: ids[(base + dir + ids.length) % ids.length] ?? null });
}

export function setQuickFolderSynced(folder: string): void {
  commit({ folder });
}

/** Drop ids whose notes no longer exist (deleted since last run) and repair the
 * active pointer — called once the corpus list resolves in the quick window. */
export function pruneQuick(alive: Set<string>): void {
  const { quickNoteIds: ids, quickActiveId: active } = useUiStore.getState();
  const kept = ids.filter((id) => alive.has(id));
  const activeId = active && kept.includes(active) ? active : (kept[0] ?? null);
  if (kept.length === ids.length && activeId === active) return;
  commit({ ids: kept, activeId });
}

/** Apply a set that arrived from the other webview — store only, no echo. */
export function applyQuickState(state: QuickStatePayload): void {
  useUiStore.setState({
    quickNoteIds: state.ids,
    quickActiveId: state.activeId,
    quickFolder: state.folder,
  });
}
