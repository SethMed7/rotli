// Board composition root — the only board module that joins the Tauri corpus
// store with the session core. Surfaces get a loader + a debounced saver and
// never touch corpusReadBoard/corpusWriteBoard themselves.

import { corpusReadBoard, corpusWriteBoard, isTauri } from "../lib/tauri";
import { type BoardSaver, type LoadedBoard, createBoardSaver, parseBoardBody } from "./session";

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
