import { IMAGE_EXTS, VIDEO_EXTS, extOf } from "../lib/fileKind";
import { parseBlock } from "./render";

interface ImageDropEditor {
  dom?: { isConnected: boolean };
  posAtCoords(coords: { x: number; y: number }): number | null;
  state: {
    selection: { main: { head: number } };
    doc: { lineAt(pos: number): { from: number; to: number; text: string } };
  };
  dispatch(spec: { changes: { from: number; insert: string }; selection: { anchor: number } }): void;
  focus(): void;
}

type ImportFile = (path: string) => Promise<string>;

export interface DropPoint {
  x: number;
  y: number;
}

const NATIVE_IMAGE_EXTS = new Set([...IMAGE_EXTS, "svg", "ico"]);

/** Finder/WebKit may omit MIME metadata, so extension is the stable first
 * gate. Rust validates bytes independently for browser File imports. */
export function isImagePath(path: string): boolean {
  return NATIVE_IMAGE_EXTS.has(extOf(path));
}

/** What Markdown can host inline from a Finder drop or the attach picker:
 * images plus the video containers the file viewer already plays. Video rides
 * the path-copy lane only — the byte-backed fallback is capped for images. */
export function isEmbeddablePath(path: string): boolean {
  return isImagePath(path) || VIDEO_EXTS.has(extOf(path));
}

/** Tauri has emitted physical coordinates in some versions/platforms and
 * logical coordinates in others. Try the documented physical→CSS conversion
 * first, then the raw pair, so a runtime upgrade cannot silently route an
 * editor drop into generic Storage again. */
export function nativeDropPoints(px: number, py: number, devicePixelRatio: number): DropPoint[] {
  const scale = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const logical = { x: px / scale, y: py / scale };
  if (logical.x === px && logical.y === py) return [logical];
  return [logical, { x: px, y: py }];
}

/** `elementFromPoint` usually returns a nested line, mark, or image node. Ask
 * CodeMirror to resolve its own root instead of the arbitrary child: widget
 * children such as `<img>` do not carry CodeMirror's private tile marker. */
export function dropEditorHost(element: Element | null): HTMLElement | null {
  const direct = element?.closest(".cm-editor") as HTMLElement | null;
  if (direct) return direct;
  // A drop on the note's header, trail, or margins still means "this note":
  // the surface owns exactly one CodeMirror root. Before this, such a drop
  // silently imported to Storage and inserted nothing.
  const surface = element?.closest(".editor") as HTMLElement | null;
  return surface?.querySelector<HTMLElement>(".cm-editor") ?? null;
}

/** Imports return a corpus wire id (`storage/x.png` for the default root or
 * `vault:storage/x.png` for a named root). Markdown image refs are deliberately
 * root-relative, because the open note already owns the root context. */
export function storageImageSource(wire: string): string {
  const relative = wire.replace(/^[^/:]+:(?=storage\/)/i, "").replace(/^storage\//i, "");
  return `storage:${relative}`;
}

/**
 * Import image files and insert their Markdown at the pointer position captured
 * when the drop occurred. Importing may be slow enough for the editor layout or
 * selection to change, so the target must not be resolved after the await.
 */
async function importImagesAtPosition<T>(
  view: ImageDropEditor,
  sources: readonly T[],
  at: number,
  importFile: (source: T) => Promise<string>,
): Promise<void> {
  const line = view.state.doc.lineAt(at);
  const block = parseBlock(line.text);
  // a whitespace-only line (a fresh continuation line under a result row, an
  // empty line) is an empty slot as well: fill it, keep its hanging indent
  const indentOnly = line.text.trim() === "" && at === line.to;
  const fillsEmptyListItem =
    indentOnly ||
    ((block.kind === "bullet" ||
      block.kind === "numbered" ||
      block.kind === "task" ||
      block.kind === "result" ||
      block.kind === "choice") &&
      block.text.trim() === "" &&
      at >= line.from + block.prefixLen);
  const hang = indentOnly ? line.text.length : block.prefixLen;
  const wires = await Promise.all(sources.map((source) => importFile(source)));
  let insert = "";
  for (const wire of wires.filter(Boolean)) {
    const image = `![](${storageImageSource(wire)})`;
    if (fillsEmptyListItem) {
      if (insert) insert += `\n${" ".repeat(hang)}`;
      insert += image;
    } else {
      insert += `\n${image}\n`;
    }
  }
  if (fillsEmptyListItem && insert) insert += "\n";
  if (!insert) return;
  if (view.dom && !view.dom.isConnected) return;
  view.dispatch({
    changes: { from: at, insert },
    selection: { anchor: at + insert.length },
  });
  view.focus();
}

/** Native picker insertion uses an exact slash/caret position rather than a
 * pointer. The position is captured before file I/O, like the drop lane. */
export function importImagePathsAtPosition(
  view: ImageDropEditor,
  paths: readonly string[],
  at: number,
  importFile: ImportFile,
): Promise<void> {
  return importImagesAtPosition(view, paths, at, importFile);
}

export async function importImagesAtDrop(
  view: ImageDropEditor,
  paths: string[],
  point: DropPoint,
  importFile: ImportFile,
): Promise<void> {
  const at = view.posAtCoords(point) ?? view.state.selection.main.head;
  await importImagesAtPosition(view, paths, at, importFile);
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("the dropped image could not be read"));
    reader.onerror = () => reject(reader.error ?? new Error("the dropped image could not be read"));
    reader.readAsDataURL(file);
  });
}

/** HTML5/WebKit fallback for runtimes that surface dropped browser File
 * objects instead of Tauri paths. It still writes through the same guarded
 * corpus asset command and the same Markdown insertion function. */
export function importImageFilesAtDrop(
  view: ImageDropEditor,
  files: readonly File[],
  point: DropPoint,
  createAsset: (name: string, base64: string) => Promise<string>,
): Promise<void> {
  const at = view.posAtCoords(point) ?? view.state.selection.main.head;
  return importImagesAtPosition(view, files, at, async (file) => {
    const dataUrl = await readAsDataUrl(file);
    const base64 = dataUrl.split(",", 2)[1];
    if (!base64) throw new Error("the dropped image could not be encoded");
    return createAsset(file.name, base64);
  });
}
