import type { ComponentType, KeyboardEvent } from "react";
import type { BreveView } from "../../state/ui";
import { useUiStore } from "../../state/ui";
import {
  ClockGlyph,
  CloudGlyph,
  CoffeeGlyph,
  EyeGlyph,
  FileGlyph,
  MailGlyph,
} from "../glyphs";
import { useBreveSnapshot } from "./useBreve";

type NavItem = {
  id: BreveView;
  label: string;
  glyph: ComponentType<{ size?: number }>;
};

const NAV: NavItem[] = [
  { id: "briefs", label: "Briefs", glyph: FileGlyph },
  { id: "watchlist", label: "Watchlist", glyph: EyeGlyph },
  { id: "routines", label: "Routines", glyph: ClockGlyph },
  { id: "models", label: "Models", glyph: CloudGlyph },
  { id: "configure", label: "Configure", glyph: MailGlyph },
];

export function BreveSidebar({ zoom }: { zoom: number }) {
  const view = useUiStore((s) => s.breveView);
  const setView = useUiStore((s) => s.setBreveView);
  const snapshot = useBreveSnapshot().data;
  const enabledRoutines = snapshot?.config.routines.filter((r) => r.enabled).length ?? 0;
  const counts: Record<BreveView, number | null> = {
    briefs: snapshot ? snapshot.briefs.length : null,
    watchlist: snapshot ? snapshot.counts.topics : null,
    routines: snapshot ? enabledRoutines : null,
    models: null,
    configure: null,
  };
  const sourceLabel = !snapshot
    ? "Loading Breve…"
    : snapshot.scheduler === "rotli"
      ? "Managed by Rotli"
      : snapshot.source === "legacy"
      ? "Legacy active"
      : snapshot.source === "rotli"
        ? "Imported"
        : "Not configured";

  const onNavKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const buttons = Array.from(
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button[data-breve-view]") ?? [],
    );
    const current = buttons.indexOf(event.currentTarget);
    const nextIndex = event.key === "Home"
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
      <div className="breve-rail-status">{sourceLabel}</div>
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
