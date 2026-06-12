// The titlebar law (r4/r5 gates): identity + rail toggles LEFT · empty
// draggable CENTER · actions RIGHT. Native traffic lights stay (the inset
// reserves their space). Dragging is manual startDragging so double-click
// never triggers the built-in zoom.

import type { MouseEvent } from "react";
import { dispatch } from "../keys/registry";
import { startWindowDrag } from "../lib/tauri";
import { useUiStore } from "../state/ui";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";
import { ModuleSwitcher } from "./ModuleSwitcher";
import { ChevronDown, RailFolders, RailList } from "./glyphs";

function onDragRegionMouseDown(event: MouseEvent) {
  if (event.button !== 0 || event.detail > 1) return;
  void startWindowDrag();
}

export function Titlebar() {
  const switcherOpen = useUiStore((s) => s.switcherOpen);
  const setSwitcherOpen = useUiStore((s) => s.setSwitcherOpen);
  const foldersRailOpen = useUiStore((s) => s.foldersRailOpen);
  const noteListOpen = useUiStore((s) => s.noteListOpen);

  return (
    <header className="titlebar">
      <div className="tb-inset" onMouseDown={onDragRegionMouseDown} />
      <div className="identity-wrap">
        <button
          type="button"
          className={switcherOpen ? "identity open" : "identity"}
          aria-haspopup="menu"
          aria-expanded={switcherOpen}
          onClick={() => setSwitcherOpen(!switcherOpen)}
        >
          <Icon name="rotli-notes" size={14} />
          Notes
          <ChevronDown className="chev" />
        </button>
        {switcherOpen && <ModuleSwitcher onClose={() => setSwitcherOpen(false)} />}
      </div>
      <div className="railbtns">
        <IconButton
          label="Folders — ⌘0"
          pressed={foldersRailOpen}
          onClick={() => dispatch("panes.toggleFolders")}
        >
          <RailFolders />
        </IconButton>
        <IconButton
          label="Notes list — ⌥⌘L"
          pressed={noteListOpen}
          onClick={() => dispatch("panes.toggleList")}
        >
          <RailList />
        </IconButton>
      </div>
      <div className="tb-spacer" onMouseDown={onDragRegionMouseDown} />
      <div className="tb-actions">
        <IconButton label="Settings">
          <Icon name="rotli-settings" />
        </IconButton>
      </div>
    </header>
  );
}
