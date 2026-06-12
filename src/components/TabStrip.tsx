// The tab strip — r2 pane/tab law, exactly. Rendered ONLY when a pane has
// more than one tab (a single-tab pane shows zero tab chrome; PaneTree
// enforces it). 34px on ground, 1px bottom border; tabs 96–208px,
// always-labeled + type glyph; active = surface fill merging into the editor;
// close × on active/hover only; labeled + button; focus = 2px clay top edge
// on the focused pane's active tab, multi-pane only (CSS `.panes.multi`).
// Overflow compresses to the 96px floor, then horizontally scrolls behind
// linen fade masks — no dropdown.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNotes } from "../services/hooks";
import { usePanesStore } from "../state/panes";
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
        <div className="tabscroll" ref={scrollRef} onScroll={updateFade}>
          {pane.tabs.map((tab) => (
            <div
              key={tab.id}
              role="tab"
              aria-selected={tab.id === pane.activeTabId}
              className={tab.id === pane.activeTabId ? "tab active" : "tab"}
              onClick={() => activateTab(pane.id, tab.id)}
            >
              <FileGlyph size={13} className="tglyph" />
              <span>{tabLabel(tab, titles)}</span>
              <button
                type="button"
                className="x"
                aria-label="Close tab — ⌘W"
                onClick={(event) => {
                  event.stopPropagation();
                  closeTabById(pane.id, tab.id);
                }}
              >
                <XGlyph size={9} />
              </button>
            </div>
          ))}
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
