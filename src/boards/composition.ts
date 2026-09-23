// Board composition root — the only board module that joins the board store
// (the Mac corpus, or Rotli Web's connected vault: services/boardStore.ts)
// with the session core. Surfaces get a loader + a debounced saver and never
// touch the store themselves.

import { createManagedBoardWithBody } from "../newItems/composition";
import { boardStore, boardsAvailable } from "../services/boardStore";
import { usePanesStore } from "../state/panes";
import { convertMermaidToBoardScene } from "./engine/mermaid";
import {
  EMPTY_BOARD_META,
  EMPTY_SCENE,
  type BoardSaver,
  type LoadedBoard,
  createBoardSaver,
  parseBoardBody,
  serializeBoardScene,
} from "./session";

/** Whether this session can open boards at all (a plain browser with no vault
 * can't) — surfaces show a placeholder instead of a canvas when it can't. */
export { boardsAvailable };

/** Whether "Reveal original" can show the file (the Mac app; not the web). */
export function canRevealBoards(): boolean {
  return boardsAvailable() && boardStore().reveal !== null;
}

/** Read a board from its store (the *.excalidraw file is the source of truth). */
export async function loadBoard(boardId: string): Promise<LoadedBoard> {
  const doc = await boardStore().read(boardId);
  return { ...parseBoardBody(doc.body), revision: doc.revision };
}

/** With nowhere to keep boards (a plain browser), writes are no-ops. */
export function createCorpusBoardSaver(
  boardId: string,
  onResult?: (error: string | null) => void,
): BoardSaver {
  let revision: string | null = null;
  const saver = createBoardSaver(async (body) => {
    if (!boardsAvailable()) return;
    if (!revision) throw new Error("This board has no save revision. Reload it before editing.");
    const result = await boardStore().write(boardId, body, revision);
    revision = result.revision;
  }, onResult);
  return {
    ...saver,
    prime(body, loadedRevision) {
      if (loadedRevision) revision = loadedRevision;
      saver.prime(body, loadedRevision);
    },
  };
}

export async function revealBoardSource(boardId: string): Promise<void> {
  const reveal = boardStore().reveal;
  if (!reveal) throw new Error("Revealing a file isn’t available in the browser.");
  await reveal(boardId);
}

/** Destructive recovery is deliberately separate from load/autosave and may be
 * called only after the UI has obtained explicit confirmation. */
export async function replaceCorruptBoardWithEmptyScene(boardId: string): Promise<void> {
  const store = boardStore();
  const current = await store.read(boardId);
  const body = serializeBoardScene({
    elements: EMPTY_SCENE.elements,
    appState: EMPTY_SCENE.appState,
    files: EMPTY_SCENE.files,
    meta: EMPTY_BOARD_META,
  });
  await store.write(boardId, body, current.revision);
}

/** Create an explicit, independently editable board COPY from Mermaid source.
 * Mermaid has no durable absolute-position syntax, so freeform edits belong to
 * the new .excalidraw file while the original Markdown fence stays untouched.
 * `besideNoteId` files the board in the source note's Main folder / named view
 * (the maintainer, 2026-07-29: "it should put it in the same path I am in"); `open:
 * false` skips the new tab (the replace-with-embed flow shows it inline). */
export async function createEditableBoardFromMermaid(
  definition: string,
  opts: { besideNoteId?: string; open?: boolean; name?: string; rootId?: string } = {},
): Promise<string> {
  if (!boardsAvailable()) throw new Error("Editable board conversion needs a vault folder.");
  const source = definition.trim();
  if (!source) throw new Error("Add Mermaid source before creating a board copy.");

  const scene = await convertMermaidToBoardScene(source);
  const body = serializeBoardScene({
    elements: scene.elements,
    appState: {},
    files: scene.files,
    meta: EMPTY_BOARD_META,
  });
  const board = await createManagedBoardWithBody(body, opts.name?.trim() || "Diagram", {
    open: false,
    ...(opts.besideNoteId ? { besideNoteId: opts.besideNoteId } : {}),
    ...(opts.rootId ? { rootId: opts.rootId } : {}),
  });
  if (opts.open !== false) {
    usePanesStore.getState().openCanvas(board.id, { newTab: true });
  }
  return board.id;
}
