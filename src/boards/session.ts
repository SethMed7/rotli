// Board session core — the ONE implementation of the .excalidraw corpus
// round-trip (parse with blank-scene fallback, canonical serialization,
// debounced save) shared by the canvas surface and the ```board fence embed.
// Engine-agnostic and Tauri-free: it knows the scene JSON shape only;
// composition.ts injects the corpus writer.

import { createDebouncedTask } from "../lib/debouncedTask";

export const BOARD_SAVE_DEBOUNCE_MS = 500;

/** A minimal valid empty Excalidraw scene (used when the file is empty/new or
 * the JSON fails to parse — never throw a blank board away). */
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

/** Parse a raw .excalidraw body. Empty or corrupt JSON yields the blank scene;
 * top-level rotliMeta is lifted out so every consumer carries it forward. */
export function parseBoardBody(body: string): LoadedBoard {
  let scene: unknown = EMPTY_SCENE;
  const raw = body.trim();
  if (raw) {
    try {
      scene = JSON.parse(raw);
    } catch {
      scene = EMPTY_SCENE; // corrupt JSON => start from a blank scene
    }
  }
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
  return JSON.stringify({
    type: "excalidraw" as const,
    version: 2,
    source: "rotli",
    elements: parts.elements,
    appState: { ...parts.appState, collaborators: undefined },
    files: parts.files,
    rotliMeta: parts.meta,
  });
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
