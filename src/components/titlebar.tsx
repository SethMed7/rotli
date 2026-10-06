// The titlebar law (r4/r5 gates): identity LEFT · empty draggable CENTER ·
// actions RIGHT. Native traffic lights stay (the inset reserves their space).
// Dragging is manual startDragging so double-click never triggers the built-in
// zoom.
//
// Rail-toggle law (the maintainer, 2026-06-13): the two titlebar rail icons (Folders ⌘0,
// Notes list ⌥⌘L) are GONE. One unified, memory-based sidebar toggle now lives
// INLINE left of the note-list filter (and on the warm-edge restore strip when
// both rails are collapsed). The ⌘0 / ⌥⌘L chords stay rebindable in Keybindings —
// they just no longer have a home in the bar.

import type { MouseEvent } from "react";

import { dispatch } from "../keys/registry";
import { PLATFORM } from "../lib/featurePolicy";
import { SHOW_HOTKEYS, hotkeyHint } from "../lib/hotkeyHint";
import { startWindowDrag, toggleMaximize } from "../lib/tauri";
import { useAppearanceLook } from "../state/appearanceLook";
import { useHidden } from "../state/hidden";
import { canBack, canForward, useNavHistory } from "../state/navHistory";
import { usePanesStore } from "../state/panes";
import { useIsDarkTheme } from "../state/theme";
import { nextTheme, solidThemeLabel } from "../state/themeCycle";
import { useUiStore } from "../state/ui";
import { QuokkaMark } from "./character";
import {
  BrowserGlyph,
  ChevronRight,
  PlusGlyph,
  SidebarGlyph,
  SplitDownGlyph,
  SplitRightGlyph,
  SunGlyph,
} from "./glyphs";
import { Icon } from "./icon";
import { IconButton } from "./iconButton";
import { Palette } from "./palette";
import { PinButtons } from "./pinnedSites/pinButtons";

/** One size for every titlebar icon so the bar reads as one cohesive row
 * (the maintainer, 2026-06-15). */
const TB_ICON = 16;

/** Rotli Web: the bar is a toolbar inside a browser tab, not window chrome.
 * No traffic-light inset (the brand sits there), no drag region, no zoom on
 * double-click, and no private browser (that is a native webview). */
const WEB = PLATFORM === "web";

function onDragRegionMouseDown(event: MouseEvent) {
  if (WEB || event.button !== 0 || event.detail > 1) return;
  void startWindowDrag();
}

/** Double-click an empty titlebar region → zoom, like every other Mac app. */
function onDragRegionDoubleClick() {
  if (WEB) return;
  void toggleMaximize();
}

export function Titlebar() {
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  // what the person hid (Settings → Appearance → Show in Rotli)
  const hidden = useHidden((s) => s.hidden);
  // Back/Forward over opened notes (the maintainer #14) — ‹ › beside the search field
  const navBack = useNavHistory(canBack);
  const navForward = useNavHistory(canForward);
  const updateAvailable = useUiStore((s) => s.updateAvailable);
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const sidebarMode = useUiStore((s) => s.sidebarMode);
  const breveActive = sidebarMode === "breve";
  const paletteOpen = useUiStore((s) => s.paletteOpen);
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen);
  const theme = useUiStore((s) => s.theme);
  const themeFamily = useUiStore((s) => s.themeFamily);
  const themeLabel = theme === "system" ? "System" : solidThemeLabel({ family: themeFamily, mode: theme });
  // the label says where the next click lands: it follows the cycle setting
  // and, under System, the mode the Mac shows now (the applied theme)
  const themeCycle = useAppearanceLook((s) => s.themeCycle);
  const themeCyclePicks = useAppearanceLook((s) => s.themeCyclePicks);
  const shownDark = useIsDarkTheme();
  const nextLabel = solidThemeLabel(
    nextTheme({ theme, themeFamily }, shownDark, themeCycle, themeCyclePicks),
  );

  return (
    <header className="titlebar">
      {WEB ? (
        <a className="tb-brand" href="/" title="Rotli — back to the site" aria-label="Rotli">
          <QuokkaMark size={18} />
          <span className="tb-brand-word">rotli</span>
        </a>
      ) : (
        <div
          className="tb-inset"
          onMouseDown={onDragRegionMouseDown}
          onDoubleClick={onDragRegionDoubleClick}
        />
      )}
      {/* always-visible sidebar toggle (the maintainer, 2026-06-15): the clear way to
          reopen a collapsed left menu — replaces the subtle warm-edge strip.
          .tb-lead left-aligns its tooltip so the label never clips off-window. */}
      {!settingsOpen && (
        <IconButton
          className="tb-lead"
          label={`${sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}${hotkeyHint(" — ⌘0")}`}
          hotkey="chrome.toggleSidebars"
          onClick={() => dispatch("chrome.toggleSidebars")}
        >
          <SidebarGlyph size={TB_ICON} />
        </IconButton>
      )}
      {settingsOpen && (
        // settings surface (r1 frame F): the identity reads Settings; the rail
        // toggles step aside — clicking the identity walks back to notes
        <div className="identity-wrap">
          <button type="button" className="identity" onClick={() => dispatch("app.settings")}>
            <Icon name="rotli-settings" size={TB_ICON} />
            Settings
          </button>
        </div>
      )}
      {/* The titlebar field is the real search control: ⌘K focuses it and its
          results unfold directly below. The surrounding strip remains a drag
          region; search interactions stop propagation so they never drag or
          maximize the window. */}
      <div className="tb-mid" onMouseDown={onDragRegionMouseDown} onDoubleClick={onDragRegionDoubleClick}>
        {!settingsOpen && (
          <>
            {/* ‹ › — walk the opened-notes trail (the maintainer #14; ⌘[ / ⌘]) */}
            {!breveActive && !hidden.history && (
              <>
                <button
                  type="button"
                  className="tb-nav"
                  aria-label={`Back — previous note${hotkeyHint(" (⌘[)")}`}
                  title={`Back — previous note${hotkeyHint(" ⌘[")}`}
                  disabled={!navBack}
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={() => dispatch("nav.back")}
                >
                  <ChevronRight size={12} className="tb-nav-back" />
                </button>
                <button
                  type="button"
                  className="tb-nav"
                  aria-label={`Forward — next note${hotkeyHint(" (⌘])")}`}
                  title={`Forward — next note${hotkeyHint(" ⌘]")}`}
                  disabled={!navForward}
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={() => dispatch("nav.forward")}
                >
                  <ChevronRight size={12} />
                </button>
              </>
            )}
            {paletteOpen ? (
              <>
                <button
                  type="button"
                  className="pal-focus-scrim"
                  aria-label="Close search"
                  onMouseDown={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => event.stopPropagation()}
                  onClick={() => setPaletteOpen(false)}
                />
                <Palette breveActive={breveActive} onClose={() => setPaletteOpen(false)} />
              </>
            ) : (
              // on the web the button is the only way into the palette: never hidden
              (WEB || !hidden.search) && (
                <button
                  type="button"
                  className="tb-search"
                  data-tour="search"
                  aria-label={`${breveActive ? "Search Rotli and actions" : "Search notes and actions"}${hotkeyHint(" — ⌘K")}`}
                  onMouseDown={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => event.stopPropagation()}
                  onClick={() => dispatch("palette.toggle")}
                >
                  <span className="tb-search-mark" aria-hidden="true">
                    <QuokkaMark size={15} />
                  </span>
                  <span className="tb-search-label">{breveActive ? "Search Rotli…" : "Search…"}</span>
                  {SHOW_HOTKEYS && <kbd className="tb-search-kbd">⌘K</kbd>}
                </button>
              )
            )}
          </>
        )}
      </div>
      <div className="tb-actions">
        {/* panes & tabs, visible (the maintainer 2026-06-12: keyboard-only is not discoverable) */}
        {!settingsOpen && !breveActive && !(hidden.newButton && hidden.splitButtons) && (
          <>
            {!hidden.newButton && (
              <IconButton
                label={`New…${hotkeyHint(" — ⌘N")}`}
                hotkey="tabs.newChooser"
                onClick={() => dispatch("tabs.newChooser")}
              >
                <PlusGlyph size={TB_ICON} />
              </IconButton>
            )}
            {/* two distinct split buttons (the maintainer, 2026-06-13): right = vertical
                divider (columns), down = horizontal divider (rows) */}
            {!hidden.splitButtons && (
              <>
                <IconButton
                  label={`Split right${hotkeyHint(" — ⌘D")}`}
                  hotkey="panes.splitRight"
                  onClick={() => dispatch("panes.splitRight")}
                >
                  <SplitRightGlyph size={TB_ICON} />
                </IconButton>
                <IconButton
                  label={`Split down${hotkeyHint(" — ⌘⇧D")}`}
                  hotkey="panes.splitDown"
                  onClick={() => dispatch("panes.splitDown")}
                >
                  <SplitDownGlyph size={TB_ICON} />
                </IconButton>
              </>
            )}
            <span className="tb-sep" aria-hidden="true" />
          </>
        )}
        {/* pinned sites, left of the globe (2026-10-01) */}
        {!settingsOpen && !WEB && <PinButtons />}
        {!settingsOpen && !WEB && !hidden.browserButton && (
          <IconButton label="New private browser" onClick={() => usePanesStore.getState().openBrowser()}>
            <BrowserGlyph size={TB_ICON} />
          </IconButton>
        )}
        {/* The sun steps through environments as Appearance → Theme button says. */}
        {/* second from the right with the longest label: it anchors right
            too, or its centred tip reaches past the window (2026-10-06) */}
        {!hidden.themeButton && (
          <IconButton
            className="tb-trail"
            label={`Theme — ${themeLabel} · click for ${nextLabel}`}
            onClick={() => dispatch("theme.cycle")}
          >
            <SunGlyph size={TB_ICON} />
          </IconButton>
        )}
        <IconButton
          className="tb-trail"
          label={
            updateAvailable
              ? `Update available — open Settings${hotkeyHint(" · ⌘,")}`
              : `Settings${hotkeyHint(" — ⌘,")}`
          }
          hotkey="app.settings"
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
