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
): { release: () => void; rescan: () => void } {
  const paused = new Set<PausableUnit>();
  let hidden = false;
  const resume = () => {
    for (const unit of paused) unit.activate();
    paused.clear();
  };
  const pauseAll = () => {
    for (const unit of units()) {
      if (paused.has(unit) || !unit.isActive()) continue;
      unit.deactivate();
      paused.add(unit);
    }
  };
  const stop = observe(host, (visible) => {
    hidden = !visible;
    if (visible) resume();
    else pauseAll();
  });
  return {
    release: () => {
      stop();
      resume();
    },
    // a unit created while the host has no box is paused at once — the size
    // watcher alone would not look again until the host changed size
    rescan: () => {
      if (hidden) pauseAll();
    },
  };
}

/** A canvas engine's render unit, typed by shape (Univer's `IRender`): its
 * `activated$` replays the current state on subscribe. */
interface RenderUnitLike {
  activated$: { subscribe(next: (active: boolean) => void): { unsubscribe(): void } };
  activate(): void;
  deactivate(): void;
}

/** `pauseWhileHidden` over every render unit an engine's manager holds,
 * including units it creates later (`created$`). One wrapper per unit, so the
 * pause recognizes a unit it already paused. */
export function pauseRenderWhileHidden(
  host: Element,
  renderManager: {
    getRenderAll(): Map<string, RenderUnitLike>;
    created$?: { subscribe(next: () => void): { unsubscribe(): void } };
  },
  observe: Observe = observeSize,
): () => void {
  const wrappers = new WeakMap<RenderUnitLike, PausableUnit>();
  const wrap = (unit: RenderUnitLike): PausableUnit => {
    let wrapper = wrappers.get(unit);
    if (!wrapper) {
      wrapper = {
        isActive: () => {
          let active = false;
          unit.activated$.subscribe((value) => (active = value)).unsubscribe();
          return active;
        },
        activate: () => unit.activate(),
        deactivate: () => unit.deactivate(),
      };
      wrappers.set(unit, wrapper);
    }
    return wrapper;
  };
  const pause = pauseWhileHidden(host, () => [...renderManager.getRenderAll().values()].map(wrap), observe);
  const created = renderManager.created$?.subscribe(() => pause.rescan());
  return () => {
    created?.unsubscribe();
    pause.release();
  };
}
