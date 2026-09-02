import type { ComponentType, KeyboardEvent } from "react";

import { useNow } from "../../lib/useNow";
import type { BreveView } from "../../state/ui";
import { useUiStore } from "../../state/ui";
import { ActivityGlyph, ClockGlyph, CoffeeGlyph, EyeGlyph, FileGlyph, GearGlyph, HomeGlyph } from "../glyphs";
import { breveHealthSummary } from "./breveHealthModel";
import { useBreveSnapshot } from "./useBreve";

type NavItem = {
  id: BreveView;
  label: string;
  glyph: ComponentType<{ size?: number }>;
};

// The dashboard is Breve's vault-specific news hub. Durable reading and
// configuration stay directly reachable; notifications project the sanitized
// scheduler log for this vault only.
const NAV: NavItem[] = [
  { id: "dashboard", label: "Dashboard", glyph: HomeGlyph },
  { id: "briefs", label: "Briefs", glyph: FileGlyph },
  { id: "notifications", label: "Notifications", glyph: ActivityGlyph },
  { id: "routines", label: "Routines", glyph: ClockGlyph },
  { id: "watchlist", label: "Watchlist", glyph: EyeGlyph },
  { id: "settings", label: "Settings", glyph: GearGlyph },
];

export function BreveSidebar({ zoom }: { zoom: number }) {
  const view = useUiStore((s) => s.breveView);
  const setView = useUiStore((s) => s.setBreveView);
  const snapshot = useBreveSnapshot().data;
  const now = useNow();
  const enabledRoutines = snapshot?.config.routines.filter((r) => r.enabled).length ?? 0;
  const counts: Record<BreveView, number | null> = {
    dashboard: null,
    briefs: snapshot ? snapshot.briefs.length : null,
    notifications: snapshot ? snapshot.notifications.length : null,
    routines: snapshot ? enabledRoutines : null,
    watchlist: snapshot ? snapshot.counts.topics : null,
    settings: null,
  };
  // The rail status is the health sentence's short form: "Managed by Rotli"
  // only while every enabled routine's last run succeeded; a failing brief
  // slot says how long it has been (audit 2026-09-02 §1.1).
  const health = snapshot ? breveHealthSummary(snapshot, now) : null;
  const sourceLabel = !snapshot
    ? "Loading Breve…"
    : health && health.level !== "off"
      ? health.label
      : snapshot.source === "legacy"
        ? "Legacy active"
        : snapshot.source === "rotli"
          ? (health?.label ?? "Imported")
          : "Not configured";
  const statusWarn = health?.level === "warn";

  const onNavKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const buttons = Array.from(
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button[data-breve-view]") ?? [],
    );
    const current = buttons.indexOf(event.currentTarget);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    const next = buttons[nextIndex];
    if (!next) return;
    const nextView = next.dataset.breveView as BreveView;
    setView(nextView);
    if (useUiStore.getState().breveView === nextView) requestAnimationFrame(() => next.focus());
  };

  return (
    <nav className="breve-rail" aria-label="Breve" style={{ zoom }}>
      <div className="breve-rail-head">
        <CoffeeGlyph size={16} />
        <span>Breve</span>
      </div>
      <div className={statusWarn ? "breve-rail-status warn" : "breve-rail-status"} title={health?.detail}>
        {sourceLabel}
      </div>
      <div className="breve-rail-nav">
        {NAV.map(({ id, label, glyph: Glyph }) => (
          <button
            type="button"
            key={id}
            className={view === id ? "frow sel" : "frow"}
            aria-current={view === id ? "page" : undefined}
            data-breve-view={id}
            tabIndex={view === id ? 0 : -1}
            onClick={() => setView(id)}
            onKeyDown={onNavKeyDown}
          >
            <Glyph size={14.5} />
            <span className="fname">{label}</span>
            {counts[id] !== null && <span className="count">{counts[id]}</span>}
          </button>
        ))}
      </div>
      {snapshot?.scheduler !== "none" && (
        <div className="breve-rail-foot">
          <ClockGlyph size={12} />
          <span>{snapshot?.scheduler === "rotli" ? "Scheduled by Rotli" : "Scheduled by Breve"}</span>
        </div>
      )}
    </nav>
  );
}
