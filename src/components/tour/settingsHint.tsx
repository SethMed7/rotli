// The note at Settings after first run (state/settingsHint.ts): setup asked
// for four things; the rest waits in Settings, and this says where. It sits
// beside the Settings button, never over the work, and goes on any choice.

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { dispatch } from "../../keys/registry";
import { dismissSettingsHint, useSettingsHint } from "../../state/settingsHint";
import { placeStep } from "./guidedTourModel";

// the title bar's Settings first: always there, and clear of the sidebar's player
const ANCHORS = ['.titlebar [data-hotkey="app.settings"]', '.sb-foot [data-tour="settings"]'];

export function SettingsHint() {
  return useSettingsHint((s) => s.open) && <SettingsHintCard />;
}

export function SettingsHintCard() {
  const card = useRef<HTMLElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const anchor = ANCHORS.map((selector) => document.querySelector<HTMLElement>(selector)).find(Boolean);
      const node = card.current;
      if (!anchor || !node) return setAt(null);
      const rect = anchor.getBoundingClientRect();
      setAt(
        placeStep(
          { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
          { width: window.innerWidth, height: window.innerHeight },
          { width: node.offsetWidth, height: node.offsetHeight },
        ).card,
      );
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismissSettingsHint();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <aside
      ref={card}
      className="tour-card settings-hint"
      role="status"
      aria-label="More in Settings"
      style={at ? { left: at.left, top: at.top } : { visibility: "hidden" }}
    >
      <h2>Make Rotli more yours</h2>
      <p>
        Your quokka, music, how the window lives, chat models, and more are in Settings. Change any of it
        whenever you like.
      </p>
      <div className="settings-hint-actions">
        <button type="button" className="ghostbtn" onClick={dismissSettingsHint}>
          Got it
        </button>
        <button
          type="button"
          className="settings-hint-open"
          onClick={() => {
            dismissSettingsHint();
            dispatch("app.settings");
          }}
        >
          Open Settings
        </button>
      </div>
    </aside>
  );
}
