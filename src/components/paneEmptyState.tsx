// All tabs closed (only possible in the lone pane) — the quokka rest state
// (the maintainer, 2026-07-28: "close all tabs and have an empty state"). Since
// 2026-09-29 it's a small scene that matches the theme, with the person's own
// quokka in it (shown even when the sidebar companion is off), the three ways
// back in, and, very quietly, where Rotli lives: the site and its source.

import { dispatch } from "../keys/registry";
import { ROTLI_REPO_URL } from "../lib/feedback";
import { SHOW_HOTKEYS } from "../lib/hotkeyHint";
import { SITE_URL } from "../lib/thanksBanner";
import { openLink } from "../services/thanksShare";
import { usePanesStore } from "../state/panes";
import { useUiStore } from "../state/ui";
import { Character } from "./character";
import { PANE_SCENES } from "./paneEmptyScenes";

export function PaneEmptyState() {
  const family = useUiStore((s) => s.themeFamily);
  const scene = PANE_SCENES[family] ?? PANE_SCENES.warm;
  return (
    <div className="list-empty pane-empty">
      <div className="pane-scene" data-scene={scene.name}>
        <svg className="pane-scene-art" viewBox="0 0 440 200" aria-hidden="true" focusable="false">
          {scene.art}
        </svg>
        <Character
          name={scene.pose}
          size={96}
          className="be-quokka pane-scene-quokka"
          accessorized
          alwaysVisible
        />
      </div>
      <p className="be-title">All clear</p>
      <p className="be-sub">
        <button type="button" className="pane-empty-act" onClick={() => dispatch("tabs.new")}>
          {SHOW_HOTKEYS && <kbd>⌘T</kbd>} new tab
        </button>
        <button type="button" className="pane-empty-act" onClick={() => dispatch("palette.toggle")}>
          {SHOW_HOTKEYS && <kbd>⌘K</kbd>} search
        </button>
        <button
          type="button"
          className="pane-empty-act"
          onClick={() => usePanesStore.getState().reopenClosedTab()}
        >
          {SHOW_HOTKEYS && <kbd>⌘⌥T</kbd>} reopen tab
        </button>
      </p>
      <p className="pane-empty-links">
        <button type="button" onClick={() => void openLink(SITE_URL)}>
          rotli.co
        </button>
        <span aria-hidden="true">·</span>
        <button type="button" onClick={() => void openLink(ROTLI_REPO_URL)}>
          source on GitHub
        </button>
      </p>
    </div>
  );
}
