import { parseBlock } from "./render";

interface ImageDropEditor {
  posAtCoords(coords: { x: number; y: number }): number | null;
  state: {
    selection: { main: { head: number } };
    doc: { lineAt(pos: number): { from: number; to: number; text: string } };
  };
  dispatch(spec: { changes: { from: number; insert: string }; selection: { anchor: number } }): void;
  focus(): void;
}

type ImportFile = (path: string) => Promise<string>;

/**
 * Import image files and insert their Markdown at the pointer position captured
 * when the drop occurred. Importing may be slow enough for the editor layout or
 * selection to change, so the target must not be resolved after the await.
 */
export async function importImagesAtDrop(
  view: ImageDropEditor,
  paths: string[],
  point: { x: number; y: number },
  importFile: ImportFile,
): Promise<void> {
  const at = view.posAtCoords(point) ?? view.state.selection.main.head;
  const line = view.state.doc.lineAt(at);
  const block = parseBlock(line.text);
  const fillsEmptyListItem =
    (block.kind === "bullet" || block.kind === "numbered" || block.kind === "task") &&
    block.text.trim() === "" &&
    at >= line.from + block.prefixLen;
  const wires = await Promise.all(paths.map((path) => importFile(path)));
  let insert = "";
  for (const wire of wires.filter(Boolean)) {
    const image = `![](storage:${wire.replace(/^storage\//i, "")})`;
    if (fillsEmptyListItem) {
      if (insert) insert += `\n${" ".repeat(block.prefixLen)}`;
      insert += image;
    } else {
      insert += `\n${image}\n`;
    }
  }
  if (fillsEmptyListItem && insert) insert += "\n";
  if (!insert) return;
  view.dispatch({
    changes: { from: at, insert },
    selection: { anchor: at + insert.length },
  });
  view.focus();
}
