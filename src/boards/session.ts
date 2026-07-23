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

/** Canonical on-disk scene JSON. Volatile UI cruft (collaborators) is stripped
 * so saves stay diff-friendly; rotliMeta always rides top-level so no save path
 * can drop the board's AI description/tags. */
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
    appState: { ...parts.appState, collaborators: undefined },
    files: parts.files,
    rotliMeta: parts.meta,
  });
  parseAndValidateBoard(body);
  return body;
}

export interface BoardSaver {
  /** Stash the freshest body and (re)arm the trailing debounce. */
  schedule(body: string): void;
  /** Write immediately (metadata edits don't ride the Excalidraw onChange). */
  saveNow(body: string): void;
  /** Cancel the timer and write anything pending (unmount / board switch). */
  flush(): void;
}

/** Debounced writer behind every board save path, so pending-body semantics and
 * failure surfacing can't drift between surfaces. `onResult` receives the write
 * error (or null on success) when the caller shows save state. */
export function createBoardSaver(
  write: (body: string) => Promise<void>,
  onResult?: (error: string | null) => void,
): BoardSaver {
  let pendingBody: string | null = null;
  const put = (body: string): Promise<void> =>
    write(body).then(
      () => onResult?.(null),
      (e: unknown) => onResult?.(e instanceof Error ? e.message : String(e)),
    );
  const task = createDebouncedTask(BOARD_SAVE_DEBOUNCE_MS, () => {
    const body = pendingBody;
    pendingBody = null;
    if (body !== null) return put(body);
  });
  return {
    schedule(body) {
      pendingBody = body;
      task.schedule();
    },
    saveNow(body) {
      void put(body);
    },
    flush() {
      void task.flush();
    },
  };
}
