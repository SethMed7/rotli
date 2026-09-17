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
// While the drag HOVERS a chat, the pane says what the drop will do — attach,
// or refuse because the model cannot see (the owner, 2026-09-17: "a visual cue
// when I am hovering an image over that it is working prior to dropping").
// chatDrop.ts owns the registry and the attribute; memex.css draws the cue.
//
// Some WebKit/Tauri combinations surface an ordinary DataTransfer instead of
// the native path event; an editor-local fallback keeps image drops working,
// and it is also Rotli Web's whole drop lane: the same drop line and the same
// chat cue (there, "the Helper carries text only") ride the DataTransfer events.

import { EditorView } from "@codemirror/view";
import { useEffect } from "react";

import { chatDropAt, chatDropTargetAt, DropCueMarker } from "../components/chat/chatDrop";
import { queueChatAttachment } from "../components/chat/chatDropQueue";
import {
  dropTargetKey,
  type SidebarDropTarget,
  sidebarDropTargetAt,
  SpringOpen,
} from "../components/sidebar/sidebarDropTargets";
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
import { usePanesStore } from "../state/panes";
import { type DropCandidate, dropIsBlocked, firstTarget } from "./dropRouting";
import {
  type DropPoint,
  dropEditorHost,
  importImageFilesAtDrop,
  importImageFilesAtPosition,
  isImagePath,
  nativeDropPoints,
} from "./externalImageDrop";
import { deliverFiles } from "./fileDelivery";
import { noteIdFacet } from "./livePreview";
import { useNativeFilePaste } from "./nativeFilePaste";
import { awaitEditorFor } from "./openedEditor";

/** A drop on a sidebar row (2026-09-17): a chat row opens the chat and the
 * images wait for its composer (chatDropQueue); a note row opens the note and
 * the images land at its end once the editor is up. Non-images take the
 * ordinary storage route with the usual notice. */
async function dropOnSidebarRow(target: SidebarDropTarget, paths: string[]): Promise<void> {
  const panes = usePanesStore.getState();
  if (target.kind === "chat") {
    panes.openChat(target.slug);
    return deliverFiles(paths, {
      kind: "chat",
      attach: (images) => queueChatAttachment(target.slug, images),
    });
  }
  panes.openNote(target.id);
  const view = await awaitEditorFor(target.id);
  if (!view) return deliverFiles(paths, { kind: "none" });
  return deliverFiles(paths, { kind: "editor", view, at: view.state.doc.length });
}

/** The spring-open a hovered row asks for: only a note row opens on dwell. */
function springRow(spring: SpringOpen, target: SidebarDropTarget): void {
  if (target.kind === "note") {
    spring.hover(dropTargetKey(target), () => usePanesStore.getState().openNote(target.id));
  } else spring.leave();
}

const HELPER_TEXT_ONLY = "Files can’t be sent through Rotli Helper yet — drop images into a note instead.";

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
    const chatCue = new DropCueMarker();
    const rowCue = new DropCueMarker();
    const spring = new SpringOpen();
    const settle = () => {
      dropLine.hide();
      chatCue.clear();
      rowCue.clear();
      spring.leave();
    };

    const handleDrop = async (paths: string[], px: number, py: number) => {
      const candidates = candidatesFor(px, py);
      if (dropIsBlocked(candidates)) return;
      const chat = firstTarget(candidates, chatDropAt);
      if (chat) return deliverFiles(paths, { kind: "chat", attach: chat.target });
      const row = firstTarget(candidates, sidebarDropTargetAt);
      if (row) return dropOnSidebarRow(row.target, paths);
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
        settle();
        return;
      }
      const candidates = candidatesFor(drag.x, drag.y);
      const blocked = dropIsBlocked(candidates);
      // a chat under the pointer claims the drop, so it claims the cue too
      const chat = blocked ? null : firstTarget(candidates, chatDropTargetAt);
      if (chat) {
        chatCue.show(chat.target.host, chat.target.cue);
        rowCue.clear();
        spring.leave();
        dropLine.hide();
        return;
      }
      chatCue.clear();
      // a sidebar row lights up; a note row springs open after a dwell
      const row = blocked ? null : firstTarget(candidates, sidebarDropTargetAt);
      if (row) {
        rowCue.show(row.target.row, "row");
        springRow(spring, row.target);
        dropLine.hide();
        return;
      }
      rowCue.clear();
      spring.leave();
      const target = blocked ? null : editorAt(candidates);
      if (target) {
        hovered = target;
        dropLine.show(target.view, target.point);
      } else dropLine.hide();
    });
    // Rust emits this only after it has created the matching one-shot import
    // grants; Tauri's own webview event would race the native callback.
    const unlistenDrop = onNativeDropAuthorized((event) => {
      if (stopped) return;
      settle();
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
      settle();
      showFileNotice("Nothing imported — Rotli imports files, not folders");
    });
    return () => {
      stopped = true;
      settle();
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
      isTauri() ? null : (chatDropTargetAt(event.target as Element | null)?.host ?? null);
    const webRow = (event: DragEvent) =>
      isTauri() ? null : sidebarDropTargetAt(event.target as Element | null);
    const cue = new DropCueMarker();
    const rowCue = new DropCueMarker();
    const spring = new SpringOpen();
    const line = new DropLine();
    const settle = () => {
      cue.clear();
      rowCue.clear();
      spring.leave();
      line.hide();
    };
    const onDragOver = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      const host = dropEditorHost(event.target as Element | null);
      const chatHost = webChatPane(event);
      const row = webRow(event);
      if (!host && !chatHost && !row) {
        settle();
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      if (row) {
        rowCue.show(row.row, "row");
        springRow(spring, row);
        cue.clear();
        line.hide();
        return;
      }
      rowCue.clear();
      spring.leave();
      if (chatHost) {
        // the web chat cannot take the file; the cue says so before the drop does
        cue.show(chatHost, "web");
        line.hide();
        return;
      }
      cue.clear();
      const view = host ? EditorView.findFromDOM(host) : null;
      if (view) line.show(view, { x: event.clientX, y: event.clientY });
    };
    // the drag left the window (no relatedTarget) or the gesture ended
    const onDragLeave = (event: DragEvent) => {
      if (event.relatedTarget === null) settle();
    };
    const onDrop = (event: DragEvent) => {
      settle();
      const dropped = [...(event.dataTransfer?.files ?? [])];
      const row = webRow(event);
      if (row && dropped.length > 0) {
        event.preventDefault();
        if (row.kind === "chat") {
          showFileNotice(HELPER_TEXT_ONLY);
          return;
        }
        // a note row: open the note and put the images at its end
        usePanesStore.getState().openNote(row.id);
        const images = dropped.filter((file) => isImagePath(file.name));
        void awaitEditorFor(row.id).then((view) => {
          if (!view || images.length === 0) {
            showFileNotice("Rotli Web takes images only — other files stay where they are.");
            return;
          }
          const rootId = rootIdOf(view.state.facet(noteIdFacet));
          return importImageFilesAtPosition(view, images, view.state.doc.length, (name, base64) =>
            corpusCreateImageAsset(rootId, name, base64),
          )
            .then(invalidateNotes)
            .catch((error: unknown) => {
              const detail = error instanceof Error ? error.message : String(error);
              showFileNotice(`Couldn’t import dropped images — ${detail}`);
            });
        });
        return;
      }
      if (webChatPane(event) && dropped.length > 0) {
        event.preventDefault();
        showFileNotice(HELPER_TEXT_ONLY);
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
    window.addEventListener("dragleave", onDragLeave, true);
    window.addEventListener("dragend", settle, true);
    window.addEventListener("drop", onDrop, true);
    return () => {
      settle();
      window.removeEventListener("dragover", onDragOver, true);
      window.removeEventListener("dragleave", onDragLeave, true);
      window.removeEventListener("dragend", settle, true);
      window.removeEventListener("drop", onDrop, true);
    };
  }, []);
}
