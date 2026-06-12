// The identity module switcher (r5, approved; rows + copy per the r7 gate).
// Six modules over one brain: Notes is current; the unbuilt five sit quiet with
// phase pills — the popover doubles as the roadmap. Clicking an unbuilt module
// does nothing (no dead-end dialogs).

import { useEffect, useRef } from "react";
import { useTransientPopover } from "../lib/popover";
import { Icon, type RotliIconName } from "./Icon";

interface UpcomingModule {
  name: string;
  icon: RotliIconName;
  pill: string;
  next: boolean;
}

const UPCOMING: UpcomingModule[] = [
  { name: "Chat", icon: "rotli-chat", pill: "Next", next: true },
  { name: "Voice", icon: "rotli-voice", pill: "Next", next: true },
  { name: "Memory", icon: "rotli-memory", pill: "then", next: false },
  { name: "Inbox", icon: "rotli-inbox", pill: "later", next: false },
  { name: "Board", icon: "rotli-board", pill: "later", next: false },
];

export function ModuleSwitcher({ onClose }: { onClose: () => void }) {
  const popRef = useRef<HTMLDivElement>(null);

  // the standard transient plumbing: outside-click closes, and Esc unwinds
  // through the ui store's transient stack in true topmost-first order —
  // no ad-hoc listeners. The identity button (the anchor) sits outside popRef;
  // its own onClick toggles, and the stack close fires first on outside-click.
  const anchorRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    anchorRef.current = popRef.current?.closest(".identity-wrap") ?? null;
  }, []);
  useTransientPopover([popRef, anchorRef], true, onClose);

  return (
    <div ref={popRef} className="modpop" role="menu" aria-label="Modules">
      <div className="mrow sel" role="menuitem" onClick={onClose}>
        <Icon name="rotli-notes" size={14.5} />
        Notes
        <span className="hk">
          <kbd>⌃1</kbd>
        </span>
      </div>
      {UPCOMING.map((mod) => (
        <div key={mod.name} className="mrow soon" role="menuitem" aria-disabled="true">
          <Icon name={mod.icon} size={14.5} />
          {mod.name}
          <span className={mod.next ? "soonpill next" : "soonpill"}>{mod.pill}</span>
        </div>
      ))}
      <div className="mfoot">
        One brain underneath. Notes writes it · Chat talks with it · Voice speaks it · the Memory
        recalls it.
      </div>
    </div>
  );
}
