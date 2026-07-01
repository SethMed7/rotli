// The Main arrangement store — the user's hand-organized view over the Brain
// (design: docs/design/main-brain-daemon.md). The manifest lives in `.rotli/main.json`
// (committed, so it travels with the memex). Every mutation (a drag, a new folder)
// replaces the tree and persists; hydration loads it before first render.

import { create } from "zustand";
import { corpusMainWrite, corpusSettingsRead } from "../lib/tauri";
import {
  EMPTY_MAIN,
  type MainManifest,
  type MainNode,
  gcManifest,
  parseMainManifest,
  serializeMainManifest,
} from "../services/mainTree";

interface MainState {
  manifest: MainManifest;
  /** Replace the Main tree and persist. Pass `liveIds` to prune dead note-refs
   * (ids whose note no longer exists) on save — empty folders are kept. */
  setTree: (tree: MainNode[], liveIds?: Set<string>) => void;
}

export const useMainStore = create<MainState>((set) => ({
  manifest: EMPTY_MAIN,
  setTree: (tree, liveIds) => {
    const cleaned = liveIds ? gcManifest(tree, liveIds) : tree;
    const manifest: MainManifest = { version: 1, tree: cleaned };
    set({ manifest });
    void corpusMainWrite(serializeMainManifest(manifest)).catch((e) =>
      console.warn("main.json write failed", e),
    );
  },
}));

/** Load `.rotli/main.json` into the store — called from hydratePersistedState so the
 * Main view is right on the first paint. Missing/corrupt → empty Main, never a crash. */
export async function hydrateMain(): Promise<void> {
  try {
    const raw = await corpusSettingsRead("main");
    useMainStore.setState({ manifest: parseMainManifest(raw || "{}") });
  } catch (e) {
    console.warn("main.json hydrate failed", e);
  }
}
