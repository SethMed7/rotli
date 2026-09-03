// The table widget's row/column mini menu and its edit dispatch: a
// module-level singleton (like the drop line) hosted as imperative DOM — the
// widget lives inside CodeMirror, so there is no React root to mount into.
// Split out of tableRender.ts on 2026-09-03 (the widget's size is a ratchet).

import type { EditorView } from "@codemirror/view";

import {
  type Align,
  type TableBlock,
  type TableShape,
  addColRight,
  addRowBelow,
  caretAfterTableEdit,
  deleteCol,
  deleteRow,
  moveCol,
  moveRow,
  scanTables,
  setColAlign,
  tableToText,
} from "./tables";

// ─── the row/col mini menu (module-level singleton, like the drop line) ──────

let menuEl: HTMLDivElement | null = null;
let backdropEl: HTMLDivElement | null = null;
function closeTableMenu(): void {
  menuEl?.remove();
  backdropEl?.remove();
  menuEl = null;
  backdropEl = null;
}

/** Resolve the table containing the widget NOW (offsets go stale; posAtDOM at
 * action time is the truth) and replace its source with the transformed text. */
export function applyOp(view: EditorView, wrap: HTMLElement, fn: (t: TableBlock) => TableShape | null): void {
  if (!wrap.isConnected) return; // the widget was rebuilt/unmounted under the menu
  const pos = view.posAtDOM(wrap);
  const t = scanTables(view.state.doc).find((x) => pos >= x.from && pos <= x.to);
  if (!t) return;
  const next = fn(t);
  if (!next) return;
  const insert = tableToText(next);
  // the caret follows the table (its row, or its first line), so the focus
  // that follows never scrolls to wherever the caret was left before
  const anchor = caretAfterTableEdit(view.state.selection.main.head, t.from, t.to, insert);
  view.dispatch({ changes: { from: t.from, to: t.to, insert }, selection: { anchor } });
}

export function openTableMenu(
  view: EditorView,
  wrap: HTMLElement,
  kind: "row" | "col",
  index: number,
  align: Align,
  anchor: DOMRect,
): void {
  closeTableMenu();
  const backdrop = document.createElement("div");
  backdrop.className = "rotli-tblmenu-backdrop";
  backdrop.addEventListener("mousedown", (e) => {
    e.preventDefault();
    closeTableMenu();
  });
  const menu = document.createElement("div");
  menu.className = "rotli-tblmenu";
  menu.setAttribute("role", "menu");

  const act = (fn: (t: TableBlock) => TableShape | null) => {
    applyOp(view, wrap, fn);
    closeTableMenu();
    view.focus();
  };
  const item = (label: string, run: () => void, opts?: { danger?: boolean; icon?: string }) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = opts?.danger ? "rotli-tblmenu-item danger" : "rotli-tblmenu-item";
    b.setAttribute("role", "menuitem");
    if (opts?.icon) {
      const ico = document.createElement("span");
      ico.className = "rotli-tblmenu-ico";
      ico.innerHTML = opts.icon;
      b.appendChild(ico);
    }
    b.appendChild(document.createTextNode(label));
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", run);
    menu.appendChild(b);
  };

  if (kind === "row") {
    item("Add row above", () => act((t) => addRowBelow(t, index - 1)));
    item("Add row below", () => act((t) => addRowBelow(t, index)));
    item("Move up", () => act((t) => moveRow(t, index, -1)), { icon: MOVE_UP });
    item("Move down", () => act((t) => moveRow(t, index, 1)), { icon: MOVE_DOWN });
    item("Delete row", () => act((t) => deleteRow(t, index)), { danger: true });
  } else {
    // alignment first — a small segmented row (the delimiter cell rewrite).
    // Docs-style line glyphs (2026-07-31): instantly readable, not arrows.
    const seg = document.createElement("div");
    seg.className = "rotli-tblmenu-align";
    for (const a of ["left", "center", "right"] as const) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = align === a ? "rotli-tblalign sel" : "rotli-tblalign";
      b.title = `Align ${a}`;
      b.setAttribute("aria-label", `Align ${a}`);
      b.innerHTML = ALIGN_ICONS[a];
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", () => act((t) => setColAlign(t, index, align === a ? "" : a)));
      seg.appendChild(b);
    }
    menu.appendChild(seg);
    item("Add column left", () => act((t) => addColRight(t, index - 1)));
    item("Add column right", () => act((t) => addColRight(t, index)));
    item("Move left", () => act((t) => moveCol(t, index, -1)), { icon: MOVE_LEFT });
    item("Move right", () => act((t) => moveCol(t, index, 1)), { icon: MOVE_RIGHT });
    item("Delete column", () => act((t) => deleteCol(t, index)), { danger: true });
  }

  document.body.appendChild(backdrop);
  document.body.appendChild(menu);
  backdropEl = backdrop;
  menuEl = menu;
  // place beside the chip, clamped to the viewport
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  menu.style.left = `${Math.min(anchor.right + 4, window.innerWidth - mw - 8)}px`;
  menu.style.top = `${Math.max(8, Math.min(anchor.top, window.innerHeight - mh - 8))}px`;
}

// ─── the widget ──────────────────────────────────────────────────────────────

// menu glyphs (2026-07-31, the maintainer: "use standard icons — instantly understood").
// The Docs-style horizontal-lines family for alignment, arrow+lines for the
// move verbs. Raw SVG strings (this widget is imperative DOM, no React) in the
// shared 24-viewBox / 1.7-stroke voice of formatGlyphs.tsx.
const svg = (paths: string) =>
  `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ALIGN_ICONS: Record<"left" | "center" | "right", string> = {
  left: svg('<path d="M4 6h16M4 10h9M4 14h16M4 18h9"/>'),
  center: svg('<path d="M4 6h16M7.5 10h9M4 14h16M7.5 18h9"/>'),
  right: svg('<path d="M4 6h16M11 10h9M4 14h16M11 18h9"/>'),
};
const MOVE_LEFT = svg('<path d="M13 6h7M13 12h7M13 18h7"/><path d="M9 12H3m3-3-3 3 3 3"/>');
const MOVE_RIGHT = svg('<path d="M4 6h7M4 12h7M4 18h7"/><path d="M15 12h6m-3-3 3 3-3 3"/>');
const MOVE_UP = svg('<path d="M6 13h12M6 17h12M6 21h12"/><path d="M12 9V3M9 6l3-3 3 3"/>');
const MOVE_DOWN = svg('<path d="M6 3h12M6 7h12M6 11h12"/><path d="M12 15v6m-3-3 3 3 3-3"/>');

// chip glyphs — the block-handle grip voice, sized for an 18px chip
export const GRIP_V =
  '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true"><circle cx="6" cy="4" r="1.25"/><circle cx="10" cy="4" r="1.25"/><circle cx="6" cy="8" r="1.25"/><circle cx="10" cy="8" r="1.25"/><circle cx="6" cy="12" r="1.25"/><circle cx="10" cy="12" r="1.25"/></svg>';
export const GRIP_H =
  '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true"><circle cx="4" cy="6" r="1.25"/><circle cx="4" cy="10" r="1.25"/><circle cx="8" cy="6" r="1.25"/><circle cx="8" cy="10" r="1.25"/><circle cx="12" cy="6" r="1.25"/><circle cx="12" cy="10" r="1.25"/></svg>';
