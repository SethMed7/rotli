// The titlebar law (r4/r5 gates): identity LEFT · empty draggable CENTER ·
// actions RIGHT. Native traffic lights stay (the inset reserves their space).
// Dragging is manual startDragging so double-click never triggers the built-in
// zoom.
//
// Rail-toggle law (Seth, 2026-06-13): the two titlebar rail icons (Folders ⌘0,
// Notes list ⌥⌘L) are GONE. One unified, memory-based sidebar toggle now lives
// INLINE left of the note-list filter (and on the warm-edge restore strip when
// both rails are collapsed). The ⌘0 / ⌥⌘L chords stay rebindable in Hotkeys —
// they just no longer have a home in the bar.

import type { MouseEvent } from "react";
import { dispatch } from "../keys/registry";
import { startWindowDrag } from "../lib/tauri";
import { GLASS_TINTS, SOLID_THEMES, useUiStore } from "../state/ui";
import { Icon } from "./Icon";
import { IconButton } from "./IconButton";
import { ModuleSwitcher } from "./ModuleSwitcher";
import { ChevronDown, SplitDownGlyph, SplitRightGlyph, SunGlyph } from "./glyphs";

function onDragRegionMouseDown(event: MouseEvent) {
  if (event.button !== 0 || event.detail > 1) return;
  void startWindowDrag();
}

export function Titlebar() {
  const switcherOpen = useUiStore((s) => s.switcherOpen);
  const setSwitcherOpen = useUiStore((s) => s.setSwitcherOpen);
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const theme = useUiStore((s) => s.theme);
  const themeFamily = useUiStore((s) => s.themeFamily);
  const glassMode = useUiStore((s) => s.glassMode);
  const glassTint = useUiStore((s) => s.glassTint);
  const tintLabel = GLASS_TINTS.find((t) => t.value === glassTint)?.label ?? glassTint;
  const themeLabel =
    theme === "system"
      ? "System"
      : (SOLID_THEMES.find((t) => t.family === themeFamily && t.mode === theme)?.label ?? theme);

  return (
    <header className="titlebar">
      <div className="tb-inset" onMouseDown={onDragRegionMouseDown} />
      {settingsOpen ? (
        // settings surface (r1 frame F): the identity reads Settings; the rail
        // toggles step aside — clicking the identity walks back to notes
        <div className="identity-wrap">
          <button type="button" className="identity" onClick={() => dispatch("app.settings")}>
            <Icon name="rotli-settings" size={14} />
            Settings
          </button>
        </div>
      ) : (
        <>
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
        </>
      )}
      <div className="tb-spacer" onMouseDown={onDragRegionMouseDown} />
      <div className="tb-actions">
        {/* panes & tabs, visible (Seth 2026-06-12: keyboard-only is not discoverable) */}
        {!settingsOpen && (
          <>
            <IconButton label="New tab — ⌘T" onClick={() => dispatch("tabs.new")}>
              <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                <path
                  d="M12 5v14M5 12h14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </IconButton>
            {/* two distinct split buttons (Seth, 2026-06-13): right = vertical
                divider (columns), down = horizontal divider (rows) */}
            <IconButton label="Split right — ⌘D" onClick={() => dispatch("panes.splitRight")}>
              <SplitRightGlyph />
            </IconButton>
            <IconButton label="Split down — ⌘⇧D" onClick={() => dispatch("panes.splitDown")}>
              <SplitDownGlyph />
            </IconButton>
            <span className="tb-sep" aria-hidden="true" />
          </>
        )}
        {/* sun = theme, in every approved titlebar frame (r1 tip "Theme — light";
            r2/r4/r5 frame A). The sun cycles the four solid themes; while glass
            mode is on the slot becomes the tint cycler instead (Seth, 2026-06-12). */}
        {glassMode ? (
          <IconButton label={`Glass — ${tintLabel}`} onClick={() => dispatch("theme.cycleGlassTint")}>
            <span className="tintdot" />
          </IconButton>
        ) : (
          <IconButton label={`Theme — ${themeLabel}`} onClick={() => dispatch("theme.cycle")}>
            <SunGlyph />
          </IconButton>
        )}
        <IconButton
          label="Settings — ⌘,"
          pressed={settingsOpen}
          onClick={() => dispatch("app.settings")}
        >
          <Icon name="rotli-settings" />
        </IconButton>
      </div>
    </header>
  );
}
