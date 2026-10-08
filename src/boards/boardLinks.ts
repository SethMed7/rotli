// Opening a link on a board shape (2026-10-08), for the board tab and a note's
// board embed alike. Excalidraw falls back to window.open, which the Mac app's
// webview ignores, so every link was a dead click; this handler takes the click
// over (preventDefault) and opens what boards/links.ts says the link is. A link
// that can't open says so in the canvas's own toast, never silently.

import { useCallback } from "react";

import { LINK_OPEN_FAILED } from "../editor/inlineLinks";
import { resolveWikilinkNote } from "../editor/wikilinkIndex";
import { openUrl } from "../lib/tauri";
import { chatSlugOf, isChatItem } from "../services/systemBrowser";
import { usePanesStore } from "../state/panes";
import { classifyBoardLink } from "./links";

/** The slice of Excalidraw's API a link needs. */
export interface BoardLinkApi {
  getSceneElements: () => readonly { id: string; groupIds?: readonly string[] }[];
  scrollToContent: (target: string, opts: { fitToContent: boolean; animate: boolean }) => void;
  setToast: (toast: { message: string; closable?: boolean; duration?: number } | null) => void;
}

export function openBoardLink(link: string, api: BoardLinkApi | null): void {
  const say = (message: string) => api?.setToast({ message, closable: true, duration: 4000 });
  const openWeb = (url: string) => void openUrl(url).catch(() => say(LINK_OPEN_FAILED));
  const target = classifyBoardLink(link);
  switch (target.kind) {
    case "element": {
      const here = api
        ?.getSceneElements()
        .some((element) => element.id === target.id || element.groupIds?.includes(target.id));
      if (here) api?.scrollToContent(target.id, { fitToContent: true, animate: true });
      else if (target.web) openWeb(target.web);
      else say("That shape isn't on this board.");
      return;
    }
    case "web":
      openWeb(target.url);
      return;
    case "note": {
      const note = resolveWikilinkNote(target.target);
      if (!note) say(`No note called “${target.target}”.`);
      // a linked chat opens as the conversation, anything else by its kind
      else if (isChatItem(note)) usePanesStore.getState().openChat(chatSlugOf(note));
      else usePanesStore.getState().openSummary(note);
      return;
    }
    case "unsupported":
      say(LINK_OPEN_FAILED);
  }
}

/** Excalidraw's onLinkOpen, bound to the surface's API ref. */
export function useBoardLinkOpener(api: { readonly current: BoardLinkApi | null }) {
  return useCallback(
    (element: { link: string | null }, event: { preventDefault: () => void }) => {
      event.preventDefault(); // the vendor's window.open fallback is a dead end here
      if (element.link) openBoardLink(element.link, api.current);
    },
    [api],
  );
}
