// One presentation clock for every relative-time and time-window projection.
// Components read it as an external store instead of calling Date.now() during
// render or each owning a separate timer effect.

import { useSyncExternalStore } from "react";

const TICK_MS = 30_000;
const listeners = new Set<() => void>();
let snapshot = Date.now();
let timer: number | null = null;

function refresh(): void {
  if (typeof document !== "undefined" && document.hidden) return;
  snapshot = Date.now();
  for (const listener of listeners) listener();
}

function start(): void {
  if (typeof window === "undefined" || timer !== null) return;
  snapshot = Date.now();
  timer = window.setInterval(refresh, TICK_MS);
  document.addEventListener("visibilitychange", refresh);
}

function stop(): void {
  if (typeof window === "undefined" || timer === null) return;
  window.clearInterval(timer);
  timer = null;
  document.removeEventListener("visibilitychange", refresh);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stop();
  };
}

function getSnapshot(): number {
  return snapshot;
}

/** A shared wall-clock snapshot that advances while a Rotli window is visible. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
