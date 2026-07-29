// The ⌘N chooser tab (Seth, 2026-07-29): "cmd+n would be a new tab but no
// type selected — you have to choose board / md / doc etc." A blank tab
// offering every creatable kind; picking one closes this tab and opens the
// created item in its real surface. Esc (⌘W) closes like any tab.

import { createManagedItem } from "../newItems/composition";
import { NEW_ITEM_DEFINITIONS, type NewItemKind } from "../newItems/model";
import { usePanesStore } from "../state/panes";
import { useUiStore } from "../state/ui";
import { BoardGlyph, DocumentGlyph, FileGlyph, NewFileGlyph } from "./glyphs";

function kindGlyph(kind: NewItemKind) {
  if (kind === "board") return <BoardGlyph size={22} />;
  if (kind === "document") return <DocumentGlyph size={22} />;
  if (kind === "sheet") return <FileGlyph size={22} />;
  return <NewFileGlyph size={22} />;
}

export function NewItemSurface({ paneId, tabId }: { paneId: string; tabId: string }) {
  const pick = (kind: NewItemKind) => {
    usePanesStore.getState().closeTabById(paneId, tabId, { record: false });
    void createManagedItem(kind, { newTab: true }).catch((err: unknown) =>
      useUiStore
        .getState()
        .setRowActionError(`Couldn’t create — ${err instanceof Error ? err.message : String(err)}`),
    );
  };
  return (
    <div className="ni-surface">
      <p className="ni-lead">What is this tab?</p>
      <ul className="ni-grid">
        {NEW_ITEM_DEFINITIONS.map((def) => (
          <li key={def.kind}>
            <button
              type="button"
              className="ni-card"
              onClick={() => pick(def.kind)}
              aria-label={`New ${def.label}`}
            >
              {kindGlyph(def.kind)}
              <span className="ni-label">{def.label}</span>
              <span className="ni-desc">{def.description}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
