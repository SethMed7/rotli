// Board composition root — the only board module that joins the Tauri corpus
// store with the session core. Surfaces get a loader + a debounced saver and
// never touch corpusReadBoard/corpusWriteBoard themselves.

import { corpusReadBoard, corpusRevealFile, corpusWriteBoard, isTauri } from "../lib/tauri";
import { createManagedBoardWithBody } from "../newItems/composition";
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

/** Read a board from the corpus (the *.excalidraw file is the source of truth). */
export async function loadBoard(boardId: string): Promise<LoadedBoard> {
  const doc = await corpusReadBoard(boardId);
  return parseBoardBody(doc.body);
}

/** Outside the Tauri shell the corpus doesn't exist — writes are no-ops. */
export function createCorpusBoardSaver(
  boardId: string,
  onResult?: (error: string | null) => void,
): BoardSaver {
  return createBoardSaver(
    (body) => (isTauri() ? corpusWriteBoard(boardId, body).then(() => undefined) : Promise.resolve()),
    onResult,
  );
}

export async function revealBoardSource(boardId: string): Promise<void> {
  await corpusRevealFile(boardId);
}

/** Destructive recovery is deliberately separate from load/autosave and may be
 * called only after the UI has obtained explicit confirmation. */
export async function replaceCorruptBoardWithEmptyScene(boardId: string): Promise<void> {
  const body = serializeBoardScene({
    elements: EMPTY_SCENE.elements,
    appState: EMPTY_SCENE.appState,
    files: EMPTY_SCENE.files,
    meta: EMPTY_BOARD_META,
  });
  await corpusWriteBoard(boardId, body);
}

/** Create an explicit, independently editable board COPY from Mermaid source.
 * Mermaid has no durable absolute-position syntax, so freeform edits belong to
 * the new .excalidraw file while the original Markdown fence stays untouched.
 * `besideNoteId` files the board in the source note's Main folder / named view
 * (Seth, 2026-07-29: "it should put it in the same path I am in"); `open:
 * false` skips the new tab (the replace-with-embed flow shows it inline). */
export async function createEditableBoardFromMermaid(
  definition: string,
  opts: { besideNoteId?: string; open?: boolean; name?: string } = {},
): Promise<string> {
  if (!isTauri()) throw new Error("Editable board conversion requires the Rotli desktop app.");
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
  });
  if (opts.open !== false) {
    usePanesStore.getState().openCanvas(board.id, { newTab: true });
  }
  return board.id;
}
