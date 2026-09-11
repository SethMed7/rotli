// Block handles (the maintainer, 2026-06-27; floating rework 2026-07-01) — a Milkdown-
// style "move things around + add/remove" layer over the CodeMirror markdown,
// with an Aa-panel escape hatch (ON by default). The .md stays the source of
// truth: a block is just a run of consecutive non-blank lines (paragraph,
// heading, a list, a quote…) bounded by blank lines. ONE +/⠿ handle floats
// immediately left of the HOVERED block's first line (the Crepe/Notion model —
// the old version drew a gutter of handles pinned to the scroller's far-left
// edge, hundreds of px from a centered text column). DRAG the grip to reorder,
// CLICK it for a small menu (add below · move up/down · delete). Everything is
// a plain text transaction, so nothing proprietary touches the file.

import type { EditorState } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

import { CHECK_EM } from "./listGeometry";

/** A block = [firstLineNumber, lastLineNumber] (1-based), the maximal run of
 * non-blank lines around `lineNo`. Returns null on a blank line. */
export interface BlockRange {
  fromLine: number;
  toLine: number;
  from: number; // doc offset of the block's first char
  to: number; // doc offset of the block's last char (line end)
}

const isBlank = (s: string) => s.trim().length === 0;

/** The block containing 1-based `lineNo`, or null if that line is blank. */
export function blockAtLine(state: EditorState, lineNo: number): BlockRange | null {
  const total = state.doc.lines;
  if (lineNo < 1 || lineNo > total) return null;
  if (isBlank(state.doc.line(lineNo).text)) return null;
  let first = lineNo;
  while (first > 1 && !isBlank(state.doc.line(first - 1).text)) first--;
  let last = lineNo;
  while (last < total && !isBlank(state.doc.line(last + 1).text)) last++;
  return {
    fromLine: first,
    toLine: last,
    from: state.doc.line(first).from,
    to: state.doc.line(last).to,
  };
}

/** Every block's first-line number, in order — used to mark gutter lines + to
 * find the previous/next block for "move up/down". */
function blockStarts(state: EditorState): number[] {
  const out: number[] = [];
  const total = state.doc.lines;
  for (let n = 1; n <= total; n++) {
    const blank = isBlank(state.doc.line(n).text);
    const prevBlank = n === 1 || isBlank(state.doc.line(n - 1).text);
    if (!blank && prevBlank) out.push(n);
  }
  return out;
}

/** Slice a block's text (without its trailing newline). */
const blockText = (state: EditorState, b: BlockRange) => state.doc.sliceString(b.from, b.to);

/** Move the block at `pos` up or down past its neighbour (swap the two blocks). */
export function moveBlock(view: EditorView, pos: number, dir: -1 | 1): void {
  const { state } = view;
  const b = blockAtLine(state, state.doc.lineAt(pos).number);
  if (!b) return;
  const starts = blockStarts(state);
  const idx = starts.indexOf(b.fromLine);
  const neighbourStart = starts[idx + dir];
  if (neighbourStart == null) return;
  const nb = blockAtLine(state, neighbourStart);
  if (!nb) return;
  const a = dir === -1 ? nb : b; // the one that ends up later stays; we swap texts
  const c = dir === -1 ? b : nb;
  // swap the two block texts in place (keeps the blank lines between them put)
  const textA = blockText(state, a);
  const textC = blockText(state, c);
  view.dispatch({
    changes: [
      { from: a.from, to: a.to, insert: textC },
      { from: c.from, to: c.to, insert: textA },
    ],
    userEvent: "move.block",
  });
  view.focus();
}

/** Insert a fresh empty block right after the block at `pos`; place the caret in it. */
export function addBlockBelow(view: EditorView, pos: number): void {
  const { state } = view;
  const b = blockAtLine(state, state.doc.lineAt(pos).number);
  if (!b) return;
  const insert = "\n\n";
  view.dispatch({
    changes: { from: b.to, insert },
    selection: { anchor: b.to + insert.length },
    scrollIntoView: true,
    userEvent: "input.block",
  });
  view.focus();
}

/** Delete the block at `pos` (and one bounding blank line so no gap is left). */
export function deleteBlock(view: EditorView, pos: number): void {
  const { state } = view;
  const b = blockAtLine(state, state.doc.lineAt(pos).number);
  if (!b) return;
  let from = b.from;
  let to = b.to;
  // also swallow the blank line after the block, else a trailing one before it
  if (to < state.doc.length) to = Math.min(state.doc.length, to + 1);
  else if (from > 0) from = Math.max(0, from - 1);
  view.dispatch({ changes: { from, to, insert: "" }, userEvent: "delete.block" });
  view.focus();
}

/** Reorder: move the source block to just before the block at `toPos`. */
function reorder(view: EditorView, fromPos: number, toPos: number): void {
  const { state } = view;
  const src = blockAtLine(state, state.doc.lineAt(fromPos).number);
  const dst = blockAtLine(state, state.doc.lineAt(toPos).number);
  if (!src || !dst || src.fromLine === dst.fromLine) return;
  const text = blockText(state, src);
  // remove the source block (+ its following blank line) then insert before dst
  let cutFrom = src.from;
  let cutTo = src.to;
  if (cutTo < state.doc.length) cutTo = Math.min(state.doc.length, cutTo + 1);
  // dst offset must account for the cut if the source was earlier in the doc
  const insertAt = dst.from;
  const adjustedInsert = insertAt > cutFrom ? insertAt - (cutTo - cutFrom) : insertAt;
  view.dispatch({
    changes: [
      { from: cutFrom, to: cutTo, insert: "" },
      { from: adjustedInsert, insert: `${text}\n\n` },
    ],
    userEvent: "move.block",
  });
  view.focus();
}

/** Callback the gutter handle calls on a plain click (opens the React menu). */
export type BlockMenuOpener = (view: EditorView, blockPos: number, anchor: DOMRect) => void;

// A single shared drop-line element (position:fixed so it ignores scroll/ancestor
// math). Shown at the top of the target block while a block is dragged.
let dropLine: HTMLDivElement | null = null;
function showDropLine(view: EditorView, targetFrom: number) {
  if (!dropLine) {
    dropLine = document.createElement("div");
    dropLine.className = "cm-block-dropline";
    document.body.appendChild(dropLine);
  }
  const coords = view.coordsAtPos(targetFrom);
  const rect = view.scrollDOM.getBoundingClientRect();
  if (!coords) {
    dropLine.style.display = "none";
    return;
  }
  dropLine.style.display = "block";
  dropLine.style.left = `${rect.left + 8}px`;
  dropLine.style.width = `${rect.width - 16}px`;
  dropLine.style.top = `${coords.top - 1}px`;
}
function hideDropLine() {
  if (dropLine) dropLine.style.display = "none";
}

// Milkdown/Crepe-style handle marks (currentColor so they theme): a "+" to add a
// block below, and a 6-dot grip to drag/reorder. Inline SVG — NOT the "⠿" braille
// char, which font-fell-back to a thin "white bar" (the maintainer, 2026-06-29).
const PLUS_SVG =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M8 3.6v8.8M3.6 8h8.8"/></svg>';
const GRIP_SVG =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><circle cx="6" cy="4" r="1.25"/><circle cx="10" cy="4" r="1.25"/><circle cx="6" cy="8" r="1.25"/><circle cx="10" cy="8" r="1.25"/><circle cx="6" cy="12" r="1.25"/><circle cx="10" cy="12" r="1.25"/></svg>';

const HANDLE_GAP = 6; // px between the handle and the text column's left edge
const LINGER_MS = 150; // crossing the gap (text → handle) must never drop it

// WKWebView swallows HTML5 drag-and-drop AND a `draggable` element steals the
// click — so the grip uses POINTER events instead: a small move past the
// threshold is a DRAG (reorder, with a drop line); no move is a CLICK (the menu).
//
// ONE handle for the whole editor: a mousemove listener resolves the hovered
// block (posAtCoords → blockAtLine) and floats the +/⠿ pair just left of the
// text column, vertically centered on the block's first line. It appears
// instantly on block hover, lingers briefly on leave, and hides on scroll/edit.
class HandleView {
  private el: HTMLDivElement;
  private blockFrom = -1;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private dragging = false;

  private onDomMove = (e: MouseEvent) => {
    if (this.dragging) return;
    if (e.target instanceof Node && this.el.contains(e.target)) {
      this.cancelHide();
      return;
    }
    const pos = this.view.posAtCoords({ x: e.clientX, y: e.clientY }, false);
    const b = blockAtLine(this.view.state, this.view.state.doc.lineAt(pos).number);
    if (b) this.place(b);
    else this.scheduleHide();
  };
  private onDomLeave = () => this.scheduleHide();
  private onScroll = () => this.hideNow();

  constructor(
    readonly view: EditorView,
    readonly openMenu: BlockMenuOpener,
  ) {
    const el = document.createElement("div");
    el.className = "cm-block-handle";

    // "+" — insert a fresh block below (don't let the button steal focus first)
    const add = document.createElement("button");
    add.type = "button";
    add.className = "cm-bh-add";
    add.title = "Add block below";
    add.setAttribute("aria-label", "Add block below");
    add.innerHTML = PLUS_SVG;
    add.addEventListener("mousedown", (e) => e.preventDefault());
    add.addEventListener("click", (e) => {
      e.preventDefault();
      if (this.blockFrom >= 0) addBlockBelow(view, this.blockFrom);
    });

    // ⠿ grip — pointer-drag past the threshold reorders; a plain click opens the menu
    const grip = document.createElement("button");
    grip.type = "button";
    grip.className = "cm-bh-grip";
    grip.title = "Drag to reorder · click for actions";
    grip.setAttribute("aria-label", "Block actions");
    grip.innerHTML = GRIP_SVG;
    grip.addEventListener("mousedown", (e) => {
      if (e.button !== 0 || this.blockFrom < 0) return;
      e.preventDefault(); // don't start a text selection from the handle
      const srcPos = this.blockFrom;
      const startX = e.clientX;
      const startY = e.clientY;
      let targetFrom: number | null = null;
      const onMove = (ev: MouseEvent) => {
        if (!this.dragging && Math.abs(ev.clientY - startY) + Math.abs(ev.clientX - startX) > 4) {
          this.dragging = true;
          view.dom.classList.add("cm-block-dragging");
        }
        if (!this.dragging) return;
        const p = view.posAtCoords({ x: ev.clientX, y: ev.clientY });
        const b = p == null ? null : blockAtLine(view.state, view.state.doc.lineAt(p).number);
        if (b) {
          targetFrom = b.from;
          showDropLine(view, b.from);
        }
      };
      const onUp = (ev: MouseEvent) => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        view.dom.classList.remove("cm-block-dragging");
        hideDropLine();
        const dragged = this.dragging;
        this.dragging = false;
        if (dragged) {
          const p = targetFrom ?? view.posAtCoords({ x: ev.clientX, y: ev.clientY });
          if (p != null) reorder(view, srcPos, p);
        } else {
          // no move → a click: open the actions menu at the grip
          this.openMenu(view, srcPos, grip.getBoundingClientRect());
        }
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });

    el.appendChild(add);
    el.appendChild(grip);
    el.addEventListener("mouseenter", () => this.cancelHide());
    el.addEventListener("mouseleave", () => this.scheduleHide());
    this.el = el;
    view.dom.appendChild(el); // .cm-editor is position:relative — our anchor
    view.dom.addEventListener("mousemove", this.onDomMove);
    view.dom.addEventListener("mouseleave", this.onDomLeave);
    view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });
  }

  /** Float the handle just left of the text column, centered on the block's
   * first line (headings included — the line box carries their height). */
  private place(b: BlockRange): void {
    this.cancelHide();
    const coords = this.view.coordsAtPos(b.from);
    if (!coords) {
      this.hideNow();
      return;
    }
    const edRect = this.view.dom.getBoundingClientRect();
    const contentRect = this.view.contentDOM.getBoundingClientRect();
    const contentStyle = getComputedStyle(this.view.contentDOM);
    const padL = Number.parseFloat(contentStyle.paddingLeft) || 0;
    const w = this.el.offsetWidth || 46;
    const h = this.el.offsetHeight || 22;
    // Task controls hang to the left of the prose measure. Reserve their
    // existing geometry before placing the handle, including after hover.
    const markerGutter = CHECK_EM * (Number.parseFloat(contentStyle.fontSize) || 15);
    const left = contentRect.left + padL - markerGutter - w - HANDLE_GAP - edRect.left;
    if (left < 2) {
      this.hideNow();
      return;
    }
    const top = coords.top + (coords.bottom - coords.top - h) / 2 - edRect.top;
    this.el.style.left = `${left}px`;
    this.el.style.top = `${top}px`;
    this.el.classList.add("on"); // instant — no fade-in delay
    this.blockFrom = b.from;
  }

  private cancelHide(): void {
    if (this.hideTimer != null) clearTimeout(this.hideTimer);
    this.hideTimer = null;
  }
  private scheduleHide(): void {
    if (this.dragging) return;
    this.cancelHide();
    this.hideTimer = setTimeout(() => this.hideNow(), LINGER_MS);
  }
  private hideNow(): void {
    this.cancelHide();
    if (this.dragging) return;
    this.el.classList.remove("on");
    this.blockFrom = -1;
  }

  update(u: ViewUpdate): void {
    // edits shift blocks under the handle — hide; the next mousemove re-anchors
    if (u.docChanged) this.hideNow();
  }

  destroy(): void {
    this.cancelHide();
    this.view.dom.removeEventListener("mousemove", this.onDomMove);
    this.view.dom.removeEventListener("mouseleave", this.onDomLeave);
    this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
    this.el.remove();
  }
}

/** The floating block-handle extension. `openMenu` is called on a grip click so
 * the host (React) can render the add/move/delete menu at the handle. */
export function blockHandles(openMenu: BlockMenuOpener) {
  return ViewPlugin.define((view) => new HandleView(view, openMenu));
}
