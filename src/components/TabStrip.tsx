// The tab strip — rendered for EVERY pane now (Seth, 2026-06-13): the old
// "single-tab pane shows zero tab chrome" Apple-Notes default is retired, so a
// lone tab is still visible and closeable. 34px on ground, 1px bottom border;
// tabs 96–208px, always-labeled + type glyph; active = surface fill merging
// into the editor; close × on active/hover only; labeled + button; focus = 2px
// clay top edge on the focused pane's active tab, multi-pane only (CSS
// `.panes.multi`). Overflow compresses to the 96px floor, then horizontally
// scrolls behind linen fade masks — no dropdown.
//
// Tabs are HTML5-draggable: drag within a strip to reorder, onto another
// strip to move, or onto a pane edge to split (the edge case lives in the
// PaneTree body overlay). The strip itself is a drop target — pointer x vs
// tab midpoints picks the insertion index and a 2px accent line previews it.
// The lone-tab-in-lone-pane hides its × (closing it is a no-op anyway).

import {
  type DragEvent as ReactDragEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  const moveTab = usePanesStore((s) => s.moveTab);
  const draggingTab = usePanesStore((s) => s.draggingTab);
  const setDraggingTab = usePanesStore((s) => s.setDraggingTab);
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

  // insertion index previewed by the 2px accent line; null = no drop preview
  const [dropAt, setDropAt] = useState<number | null>(null);

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

  // pointer x vs each tab's midpoint -> the index the drop would land at
  const insertionIndex = (clientX: number): number => {
    const el = scrollRef.current;
    if (!el) return pane.tabs.length;
    const tabs = Array.from(el.querySelectorAll<HTMLElement>('[role="tab"]'));
    for (let i = 0; i < tabs.length; i++) {
      const r = tabs[i]?.getBoundingClientRect();
      if (r && clientX < r.left + r.width / 2) return i;
    }
    return tabs.length;
  };

  const onStripDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!draggingTab) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropAt(insertionIndex(event.clientX));
  };

  const onStripDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    const drag = draggingTab;
    const at = dropAt ?? insertionIndex(event.clientX);
    setDropAt(null);
    setDraggingTab(null);
    if (!drag) return;
    event.preventDefault();
    moveTab(drag.paneId, drag.tabId, pane.id, at);
  };

  return (
    <div className="tabstrip" role="tablist">
      <div
        className="tabscroll-wrap"
        data-fade-left={fade.left}
        data-fade-right={fade.right}
      >
        <div
          className="tabscroll"
          ref={scrollRef}
          onScroll={updateFade}
          onDragOver={onStripDragOver}
          onDrop={onStripDrop}
          onDragLeave={() => setDropAt(null)}
        >
          {pane.tabs.map((tab, i) => {
            const dragging =
              draggingTab?.paneId === pane.id && draggingTab.tabId === tab.id;
            return (
              <div key={tab.id} className="tabslot">
                {dropAt === i && <span className="tab-ins" aria-hidden="true" />}
                <div
                  role="tab"
                  draggable
                  aria-selected={tab.id === pane.activeTabId}
                  className={`${tab.id === pane.activeTabId ? "tab active" : "tab"}${
                    dragging ? " dragging" : ""
                  }`}
                  onClick={() => activateTab(pane.id, tab.id)}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/x-rotli-tab", tab.id);
                    setDraggingTab({ paneId: pane.id, tabId: tab.id });
                  }}
                  onDragEnd={() => {
                    setDraggingTab(null);
                    setDropAt(null);
                  }}
                >
                  <FileGlyph size={13} className="tglyph" />
                  <span>{tabLabel(tab, titles)}</span>
                  {!loneInLonePane && (
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
