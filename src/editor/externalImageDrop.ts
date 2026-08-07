interface ImageDropEditor {
  posAtCoords(coords: { x: number; y: number }): number | null;
  state: { selection: { main: { head: number } } };
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
  const wires = await Promise.all(paths.map((path) => importFile(path)));
  let insert = "";
  for (const wire of wires) {
    if (wire) insert += `\n![](storage:${wire.replace(/^storage\//i, "")})\n`;
  }
  if (!insert) return;
  view.dispatch({
    changes: { from: at, insert },
    selection: { anchor: at + insert.length },
  });
  view.focus();
}
