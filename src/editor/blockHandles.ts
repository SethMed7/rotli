// Block handles (Seth, 2026-06-27) — a Milkdown-style "move things around + add/
// remove" layer over the CodeMirror markdown, toggled on/off from the Aa panel.
// The .md stays the source of truth: a block is just a run of consecutive non-blank
// lines (paragraph, heading, a list, a quote…) bounded by blank lines. Each block
// gets a ⠿ handle in the gutter — DRAG it to reorder, or CLICK it for a small menu
// (add below · move up/down · delete). Everything is a plain text transaction, so
// nothing proprietary touches the file. Off by default.

import type { EditorState } from "@codemirror/state";
import { EditorView, GutterMarker, gutter } from "@codemirror/view";

/** A block = [firstLineNumber, lastLineNumber] (1-based), the maximal run of
 * non-blank lines around `lineNo`. Returns null on a blank line. */
export interface Block {
  fromLine: number;
  toLine: number;
  from: number; // doc offset of the block's first char
  to: number; // doc offset of the block's last char (line end)
}

const isBlank = (s: string) => s.trim().length === 0;

/** The block containing 1-based `lineNo`, or null if that line is blank. */
export function blockAtLine(state: EditorState, lineNo: number): Block | null {
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
const blockText = (state: EditorState, b: Block) => state.doc.sliceString(b.from, b.to);

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
// char, which font-fell-back to a thin "white bar" (Seth, 2026-06-29).
const PLUS_SVG =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M8 3.6v8.8M3.6 8h8.8"/></svg>';
const GRIP_SVG =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><circle cx="6" cy="4" r="1.25"/><circle cx="10" cy="4" r="1.25"/><circle cx="6" cy="8" r="1.25"/><circle cx="10" cy="8" r="1.25"/><circle cx="6" cy="12" r="1.25"/><circle cx="10" cy="12" r="1.25"/></svg>';

// WKWebView swallows HTML5 drag-and-drop AND a `draggable` element steals the
// click — so the handle uses POINTER events instead: a small move past the
// threshold is a DRAG (reorder, with a drop line); no move is a CLICK (the menu).
class BlockHandle extends GutterMarker {
  constructor(
    readonly pos: number,
    readonly openMenu: BlockMenuOpener,
  ) {
    super();
  }
  override eq(other: BlockHandle) {
    return other.pos === this.pos;
  }
  override toDOM(view: EditorView) {
    const el = document.createElement("div");
    el.className = "cm-block-handle";

    // "+" — insert a fresh block below (don't let the gutter steal focus first)
    const add = document.createElement("button");
    add.type = "button";
    add.className = "cm-bh-add";
    add.title = "Add block below";
    add.setAttribute("aria-label", "Add block below");
    add.innerHTML = PLUS_SVG;
    add.addEventListener("mousedown", (e) => e.preventDefault());
    add.addEventListener("click", (e) => {
      e.preventDefault();
      addBlockBelow(view, this.pos);
    });

    // ⠿ grip — pointer-drag past the threshold reorders; a plain click opens the menu
    const grip = document.createElement("button");
    grip.type = "button";
    grip.className = "cm-bh-grip";
    grip.title = "Drag to reorder · click for actions";
    grip.setAttribute("aria-label", "Block actions");
    grip.innerHTML = GRIP_SVG;
    grip.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); // don't start a text selection from the gutter
      const startX = e.clientX;
      const startY = e.clientY;
      let dragging = false;
      let targetFrom: number | null = null;
      const onMove = (ev: MouseEvent) => {
        if (!dragging && Math.abs(ev.clientY - startY) + Math.abs(ev.clientX - startX) > 4) {
          dragging = true;
          view.dom.classList.add("cm-block-dragging");
        }
        if (!dragging) return;
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
        if (dragging) {
          const p = targetFrom ?? view.posAtCoords({ x: ev.clientX, y: ev.clientY });
          if (p != null) reorder(view, this.pos, p);
        } else {
          // no move → a click: open the actions menu at the grip
          this.openMenu(view, this.pos, grip.getBoundingClientRect());
        }
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });

    el.appendChild(add);
    el.appendChild(grip);
    return el;
  }
}

/** The block-handles gutter extension. `openMenu` is called on a handle click so
 * the host (React) can render the add/move/delete menu at the handle. */
export function blockHandles(openMenu: BlockMenuOpener) {
  return gutter({
    class: "cm-block-gutter",
    lineMarker(view, line) {
      const ln = view.state.doc.lineAt(line.from).number;
      const b = blockAtLine(view.state, ln);
      // mark only a block's FIRST line
      return b && b.fromLine === ln ? new BlockHandle(line.from, openMenu) : null;
    },
    lineMarkerChange: (u) => u.docChanged,
    initialSpacer: () => new BlockHandle(0, openMenu),
  });
}
