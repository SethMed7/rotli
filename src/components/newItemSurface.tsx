// The ⌘N chooser tab (Seth, 2026-07-29): "cmd+n would be a new tab but no
// type selected — you have to choose board / md / doc etc." A blank tab
// offering every creatable kind; picking one closes this tab and opens the
// created item in its real surface. Esc (⌘W) closes like any tab.
//
// 2026-07-30: Chat joined the grid as slot 1 ("cmd+n then 1 for chat"), every
// card wears its digit, and the surface takes focus on open so ⌘N → digit is
// one fluid motion. Digits are surface-local keys (the registry law allows a
// focused surface's own onKeyDown; nothing here listens on window).

import { useEffect, useRef } from "react";

import { dispatch } from "../keys/registry";
import { createManagedItem, requestManagedBoardCreation } from "../newItems/composition";
import { NEW_ITEM_DEFINITIONS, type NewItemKind } from "../newItems/model";
import { usePanesStore } from "../state/panes";
import { useUiStore } from "../state/ui";
import { BoardGlyph, ChatGlyph, DocumentGlyph, FileGlyph, NewFileGlyph } from "./glyphs";

function kindGlyph(kind: NewItemKind) {
  if (kind === "board") return <BoardGlyph size={22} />;
  if (kind === "document") return <DocumentGlyph size={22} />;
  if (kind === "sheet") return <FileGlyph size={22} />;
  return <NewFileGlyph size={22} />;
}

interface ChooserEntry {
  digit: string;
  label: string;
  description: string;
  glyph: React.ReactNode;
  run: () => void;
}

export function NewItemSurface({ paneId, tabId }: { paneId: string; tabId: string }) {
  const rootRef = useRef<HTMLDivElement>(null);

  // ⌘N lands here — take focus so the digit keys work without a click
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  const close = () => usePanesStore.getState().closeTabById(paneId, tabId, { record: false });

  const pickKind = (kind: NewItemKind) => {
    close();
    if (kind === "board") {
      requestManagedBoardCreation({ newTab: true });
      return;
    }
    void createManagedItem(kind, { newTab: true }).catch((err: unknown) =>
      useUiStore
        .getState()
        .setRowActionError(`Couldn’t create — ${err instanceof Error ? err.message : String(err)}`),
    );
  };

  const entries: ChooserEntry[] = [
    {
      digit: "1",
      label: "Chat",
      description: "A conversation with your models over the memex.",
      glyph: <ChatGlyph size={22} />,
      run: () => {
        close();
        dispatch("chat.new");
      },
    },
    ...NEW_ITEM_DEFINITIONS.map((def, index) => ({
      digit: String(index + 2),
      label: def.label,
      description: def.description,
      glyph: kindGlyph(def.kind),
      run: () => pickKind(def.kind),
    })),
  ];

  return (
    <div
      ref={rootRef}
      className="ni-surface"
      tabIndex={-1}
      onKeyDown={(event) => {
        // bare digits only — ⌘1..9 (tab switch) and other chords pass through
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        const entry = entries.find((candidate) => candidate.digit === event.key);
        if (!entry) return;
        event.preventDefault();
        event.stopPropagation();
        entry.run();
      }}
    >
      <div className="ni-inner">
        <p className="ni-lead">What is this tab?</p>
        <p className="ni-hint">Press a number, or click a card.</p>
        <ul className="ni-grid">
          {entries.map((entry) => (
            <li key={entry.digit}>
              <button
                type="button"
                className="ni-card"
                onClick={entry.run}
                aria-label={`New ${entry.label} (press ${entry.digit})`}
              >
                <kbd className="ni-key">{entry.digit}</kbd>
                {entry.glyph}
                <span className="ni-label">{entry.label}</span>
                <span className="ni-desc">{entry.description}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
