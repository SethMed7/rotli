// Finder files dropped on a Rotli window. Tauri owns the OS drag session and
// reports paths plus a position; the webview never sees DataTransfer paths.
//
// While the drag HOVERS, the editor under the pointer draws a drop line at the
// insertion point (Seth, 2026-09-03: "when dragging it should put a preview
// in, then I can drop"). The drop then prefers, in order: the editor under
// the drop point, the editor the drag last hovered, and the focused pane's
// editor at its caret — a coordinate that misses every editor no longer
// sends an image silently to storage. A CHAT under the pointer claims images
// first. Everything else lands in storage/ and says so (dropRouting.ts).
//
// Some WebKit/Tauri combinations surface an ordinary DataTransfer instead of
// the native path event; an editor-local fallback keeps image drops working.

import { EditorView } from "@codemirror/view";
import { useEffect } from "react";

import { chatDropAt, CHAT_PANE_ATTR } from "../components/chat/chatDrop";
import { onNativeDrag } from "../lib/nativeDrag";
import {
  corpusCreateImageAsset,
  isTauri,
  onNativeDropAuthorized,
  onNativeDropRefused,
  rootIdOf,
} from "../lib/tauri";
import { invalidateNotes } from "../services/hooks";
import { showFileNotice } from "../state/fileNotice";
import { type DropCandidate, dropIsBlocked, firstTarget } from "./dropRouting";
import {
  type DropPoint,
  dropEditorHost,
  importImageFilesAtDrop,
  isImagePath,
  nativeDropPoints,
} from "./externalImageDrop";
import { deliverFiles } from "./fileDelivery";
import { noteIdFacet } from "./livePreview";
import { useNativeFilePaste } from "./nativeFilePaste";

/** Every candidate CSS point for a native position, with the WHOLE element
 * stack there — an overlay on top must not hide the chat or note beneath. */
function candidatesFor(px: number, py: number): DropCandidate<Element>[] {
  return nativeDropPoints(px, py, window.devicePixelRatio || 1).map((point) => ({
    point,
    stack: document.elementsFromPoint(point.x, point.y),
  }));
}

function editorAt(candidates: DropCandidate<Element>[]): { view: EditorView; point: DropPoint } | null {
  const hit = firstTarget(candidates, (element) => {
    const host = dropEditorHost(element);
    return host ? EditorView.findFromDOM(host) : null;
  });
  return hit ? { view: hit.target, point: hit.point } : null;
}

/** The focused pane's editor, at its caret — the last-resort target. */
function focusedEditor(): EditorView | null {
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
      const candidates = candidatesFor(px, py);
      if (dropIsBlocked(candidates)) return;
      const chat = firstTarget(candidates, chatDropAt);
      if (chat) return deliverFiles(paths, { kind: "chat", attach: chat.target });
      const target =
        editorAt(candidates) ?? (hovered?.view.dom.isConnected ? hovered : null) ?? caretTarget();
      if (!target) return deliverFiles(paths, { kind: "none" });
      const { view, point } = target;
      const at = view.posAtCoords(point) ?? view.state.selection.main.head;
      return deliverFiles(paths, { kind: "editor", view, at });
    };

    const unlistenDrag = onNativeDrag((drag) => {
      if (stopped) return;
      if (drag.phase === "leave") {
        dropLine.hide();
        return;
      }
      const candidates = candidatesFor(drag.x, drag.y);
      const target = dropIsBlocked(candidates) ? null : editorAt(candidates);
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
          showFileNotice(`Couldn’t import dropped files — ${detail}`);
        })
        .finally(() => {
          hovered = null;
        });
    });
    // Rust granted none of the dropped items (folders, files gone mid-drag)
    const unlistenRefused = onNativeDropRefused(() => {
      dropLine.hide();
      showFileNotice("Nothing imported — Rotli imports files, not folders");
    });
    return () => {
      stopped = true;
      dropLine.hide();
      unlistenDrag();
      unlistenDrop();
      unlistenRefused();
    };
  }, []);

  useNativeFilePaste();

  useEffect(() => {
    // Rotli Web: a chat cannot take a file yet (Rotli Helper carries text only);
    // the pane still accepts the drag so the drop can say so instead of the
    // browser opening the file over the app
    const webChatPane = (event: DragEvent) =>
      !isTauri() && !!(event.target as Element | null)?.closest(`[${CHAT_PANE_ATTR}]`);
    const onDragOver = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      if (!dropEditorHost(event.target as Element | null) && !webChatPane(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    };
    const onDrop = (event: DragEvent) => {
      if (webChatPane(event) && (event.dataTransfer?.files.length ?? 0) > 0) {
        event.preventDefault();
        showFileNotice("Files can’t be sent through Rotli Helper yet — drop images into a note instead.");
        return;
      }
      const host = dropEditorHost(event.target as Element | null);
      if (!host || !event.dataTransfer) return;
      const files = [...event.dataTransfer.files].filter((file) => isImagePath(file.name));
      if (files.length === 0) {
        // Rotli Web: an unhandled file drop would open the file over the app
        if (!isTauri() && event.dataTransfer.files.length > 0) {
          event.preventDefault();
          showFileNotice("Rotli Web takes images only — other files stay where they are.");
        }
        return;
      }
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
          showFileNotice(`Couldn’t import dropped images — ${detail}`);
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
