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
import { QuokkaMark } from "./Character";
import {
  PlusGlyph,
  SidebarGlyph,
  SplitDownGlyph,
  SplitRightGlyph,
  SunGlyph,
} from "./glyphs";

/** One size for every titlebar icon so the bar reads as one cohesive row
 * (Seth, 2026-06-15). */
const TB_ICON = 16;

function onDragRegionMouseDown(event: MouseEvent) {
  if (event.button !== 0 || event.detail > 1) return;
  void startWindowDrag();
}

export function Titlebar() {
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const updateAvailable = useUiStore((s) => s.updateAvailable);
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
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
      {/* always-visible sidebar toggle (Seth, 2026-06-15): the clear way to
          reopen a collapsed left menu — replaces the subtle warm-edge strip.
          .tb-lead left-aligns its tooltip so the label never clips off-window. */}
      {!settingsOpen && (
        <IconButton
          className="tb-lead"
          label={sidebarCollapsed ? "Show sidebar — ⌘0" : "Hide sidebar — ⌘0"}
          onClick={() => dispatch("chrome.toggleSidebars")}
        >
          <SidebarGlyph size={TB_ICON} />
        </IconButton>
      )}
      {settingsOpen ? (
        // settings surface (r1 frame F): the identity reads Settings; the rail
        // toggles step aside — clicking the identity walks back to notes
        <div className="identity-wrap">
          <button type="button" className="identity" onClick={() => dispatch("app.settings")}>
            <Icon name="rotli-settings" size={TB_ICON} />
            Settings
          </button>
        </div>
      ) : (
        // the module dropdown is retired (Seth, 2026-06-26): the left menu's three
        // sections (Inbox · Chat · Notes) ARE the navigation now. The identity is a
        // plain home wordmark — click returns to the note panes.
        <div className="identity-wrap">
          <button type="button" className="identity home" onClick={() => dispatch("modules.notes")}>
            <QuokkaMark size={19} className="identity-mark" />
            <span className="rotli-wordmark identity-word">rotli</span>
          </button>
        </div>
      )}
      <div className="tb-spacer" onMouseDown={onDragRegionMouseDown} />
      <div className="tb-actions">
        {/* panes & tabs, visible (Seth 2026-06-12: keyboard-only is not discoverable) */}
        {!settingsOpen && (
          <>
            <IconButton label="New tab — ⌘T" onClick={() => dispatch("tabs.new")}>
              <PlusGlyph size={TB_ICON} />
            </IconButton>
            {/* two distinct split buttons (Seth, 2026-06-13): right = vertical
                divider (columns), down = horizontal divider (rows) */}
            <IconButton label="Split right — ⌘D" onClick={() => dispatch("panes.splitRight")}>
              <SplitRightGlyph size={TB_ICON} />
            </IconButton>
            <IconButton label="Split down — ⌘⇧D" onClick={() => dispatch("panes.splitDown")}>
              <SplitDownGlyph size={TB_ICON} />
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
            <SunGlyph size={TB_ICON} />
          </IconButton>
        )}
        <IconButton
          className="tb-trail"
          label={updateAvailable ? "Update available — open Settings · ⌘," : "Settings — ⌘,"}
          pressed={settingsOpen}
          onClick={() => dispatch("app.settings")}
        >
          <Icon name="rotli-settings" size={TB_ICON} />
          {updateAvailable && <span className="tb-update-dot" aria-hidden="true" />}
        </IconButton>
      </div>
    </header>
  );
}
