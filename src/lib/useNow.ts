// One presentation clock for every relative-time and time-window projection.
// Components read it as an external store instead of calling Date.now() during
// render or each owning a separate timer effect.

import { useSyncExternalStore } from "react";

/** How often `useNow` advances; a timestamp up to one tick ahead is "now". */
export const NOW_TICK_MS = 30_000;

interface ClockEnv {
  setInterval: (fn: () => void, ms: number) => number;
  clearInterval: (id: number) => void;
  doc: Pick<Document, "hidden"> & {
    addEventListener(type: "visibilitychange", fn: () => void): void;
    removeEventListener(type: "visibilitychange", fn: () => void): void;
  };
}

const browserEnv = (): ClockEnv | null =>
  typeof window === "undefined"
    ? null
    : {
        setInterval: (fn, ms) => window.setInterval(fn, ms),
        clearInterval: (id) => window.clearInterval(id),
        doc: document,
      };

/** The clock behind `useNow`. The interval exists only while a listener is
 * subscribed AND the window is visible: hiding clears it, showing refreshes
 * once and re-arms. */
export function createNowClock(env: () => ClockEnv | null = browserEnv, now: () => number = Date.now) {
  const listeners = new Set<() => void>();
  let snapshot = now();
  let host: ClockEnv | null = null;
  let timer: number | null = null;

  const refresh = () => {
    snapshot = now();
    for (const listener of listeners) listener();
  };
  const arm = () => {
    if (host && timer === null && !host.doc.hidden) timer = host.setInterval(refresh, NOW_TICK_MS);
  };
  const disarm = () => {
    if (host && timer !== null) host.clearInterval(timer);
    timer = null;
  };
  const onVisibility = () => {
    if (host?.doc.hidden) return disarm();
    refresh();
    arm();
  };

  const start = () => {
    host = env();
    if (!host) return;
    snapshot = now();
    arm();
    host.doc.addEventListener("visibilitychange", onVisibility);
  };
  const stop = () => {
    disarm();
    host?.doc.removeEventListener("visibilitychange", onVisibility);
    host = null;
  };

  return {
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      if (listeners.size === 1) start();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stop();
      };
    },
    getSnapshot: (): number => snapshot,
  };
}

const clock = createNowClock();

/** A shared wall-clock snapshot that advances while a Rotli window is visible. */
export function useNow(): number {
  return useSyncExternalStore(clock.subscribe, clock.getSnapshot, clock.getSnapshot);
}
