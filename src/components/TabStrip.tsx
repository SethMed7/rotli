// The tab strip — rendered for EVERY pane now (Seth, 2026-06-13): the old
// "single-tab pane shows zero tab chrome" Apple-Notes default is retired, so a
// lone tab is still visible and closeable. 34px on ground, 1px bottom border;
// tabs 96–208px, always-labeled + type glyph; active = surface fill merging
// into the editor; close × on active/hover only; labeled + button; focus = 2px
// clay top edge on the focused pane's active tab, multi-pane only (CSS
// `.panes.multi`). Overflow compresses to the 96px floor, then horizontally
// scrolls behind linen fade masks — no dropdown.
//
// Tabs drag with POINTER events (Seth, 2026-06-15: HTML5 drag is dead in the
// macOS WKWebView shell): drag within a strip to reorder, onto another strip to
// move, or onto a pane edge to split. The gesture + hit-testing live in
// lib/tabDrag; the strip just starts it on pointerdown and reads the store's
// dropPreview to paint the 2px insertion line. The lone-tab-in-lone-pane hides
// its × (closing it is a no-op anyway).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { startTabDrag } from "../lib/tabDrag";
import { useNotes } from "../services/hooks";
import { leaves, usePanesStore } from "../state/panes";
import type { LeafNode, Tab } from "../types";
import { FileGlyph, PlusGlyph, XGlyph } from "./glyphs";

function tabLabel(tab: Tab, titles: Map<string, string>): string {
  // surfaceKind dispatch — grows with the union ('chat' …)
  switch (tab.surfaceKind) {
    case "note":
      return titles.get(tab.noteId) ?? "Untitled";
  }
}

export function TabStrip({ pane }: { pane: LeafNode }) {
  const activateTab = usePanesStore((s) => s.activateTab);
  const closeTabById = usePanesStore((s) => s.closeTabById);
  const draggingTab = usePanesStore((s) => s.draggingTab);
  // the insertion index previewed for THIS strip (2px line), or null
  const dropAt = usePanesStore((s) =>
    s.dropPreview?.kind === "strip" && s.dropPreview.paneId === pane.id
      ? s.dropPreview.index
      : null,
  );
  // the only tab of the only pane: closing it is a no-op, so hide its × — the
  // strip stays for the new always-visible law (Seth, 2026-06-13)
  const loneInLonePane = usePanesStore(
    (s) => leaves(s.root).length === 1 && pane.tabs.length === 1,
  );
  const allNotes = useNotes().data ?? [];
  const titles = useMemo(
    () => new Map(allNotes.map((n) => [n.id, n.title])),
    [allNotes],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ left: false, right: false });
  const updateFade = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setFade((f) => (f.left === left && f.right === right ? f : { left, right }));
  }, []);

  useEffect(() => {
    updateFade();
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(updateFade);
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateFade]);

  // tab count changes resize content, not the container — re-check explicitly
  useEffect(updateFade, [pane.tabs.length, updateFade]);

  // keep the active tab visible when it changes (new tab, ⌘1–9, ⌃Tab)
  useEffect(() => {
    const el = scrollRef.current?.querySelector('[aria-selected="true"]');
    el?.scrollIntoView({ inline: "nearest", block: "nearest" });
    updateFade();
  }, [pane.activeTabId, updateFade]);

  const newTabHere = () => {
    const store = usePanesStore.getState();
    store.focusPane(pane.id);
    store.newTab();
  };

  return (
    <div className="tabstrip" role="tablist">
      <div
        className="tabscroll-wrap"
        data-fade-left={fade.left}
        data-fade-right={fade.right}
      >
        <div className="tabscroll" data-tabscroll data-pane-id={pane.id} ref={scrollRef} onScroll={updateFade}>
          {pane.tabs.map((tab, i) => {
            const dragging =
              draggingTab?.paneId === pane.id && draggingTab.tabId === tab.id;
            return (
              <div key={tab.id} className="tabslot">
                {dropAt === i && <span className="tab-ins" aria-hidden="true" />}
                <div
                  role="tab"
                  data-tab-id={tab.id}
                  data-tab-index={i}
                  aria-selected={tab.id === pane.activeTabId}
                  className={`${tab.id === pane.activeTabId ? "tab active" : "tab"}${
                    dragging ? " dragging" : ""
                  }`}
                  onClick={() => activateTab(pane.id, tab.id)}
                  onPointerDown={(event) =>
                    startTabDrag(event, pane.id, tab.id, tabLabel(tab, titles))
                  }
                >
                  <FileGlyph size={13} className="tglyph" />
                  <span>{tabLabel(tab, titles)}</span>
                  {!loneInLonePane && (
                    <button
                      type="button"
                      className="x"
                      aria-label="Close tab — ⌘W"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        closeTabById(pane.id, tab.id);
                      }}
                    >
                      <XGlyph size={9} />
                    </button>
                  )}
                </div>
                {dropAt === pane.tabs.length && i === pane.tabs.length - 1 && (
                  <span className="tab-ins" aria-hidden="true" />
                )}
              </div>
            );
          })}
        </div>
      </div>
      <button type="button" className="tabplus" aria-label="New tab — ⌘T" onClick={newTabHere}>
        <PlusGlyph size={13} />
        <span className="tip" aria-hidden="true">
          New tab — ⌘T
        </span>
      </button>
    </div>
  );
}
