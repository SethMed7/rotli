// Stop a canvas editor's render loop while its host has no size. Univer redraws
// on every animation frame for as long as a render unit is active — 60 frames a
// second measured in WebKit, idle or not, even inside a warm tab hidden with
// display:none (audit 2026-10-12). A host with no box (a warm idle tab, a folded
// embed) pauses the units this call paused; a box again resumes exactly those.

export interface PausableUnit {
  isActive(): boolean;
  activate(): void;
  deactivate(): void;
}

type Observe = (host: Element, onVisible: (visible: boolean) => void) => () => void;

const observeSize: Observe = (host, onVisible) => {
  const observer = new ResizeObserver(([entry]) => {
    if (entry) onVisible(entry.contentRect.width > 0 && entry.contentRect.height > 0);
  });
  observer.observe(host);
  return () => observer.disconnect();
};

export function pauseWhileHidden(
  host: Element,
  units: () => Iterable<PausableUnit>,
  observe: Observe = observeSize,
): () => void {
  const paused = new Set<PausableUnit>();
  const resume = () => {
    for (const unit of paused) unit.activate();
    paused.clear();
  };
  const stop = observe(host, (visible) => {
    if (visible) return resume();
    for (const unit of units()) {
      if (paused.has(unit) || !unit.isActive()) continue;
      unit.deactivate();
      paused.add(unit);
    }
  });
  return () => {
    stop();
    resume();
  };
}

/** A canvas engine's render unit, typed by shape (Univer's `IRender`): its
 * `activated$` replays the current state on subscribe. */
interface RenderUnitLike {
  activated$: { subscribe(next: (active: boolean) => void): { unsubscribe(): void } };
  activate(): void;
  deactivate(): void;
}

/** `pauseWhileHidden` over every render unit an engine's manager holds. */
export function pauseRenderWhileHidden(
  host: Element,
  renderManager: { getRenderAll(): Map<string, RenderUnitLike> },
): () => void {
  return pauseWhileHidden(host, () =>
    [...renderManager.getRenderAll().values()].map((unit) => ({
      isActive: () => {
        let active = false;
        unit.activated$.subscribe((value) => (active = value)).unsubscribe();
        return active;
      },
      activate: () => unit.activate(),
      deactivate: () => unit.deactivate(),
    })),
  );
}
