// Portable named-view projections. Main remains in state/main.ts; this store
// owns only `.rotli/views.json` plus save/read-only status for the switcher.

import { create } from "zustand";

import { corpusViewsRead, corpusViewsWrite, isTauri } from "../lib/tauri";
import { createRevisionedTrackedWrite } from "../lib/trackedWrite";
import {
  EMPTY_VIEWS,
  type ViewsManifest,
  parseViewsManifest,
  serializeViewsManifest,
} from "../services/viewTree";

export type ViewsSaveState = "idle" | "saving" | "saved" | "error";

interface ViewsState {
  manifest: ViewsManifest;
  writable: boolean;
  hydrated: boolean;
  saveState: ViewsSaveState;
  error: string | null;
  dirty: boolean;
  setManifest: (manifest: ViewsManifest) => void;
}

// the shared latest-wins guard (lib/trackedWrite) — this store's original
// inline writeSequence, extracted so main.ts uses the identical policy
const viewsWriter = createRevisionedTrackedWrite(corpusViewsWrite);

export const useViewsStore = create<ViewsState>((set, get) => ({
  manifest: EMPTY_VIEWS,
  writable: true,
  hydrated: false,
  saveState: "idle",
  error: null,
  dirty: false,
  setManifest: (manifest) => {
    if (!get().writable) return;
    set({ manifest, saveState: isTauri() ? "saving" : "saved", error: null, dirty: isTauri() });
    if (!isTauri()) return;
    viewsWriter.write(serializeViewsManifest(manifest), (ok, error) => {
      if (ok) set({ saveState: "saved", dirty: false });
      else
        set({
          saveState: "error",
          error: `Couldn’t save views — ${error instanceof Error ? error.message : String(error)}`,
        });
    });
  },
}));

/** Hydrate on launch and after an external CLI/MCP write. Unsupported future
 * formats stay read-only; malformed v1 data degrades to Main with an error. */
export async function hydrateViews(): Promise<void> {
  if (useViewsStore.getState().dirty) return;
  try {
    const opened = await corpusViewsRead();
    viewsWriter.setRevision(opened.revision);
    const parsed = parseViewsManifest(opened.contents || "{}");
    useViewsStore.setState({
      manifest: parsed.manifest,
      writable: parsed.writable,
      hydrated: true,
      saveState: parsed.error ? "error" : "idle",
      error: parsed.error,
      dirty: false,
    });
  } catch (error) {
    useViewsStore.setState({
      manifest: EMPTY_VIEWS,
      writable: true,
      hydrated: true,
      saveState: "error",
      error: `Couldn’t load views — ${error instanceof Error ? error.message : String(error)}`,
      dirty: false,
    });
  }
}
