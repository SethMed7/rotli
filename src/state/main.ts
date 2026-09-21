// The Main arrangement store — the user's hand-organized view over the Brain
// (design: memex-vault wiki/projects/rotli/main-brain-daemon.md). The manifest lives in `.rotli/main.json`
// (committed, so it travels with the memex). Every mutation (a drag, a new folder)
// replaces the tree and persists; hydration loads it before first render.

import { create } from "zustand";

import { corpusMainRead, corpusMainWrite, hasDurableCorpus } from "../lib/tauri";
import {
  createRevisionedTrackedWrite,
  isRevisionConflict,
  recoverRevisionConflict,
} from "../lib/trackedWrite";
import {
  EMPTY_MAIN,
  type MainManifest,
  type MainNode,
  gcManifest,
  mainHasNote,
  mergeMainTrees,
  parseMainManifest,
  renameNoteRef,
  serializeMainManifest,
} from "../services/mainTree";

export type MainSaveState = "idle" | "saving" | "saved" | "error";

interface MainState {
  manifest: MainManifest;
  saveState: MainSaveState;
  error: string | null;
  dirty: boolean;
  /** Replace the Main tree and persist. Pass `liveIds` to prune dead note-refs
   * (ids whose note no longer exists) on save — empty folders are kept. */
  setTree: (tree: MainNode[], liveIds?: Set<string>) => void;
}

/** Only the MAIN webview ever hydrates the manifest (persist.ts gates
 * hydrateMain) — quick/capture hold EMPTY_MAIN, so a setTree from them would
 * overwrite .rotli/main.json with a near-empty tree. Hard-refuse off-main.
 * (Duplicated 2-line check, not imported from persist.ts — that would cycle.) */
function isMainSurface(): boolean {
  if (typeof window === "undefined") return true; // bun tests have no window
  return (new URLSearchParams(window.location.search).get("window") ?? "main") === "main";
}

// back-to-back setTree calls (drags, draft composition) race their writes —
// only the LATEST call's outcome may report, or a stale completion masks a
// lost arrangement (audit 2026-07-30, correctness #3; same guard as views.ts)
const mainWriter = createRevisionedTrackedWrite(corpusMainWrite);

/** Shown only when Main was rearranged on disk while a different arrangement
 * was being made here — the one case with no honest merge. Plain words: the
 * revision ids behind it mean nothing to the person reading. */
export const MAIN_RELOADED_NOTICE =
  "Main changed outside Rotli, so your last change wasn’t kept. Make it again.";

export const useMainStore = create<MainState>((set) => ({
  manifest: EMPTY_MAIN,
  saveState: "idle",
  error: null,
  dirty: false,
  setTree: (tree, liveIds) => {
    if (!isMainSurface()) {
      console.warn("main.json write refused off the main surface");
      return;
    }
    const cleaned = liveIds ? gcManifest(tree, liveIds) : tree;
    const manifest: MainManifest = { version: 1, tree: cleaned };
    const durable = hasDurableCorpus();
    set({ manifest, saveState: durable ? "saving" : "saved", error: null, dirty: durable });
    if (durable) persistMain(manifest, true);
  },
}));

function persistMain(manifest: MainManifest, mayRecover: boolean): void {
  mainWriter.write(serializeMainManifest(manifest), (ok, error) => {
    if (ok) useMainStore.setState({ saveState: "saved", dirty: false });
    else if (isRevisionConflict(error)) void recoverMain(manifest, mayRecover);
    else
      useMainStore.setState({
        saveState: "error",
        error: `Couldn’t save Main — ${error instanceof Error ? error.message : String(error)}`,
      });
  });
}

/** Something else (the CLI, the Librarian, a views write) saved Main first.
 * Re-read it, carry this edit over the new version, and save once more —
 * quietly. `dirty` always clears on the way out: a stuck flag is what used to
 * lock hydrateMain out and fail every later edit until a restart. */
async function recoverMain(local: MainManifest, mayRetry: boolean): Promise<void> {
  try {
    const outcome = await recoverRevisionConflict({
      writer: mainWriter,
      read: corpusMainRead,
      current: () => useMainStore.getState().manifest === local,
      merge: (base, remote) => {
        if (!mayRetry) return null;
        const tree = mergeMainTrees(
          parseMainManifest(base || "{}").tree,
          local.tree,
          parseMainManifest(remote || "{}").tree,
        );
        return tree && serializeMainManifest({ version: 1, tree });
      },
    });
    if (!outcome) return;
    if (outcome.merged === null) {
      useMainStore.setState({
        manifest: parseMainManifest(outcome.remote || "{}"),
        saveState: "error",
        error: MAIN_RELOADED_NOTICE,
        dirty: false,
      });
      return;
    }
    const manifest = parseMainManifest(outcome.merged);
    useMainStore.setState({ manifest });
    persistMain(manifest, false);
  } catch (error) {
    useMainStore.setState({
      saveState: "error",
      error: `Couldn’t save Main — ${error instanceof Error ? error.message : String(error)}`,
      dirty: false,
    });
  }
}

/** Retarget a Main note-ref after a path-id rename (boards: rename mints a new
 * id) — the manifest slot follows the note instead of being GC'd on the next
 * setTree (#33, audit 2026-07). No liveIds on purpose: a rename must never
 * double as a prune. No-op when the old id isn't in Main. */
export function renameMainRef(oldId: string, newId: string): void {
  const { manifest, setTree } = useMainStore.getState();
  if (mainHasNote(manifest.tree, oldId)) setTree(renameNoteRef(manifest.tree, oldId, newId));
}

/** Load `.rotli/main.json` into the store — called from hydratePersistedState so the
 * Main view is right on the first paint. Missing/corrupt → empty Main, never a crash. */
export async function hydrateMain(): Promise<void> {
  if (useMainStore.getState().dirty) return;
  try {
    const opened = await corpusMainRead();
    mainWriter.setRevision(opened.revision, opened.contents);
    useMainStore.setState({
      manifest: parseMainManifest(opened.contents || "{}"),
      saveState: "idle",
      error: null,
      dirty: false,
    });
  } catch (e) {
    console.warn("main.json hydrate failed", e);
  }
}

export function resetMainForVaultSwitch(): void {
  useMainStore.setState({
    manifest: EMPTY_MAIN,
    saveState: "idle",
    error: null,
    dirty: false,
  });
}
