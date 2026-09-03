// Finder files dropped on a Rotli window. Tauri owns the OS drag session and
// reports paths plus a position; the webview never sees DataTransfer paths.
//
// While the drag HOVERS, the editor under the pointer draws a drop line at the
// insertion point (Seth, 2026-09-03: "when dragging it should put a preview
// in, then I can drop"). The drop then prefers, in order: the editor under
// the drop point, the editor the drag last hovered, and the focused pane's
// editor at its caret — a coordinate that misses every editor no longer
// sends an image silently to storage. A CHAT under the pointer claims images
// first. Everything else lands in storage/.
//
// Some WebKit/Tauri combinations surface an ordinary DataTransfer instead of
// the native path event; an editor-local fallback keeps image drops working.

import { EditorView } from "@codemirror/view";
import { useEffect } from "react";

import { chatDropAt, isChatImagePath } from "../components/chat/chatDrop";
import { onNativeDrag } from "../lib/nativeDrag";
import {
  corpusCreateImageAsset,
  corpusImportFile,
  isTauri,
  onNativeDropAuthorized,
  rootIdOf,
} from "../lib/tauri";
import { invalidateNotes } from "../services/hooks";
import { useUiStore } from "../state/ui";
import {
  type DropPoint,
  dropEditorHost,
  importImageFilesAtDrop,
  importImagesAtDrop,
  isEmbeddablePath,
  isImagePath,
  nativeDropPoints,
} from "./externalImageDrop";
import { noteIdFacet } from "./livePreview";

interface Hit {
  point: DropPoint;
  element: HTMLElement | null;
}

/** Every candidate CSS point for a native position, with what sits there. */
function hitsFor(px: number, py: number): Hit[] {
  return nativeDropPoints(px, py, window.devicePixelRatio || 1).map((point) => ({
    point,
    element: document.elementFromPoint(point.x, point.y) as HTMLElement | null,
  }));
}

function editorAt(hits: Hit[]): { view: EditorView; point: DropPoint } | null {
  for (const { point, element } of hits) {
    const host = dropEditorHost(element);
    const view = host ? EditorView.findFromDOM(host) : null;
    if (view) return { view, point };
  }
  return null;
}

/** The focused pane's editor, at its caret — the last-resort target. */
export function focusedEditor(): EditorView | null {
  const host =
    document.querySelector<HTMLElement>(".pane.focused .cm-editor") ??
    document.querySelector<HTMLElement>(".editor .cm-editor");
  return host ? EditorView.findFromDOM(host) : null;
}

/** The focused editor at its caret, as a drop target. */
function caretTarget(): { view: EditorView; point: DropPoint } | null {
  const view = focusedEditor();
  if (!view) return null;
  const rect = view.coordsAtPos(view.state.selection.main.head);
  return { view, point: rect ? { x: rect.left, y: rect.top } : { x: -1, y: -1 } };
}

/** The drop line: a 2px accent rule at the insertion point, fixed-positioned. */
class DropLine {
  private el: HTMLElement | null = null;
  show(view: EditorView, point: DropPoint): void {
    const pos = view.posAtCoords(point) ?? view.state.selection.main.head;
    const line = view.state.doc.lineAt(pos);
    const rect = view.coordsAtPos(line.from);
    const content = view.contentDOM.getBoundingClientRect();
    if (!rect) return;
    if (!this.el) {
      this.el = document.createElement("div");
      this.el.className = "rotli-native-drop";
      this.el.setAttribute("aria-hidden", "true");
      document.body.appendChild(this.el);
    }
    const bottom = view.coordsAtPos(line.to)?.bottom ?? rect.bottom;
    Object.assign(this.el.style, {
      left: `${content.left}px`,
      width: `${content.width}px`,
      top: `${bottom + 2}px`,
    });
  }
  hide(): void {
    this.el?.remove();
    this.el = null;
  }
}

export function useNativeFileDrop(): void {
  useEffect(() => {
    if (!isTauri()) return;
    let stopped = false;
    let hovered: { view: EditorView; point: DropPoint } | null = null;
    const dropLine = new DropLine();

    const handleDrop = async (paths: string[], px: number, py: number) => {
      const hits = hitsFor(px, py);
      const chatAttach = hits.map(({ element }) => (element ? chatDropAt(element) : null)).find(Boolean);
      if (chatAttach) {
        const dropped = paths.filter(isChatImagePath);
        const rest = paths.filter((path) => !isChatImagePath(path));
        if (dropped.length > 0) chatAttach(dropped);
        if (rest.length > 0) await Promise.all(rest.map((p) => corpusImportFile("default", p)));
        await invalidateNotes();
        return;
      }
      const target = editorAt(hits) ?? (hovered?.view.dom.isConnected ? hovered : null) ?? caretTarget();
      const view = target?.view ?? null;
      const rootId = view ? rootIdOf(view.state.facet(noteIdFacet)) : "default";
      const images = view ? paths.filter(isEmbeddablePath) : [];
      const toStorage = view ? paths.filter((path) => !isEmbeddablePath(path)) : paths;
      if (toStorage.length) await Promise.all(toStorage.map((p) => corpusImportFile(rootId, p)));
      if (view && target && images.length) {
        await importImagesAtDrop(view, images, target.point, (path) => corpusImportFile(rootId, path));
      }
      await invalidateNotes();
    };

    const unlistenDrag = onNativeDrag((drag) => {
      if (stopped) return;
      if (drag.phase === "leave") {
        dropLine.hide();
        return;
      }
      const target = editorAt(hitsFor(drag.x, drag.y));
      if (target) {
        hovered = target;
        dropLine.show(target.view, target.point);
      } else dropLine.hide();
    });
    // Rust emits this only after it has created the matching one-shot import
    // grants; Tauri's own webview event would race the native callback.
    const unlistenDrop = onNativeDropAuthorized((event) => {
      if (stopped) return;
      dropLine.hide();
      void handleDrop(event.paths, event.position.x, event.position.y)
        .catch((error: unknown) => {
          const detail = error instanceof Error ? error.message : String(error);
          useUiStore.getState().setRowActionError(`Couldn’t import dropped files — ${detail}`);
        })
        .finally(() => {
          hovered = null;
        });
    });
    return () => {
      stopped = true;
      dropLine.hide();
      unlistenDrag();
      unlistenDrop();
    };
  }, []);

  useEffect(() => {
    const onDragOver = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      if (!dropEditorHost(event.target as Element | null)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    };
    const onDrop = (event: DragEvent) => {
      const host = dropEditorHost(event.target as Element | null);
      if (!host || !event.dataTransfer) return;
      const files = [...event.dataTransfer.files].filter((file) => isImagePath(file.name));
      if (files.length === 0) return;
      const view = EditorView.findFromDOM(host);
      if (!view) return;
      event.preventDefault();
      event.stopPropagation();
      const rootId = rootIdOf(view.state.facet(noteIdFacet));
      void importImageFilesAtDrop(view, files, { x: event.clientX, y: event.clientY }, (name, base64) =>
        corpusCreateImageAsset(rootId, name, base64),
      )
        .then(invalidateNotes)
        .catch((error: unknown) => {
          const detail = error instanceof Error ? error.message : String(error);
          useUiStore.getState().setRowActionError(`Couldn’t import dropped images — ${detail}`);
        });
    };
    window.addEventListener("dragover", onDragOver, true);
    window.addEventListener("drop", onDrop, true);
    return () => {
      window.removeEventListener("dragover", onDragOver, true);
      window.removeEventListener("drop", onDrop, true);
    };
  }, []);
}
