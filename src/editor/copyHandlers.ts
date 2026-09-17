// Copy and cut in the beautified editor: the clipboard gets the selection as
// its source Markdown (text/plain) AND as HTML (copyClipboard.ts), so a paste
// back into a note or a chat renders exactly what was copied while a rich
// target gets the list and the picture. Images inside the selection are
// inlined as data URLs: those already resolved ride the synchronous copy; the
// rest are fetched and the pasteboard is rewritten a moment later through the
// host (a paste that lands in between still has the Markdown and the list).
// Raw mode copies the source verbatim through the browser default.

import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { corpusImageDataUrl, writeClipboardHtml } from "../lib/clipboard";
import { rootIdOf } from "../lib/tauri";
import { clipboardHtml, imageSourcesIn } from "./copyClipboard";
import { noteIdFacet } from "./livePreview";

/** Resolved image bytes, kept across copies (bounded by count, not bytes:
 * the host already caps each image). */
const imageCache = new Map<string, string>();
const IMAGE_CACHE_MAX = 24;
const MAX_INLINED_IMAGES = 12;

function remember(src: string, dataUrl: string): void {
  if (imageCache.size >= IMAGE_CACHE_MAX) imageCache.delete(imageCache.keys().next().value!);
  imageCache.set(src, dataUrl);
}

/** True when the copy was handled (beautified mode, non-empty selection). */
export function copySelection(
  event: ClipboardEvent,
  view: EditorView,
  isCut: boolean,
  raw: boolean,
): boolean {
  if (raw) return false;
  const range = view.state.selection.main;
  if (range.empty) return false;
  const markdown = view.state.sliceDoc(range.from, range.to);
  const text = markdown;
  const known = new Map([...imageCache].filter(([src]) => markdown.includes(src)));
  event.clipboardData?.setData("text/plain", text);
  event.clipboardData?.setData("text/html", clipboardHtml(markdown, known));
  event.preventDefault();
  if (isCut) {
    view.dispatch({
      changes: { from: range.from, to: range.to },
      selection: EditorSelection.cursor(range.from),
      userEvent: "delete.cut",
    });
  }
  const pending = imageSourcesIn(markdown)
    .filter((src) => !imageCache.has(src))
    .slice(0, MAX_INLINED_IMAGES);
  if (pending.length > 0) {
    const rootId = rootIdOf(view.state.facet(noteIdFacet));
    void Promise.all(pending.map(async (src) => [src, await corpusImageDataUrl(rootId, src)] as const)).then(
      (resolved) => {
        const found = resolved.filter(([, data]) => data !== "");
        if (found.length === 0) return;
        for (const [src, data] of found) remember(src, data);
        const images = new Map([...imageCache].filter(([src]) => markdown.includes(src)));
        return writeClipboardHtml(clipboardHtml(markdown, images), text).catch(() => {});
      },
    );
  }
  return true;
}

/** The editor extension; `raw` reads the live mode so a toggle needs no rebuild. */
export function copyHandlers(raw: () => boolean) {
  return EditorView.domEventHandlers({
    copy: (event, view) => copySelection(event, view, false, raw()),
    cut: (event, view) => copySelection(event, view, true, raw()),
  });
}
