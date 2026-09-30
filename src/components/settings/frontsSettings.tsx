// Settings → Appearance → Sidebar (the owner, 2026-09-30: "turn off Chat and
// Breve, then have Notes be able to turn off too; the user can choose their
// home, but Notes is the default home; at least one stays on"). The rules live
// in src/lib/sidebarFronts.ts; state/fronts.ts applies them.

import { type Front, canTurnOff, enabledFronts, homeFront } from "../../lib/sidebarFronts";
import { AVAILABLE_FRONTS, useFronts } from "../../state/fronts";
import { SegField } from "./seg";
import { Toggle } from "./toggle";

export const FRONT_LABEL: Record<Front, string> = { notes: "Notes", chat: "Chat", breve: "Breve" };

const FRONT_DESC: Record<Front, string> = {
  notes: "All notes, Captures, Tasks, Main, and your files.",
  chat: "Your chats, their folders, and ⌥A from anywhere.",
  breve: "Your briefs, watchlist, and routines.",
};

export function FrontsSettings() {
  const prefs = useFronts((s) => s.prefs);
  const setFront = useFronts((s) => s.setFront);
  const setHome = useFronts((s) => s.setHome);
  const on = enabledFronts(prefs, AVAILABLE_FRONTS);
  return (
    <>
      <h4 className="sethead">Sidebar sections</h4>
      <p className="setnote">
        Turn off what you don’t use; at least one stays on. With only one on, the switcher at the top of the
        sidebar goes away. Home is where Rotli opens.
      </p>
      <div className="swgroup">
        {AVAILABLE_FRONTS.map((front) => {
          const isOn = on.includes(front);
          const last = isOn && !canTurnOff(front, prefs, AVAILABLE_FRONTS);
          return (
            <Toggle
              key={front}
              on={isOn}
              title={FRONT_LABEL[front]}
              desc={last ? `${FRONT_DESC[front]} It’s the only one on, so it stays.` : FRONT_DESC[front]}
              locked={last}
              onChange={() => setFront(front, !isOn)}
            />
          );
        })}
      </div>
      {on.length > 1 && (
        <SegField<Front>
          label="Home"
          value={homeFront(prefs, AVAILABLE_FRONTS)}
          options={on.map((front) => [front, FRONT_LABEL[front]])}
          onPick={setHome}
        />
      )}
    </>
  );
}
