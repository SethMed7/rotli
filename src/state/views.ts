// Portable named-view projections. Main remains in state/main.ts; this store
// owns only `.rotli/views.json` plus save/read-only status for the switcher.

import { create } from "zustand";

import { corpusViewsRead, corpusViewsWrite, hasDurableCorpus } from "../lib/tauri";
import {
  createRevisionedTrackedWrite,
  isRevisionConflict,
  recoverRevisionConflict,
} from "../lib/trackedWrite";
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

/** Shown only when views.json really changed on disk under an edit made here
 * (main.ts MAIN_RELOADED_NOTICE is the twin). */
export const VIEWS_RELOADED_NOTICE =
  "Your views changed outside Rotli, so your last change wasn’t kept. Make it again.";

export const useViewsStore = create<ViewsState>((set, get) => ({
  manifest: EMPTY_VIEWS,
  writable: true,
  hydrated: false,
  saveState: "idle",
  error: null,
  dirty: false,
  setManifest: (manifest) => {
    if (!get().writable) return;
    const durable = hasDurableCorpus();
    set({ manifest, saveState: durable ? "saving" : "saved", error: null, dirty: durable });
    if (durable) persistViews(manifest, true);
  },
}));

function persistViews(manifest: ViewsManifest, mayRecover: boolean): void {
  viewsWriter.write(serializeViewsManifest(manifest), (ok, error) => {
    if (ok) useViewsStore.setState({ saveState: "saved", dirty: false });
    else if (isRevisionConflict(error)) void recoverViews(manifest, mayRecover);
    else
      useViewsStore.setState({
        saveState: "error",
        error: `Couldn’t save views — ${error instanceof Error ? error.message : String(error)}`,
      });
  });
}

/** The same quiet recovery as Main, without a merge: a view's membership is
 * validated as a whole by the host, so this edit is saved again only when the
 * file's contents turn out unchanged (the revision alone moved). Otherwise the
 * disk version shows. `dirty` always clears, so hydrateViews is never locked
 * out the way one conflict used to lock it until a restart. */
async function recoverViews(local: ViewsManifest, mayRetry: boolean): Promise<void> {
  try {
    const outcome = await recoverRevisionConflict({
      writer: viewsWriter,
      read: corpusViewsRead,
      current: () => useViewsStore.getState().manifest === local,
      merge: (base, remote) => (mayRetry && base === remote ? serializeViewsManifest(local) : null),
    });
    if (!outcome) return;
    if (outcome.merged !== null) {
      persistViews(local, false);
      return;
    }
    const parsed = parseViewsManifest(outcome.remote || "{}");
    useViewsStore.setState({
      manifest: parsed.manifest,
      writable: parsed.writable,
      saveState: "error",
      error: parsed.error ?? VIEWS_RELOADED_NOTICE,
      dirty: false,
    });
  } catch (error) {
    useViewsStore.setState({
      saveState: "error",
      error: `Couldn’t save views — ${error instanceof Error ? error.message : String(error)}`,
      dirty: false,
    });
  }
}

/** Hydrate on launch and after an external CLI/MCP write. Unsupported future
 * formats stay read-only; malformed v1 data degrades to Main with an error. */
export async function hydrateViews(): Promise<void> {
  if (useViewsStore.getState().dirty) return;
  try {
    const opened = await corpusViewsRead();
    viewsWriter.setRevision(opened.revision, opened.contents);
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

export function resetViewsForVaultSwitch(): void {
  useViewsStore.setState({
    manifest: EMPTY_VIEWS,
    writable: true,
    hydrated: false,
    saveState: "idle",
    error: null,
    dirty: false,
  });
}
