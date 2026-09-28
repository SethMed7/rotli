// Settings → Appearance → Show in Rotli (the owner, 2026-09-28: "a place in
// settings where you can choose things to hide"): one switch per part of the
// chrome in src/lib/hideable.ts, grouped by where it sits. Each description
// says how to reach it without the button, so hiding never removes anything.

import { LAUNCH_FEATURES, PLATFORM } from "../../lib/featurePolicy";
import { HIDEABLE, type HideId, type Hidden, hideDescription } from "../../lib/hideable";
import { SHOW_HOTKEYS } from "../../lib/hotkeyHint";
import { showEverything, useHidden } from "../../state/hidden";
import { Toggle } from "./toggle";

type Item = (typeof HIDEABLE)[number];

/** Rotli Web never shows the Browser button, and its search button is the only
 * way into the palette (⌘K belongs to the browser there), so neither is offered. */
const WEB_KEEPS: readonly HideId[] = ["browserButton", "search"];

/** The items this build has (Breve only where it ships). */
export function visibilityItems(platform = PLATFORM, breve = LAUNCH_FEATURES.breve): readonly Item[] {
  return HIDEABLE.filter(
    (item) => (item.id !== "breve" || breve) && (platform !== "web" || !WEB_KEEPS.includes(item.id)),
  );
}

const ITEMS = visibilityItems();

export function VisibilitySettings() {
  const hidden = useHidden((s) => s.hidden);
  const setShown = useHidden((s) => s.setShown);
  return <VisibilitySection hidden={hidden} setShown={setShown} onShowAll={showEverything} />;
}

/** The section for one set of choices (tests render it directly). */
export function VisibilitySection({
  hidden,
  setShown,
  onShowAll,
  items = ITEMS,
}: {
  hidden: Hidden;
  setShown: (id: HideId, shown: boolean) => void;
  onShowAll: () => void;
  items?: readonly Item[];
}) {
  const groups = [...new Set(items.map((item) => item.group))];
  const count = items.filter((item) => hidden[item.id]).length;
  return (
    <>
      <h4 className="sethead">Show in Rotli</h4>
      <p className="setnote">
        Hide what you don’t use. Nothing goes away: what a hidden button opens stays in Rotli.
      </p>
      {groups.map((group) => (
        <section key={group} aria-label={group}>
          <span className="mplabel">{group}</span>
          <div className="swgroup">
            {items
              .filter((item) => item.group === group)
              .map((item) => (
                <Toggle
                  key={item.id}
                  on={!hidden[item.id]}
                  title={item.title}
                  desc={hideDescription(item, SHOW_HOTKEYS)}
                  onChange={() => setShown(item.id, !!hidden[item.id])}
                />
              ))}
          </div>
        </section>
      ))}
      {count > 0 && (
        <button type="button" className="ghostbtn" onClick={onShowAll}>
          Show everything ({count} hidden)
        </button>
      )}
    </>
  );
}
