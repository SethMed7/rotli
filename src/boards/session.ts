// Board session core — the ONE implementation of the .excalidraw corpus
// round-trip (fail-closed parsing, canonical serialization,
// debounced save) shared by the canvas surface and the ```board fence embed.
// Engine-agnostic and Tauri-free: it knows the scene JSON shape only;
// composition.ts injects the corpus writer.

import { createDebouncedTask } from "../lib/debouncedTask";
import { parseAndValidateBoard } from "./validation";

export const BOARD_SAVE_DEBOUNCE_MS = 500;

/** A minimal valid empty Excalidraw scene, used only for an intentionally empty
 * new file or an explicit user-confirmed repair. */
export const EMPTY_SCENE = {
  type: "excalidraw" as const,
  version: 2,
  source: "rotli",
  elements: [],
  appState: {},
  files: {},
};

/** G — board metadata (Seth, 2026-06-26): a board is an image to a text LLM, so
 * it carries a description + tags, stored TOP-LEVEL in the .excalidraw (NOT in
 * appState, which Excalidraw would strip) so the AI can know + search it later. */
export interface BoardMeta {
  description: string;
  tags: string;
}
export const EMPTY_BOARD_META: BoardMeta = { description: "", tags: "" };

export interface LoadedBoard {
  scene: unknown;
  meta: BoardMeta;
}

/** Parse and fully validate a raw .excalidraw body. Corrupt or oversized input
 * throws before a canvas mounts, preserving the original source until the user
 * explicitly chooses a recovery action. */
export function parseBoardBody(body: string): LoadedBoard {
  if (!body.trim()) {
    throw new Error("The board file is empty. The original file was not changed.");
  }
  const scene = parseAndValidateBoard(body);
  const rm = (scene as { rotliMeta?: Partial<BoardMeta> }).rotliMeta;
  return { scene, meta: { description: rm?.description ?? "", tags: rm?.tags ?? "" } };
}

/** The appState keys that are CONTENT, not viewport churn. Excalidraw's live
 * appState carries scroll/zoom/selection/tool — persisting those meant panning
 * a board rewrote the file (git noise in a vault that IS a git repo, mtime
 * feeding recency). Only the durable canvas choices survive a save. */
const DURABLE_APP_STATE = ["viewBackgroundColor", "gridSize", "gridModeEnabled", "gridStep"] as const;

function durableAppState(appState: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of DURABLE_APP_STATE) {
    if (appState[key] !== undefined) out[key] = appState[key];
  }
  return out;
}

/** Canonical on-disk scene JSON. Volatile UI state (collaborators, viewport,
 * selection, tool) is stripped so saves stay diff-friendly; rotliMeta always
 * rides top-level so no save path can drop the board's AI description/tags. */
export function serializeBoardScene(parts: {
  elements: readonly unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
  meta: BoardMeta;
}): string {
  const body = JSON.stringify({
    type: "excalidraw" as const,
    version: 2,
    source: "rotli",
    elements: parts.elements,
    appState: durableAppState(parts.appState),
    files: parts.files,
    rotliMeta: parts.meta,
  });
  parseAndValidateBoard(body);
  return body;
}

export interface BoardSaver {
  /** The just-loaded canonical body — a later save identical to it is skipped
   * (opening/panning a board must never touch the file). */
  prime(body: string): void;
  /** Stash the freshest BUILDER and (re)arm the trailing debounce. The builder
   * runs at most once per drain — Excalidraw fires onChange per pointer move,
   * and serializing megabytes per event was the big-board perf cliff. */
  schedule(build: () => string): void;
  /** Write immediately (metadata edits don't ride the Excalidraw onChange). */
  saveNow(body: string): void;
  /** Cancel the timer and write anything pending (unmount / board switch).
   * Returns the write's settling promise so quit-flush can HOLD the ack on it —
   * a discarded promise acked quit before the board's bytes landed. */
  flush(): Promise<void>;
}

/** Debounced writer behind every board save path, so pending-body semantics and
 * failure surfacing can't drift between surfaces. `onResult` receives the write
 * (or serialization) error — or null on success — when the caller shows save
 * state. Unchanged bodies never hit the disk. */
export function createBoardSaver(
  write: (body: string) => Promise<void>,
  onResult?: (error: string | null) => void,
): BoardSaver {
  let pendingBuild: (() => string) | null = null;
  let lastSaved: string | null = null;
  const put = (body: string): Promise<void> =>
    write(body).then(
      () => {
        lastSaved = body;
        onResult?.(null);
      },
      (e: unknown) => onResult?.(e instanceof Error ? e.message : String(e)),
    );
  const task = createDebouncedTask(BOARD_SAVE_DEBOUNCE_MS, () => {
    const build = pendingBuild;
    pendingBuild = null;
    if (!build) return;
    let body: string;
    try {
      body = build();
    } catch (e) {
      onResult?.(e instanceof Error ? e.message : String(e));
      return;
    }
    if (body === lastSaved) return; // viewport churn, selection, a no-op — skip
    return put(body);
  });
  return {
    prime(body) {
      lastSaved = body;
    },
    schedule(build) {
      pendingBuild = build;
      task.schedule();
    },
    saveNow(body) {
      void put(body);
    },
    flush() {
      return task.flush();
    },
  };
}
