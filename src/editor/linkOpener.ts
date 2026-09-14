// Clicking a link in the Markdown editor (#14, audit 2026-07). Plain click
// stays the edit path (caret in, markers reveal); a visible wikilink opens on
// click, and holding ⌘ routes a web link's address through the
// scheme-allowlisted native opener. Works in beautified AND raw mode — the
// match runs on the underlying Markdown text, not the decoration.
//
// A link that cannot open says so: a small note beside the click, cleared by
// the next edit or caret move, instead of a silent dead click.

import { EditorView, showTooltip, type Tooltip } from "@codemirror/view";

import { openUrl } from "../lib/tauri";
import { usePanesStore } from "../state/panes";
import { LINK_OPEN_FAILED, linkHref } from "./inlineLinks";
import { linkFailureAt, linkFailureField, linkFailurePos, webLinkAt } from "./linkTarget";
import { editorLinkOpensOnClick, WIKILINK_RE } from "./wikilink";
import { resolveWikilinkTarget } from "./wikilinkIndex";

const failureTooltip = showTooltip.compute([linkFailureField], (state): Tooltip | null => {
  const pos = linkFailurePos(state);
  if (pos === null) return null;
  return {
    pos,
    above: true,
    create: () => {
      const dom = document.createElement("div");
      dom.className = "rotli-link-failed";
      dom.setAttribute("role", "status");
      dom.textContent = LINK_OPEN_FAILED;
      return { dom };
    },
  };
});

function openWebAddress(view: EditorView, raw: string, pos: number): void {
  const fail = () => {
    if (view.dom.isConnected) view.dispatch({ effects: linkFailureAt(pos) });
  };
  const href = linkHref(raw);
  if (!href) return fail();
  void openUrl(href).catch(fail);
}

function tryOpenWikilinkAt(lineText: string, col: number): boolean {
  WIKILINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKILINK_RE.exec(lineText)) !== null) {
    if (col >= m.index && col <= m.index + m[0].length) {
      const id = resolveWikilinkTarget(m[1] ?? "");
      if (!id) return false;
      usePanesStore.getState().openNote(id);
      return true;
    }
    if (m.index > col) break;
  }
  return false;
}

const clickHandler = EditorView.domEventHandlers({
  click(e, view) {
    // only a click ON a line counts: the blank space below the last line maps
    // to the document end, which would open a link that merely ends the note
    if (!(e.target instanceof Element) || !e.target.closest(".cm-line")) return false;
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    if (pos == null) return false;
    const line = view.state.doc.lineAt(pos);
    const col = pos - line.from;
    if (editorLinkOpensOnClick("note", e.button, e.metaKey) && tryOpenWikilinkAt(line.text, col)) {
      e.preventDefault();
      return true;
    }
    if (!editorLinkOpensOnClick("web", e.button, e.metaKey)) return false;
    const address = webLinkAt(line.text, col);
    if (address === null) return false;
    openWebAddress(view, address, pos);
    e.preventDefault();
    return true;
  },
});

export const linkOpener = [clickHandler, linkFailureField, failureTooltip];
