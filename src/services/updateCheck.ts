// The routine update check (1.3.0): Rotli asks the signed release feed whether
// a newer build exists shortly after launch and then a few times a day, so
// nobody has to remember the button in Settings. It only ever LEARNS that an
// update exists — the dot on the Settings button. Nothing downloads, installs,
// or interrupts until the person chooses "Install & relaunch", and the whole
// routine is one Settings switch (autoUpdateCheck) away from never running.
//
// Idle citizenship (docs/design/shell-runtime-decision.md): no interval. One
// re-armed timer, and a hidden window waits for its next wake — which also
// covers a Mac that slept through the timer.

import { type UpdateStatus, checkForUpdate, isTauri } from "../lib/tauri";
import { useUiStore } from "../state/ui";

export const UPDATE_CHECK_LAUNCH_DELAY_MS = 30_000;
export const UPDATE_CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export interface RoutineUpdateCheck {
  start: () => void;
  /** The window came back (or the switch turned on): ask if one is due. */
  wake: () => Promise<void>;
  stop: () => void;
}

export function createRoutineUpdateCheck(deps: {
  now: () => number;
  enabled: () => boolean;
  visible: () => boolean;
  check: () => Promise<UpdateStatus>;
  report: (available: boolean, version: string | null) => void;
  setTimer: (fn: () => void, ms: number) => () => void;
}): RoutineUpdateCheck {
  let lastAsked: number | null = null;
  let launched = false;
  let clearTimer: (() => void) | null = null;
  let asking = false;

  const arm = (ms: number) => {
    clearTimer?.();
    clearTimer = deps.setTimer(() => {
      clearTimer = null;
      launched = true;
      void ask();
    }, ms);
  };

  const ask = async () => {
    if (asking) return;
    if (!deps.enabled() || !deps.visible()) {
      arm(UPDATE_CHECK_EVERY_MS);
      return;
    }
    asking = true;
    lastAsked = deps.now();
    try {
      const status = await deps.check();
      deps.report(status.available, status.version ?? null);
    } catch {
      // offline, feed unreachable: ordinary, silent; the manual button in
      // Settings is where a failure gets words
    } finally {
      asking = false;
      arm(UPDATE_CHECK_EVERY_MS);
    }
  };

  return {
    start: () => arm(UPDATE_CHECK_LAUNCH_DELAY_MS),
    wake: async () => {
      // until the launch timer has had its turn, startup owns the moment
      if (!launched) return;
      if (lastAsked === null || deps.now() - lastAsked >= UPDATE_CHECK_EVERY_MS) await ask();
    },
    stop: () => {
      clearTimer?.();
      clearTimer = null;
    },
  };
}

/** Wire the routine to the real app — the MAIN window of a packaged build
 * only. A development build never pings the feed on its own, and the browser
 * has no bundle to update. Returns the teardown. */
export function startRoutineUpdateCheck(): () => void {
  if (!isTauri() || import.meta.env.DEV) return () => {};
  const routine = createRoutineUpdateCheck({
    now: () => Date.now(),
    enabled: () => useUiStore.getState().autoUpdateCheck,
    visible: () => document.visibilityState === "visible",
    check: checkForUpdate,
    report: (available, version) => {
      const ui = useUiStore.getState();
      ui.setUpdateAvailable(available);
      ui.setUpdateVersion(available ? version : null);
    },
    setTimer: (fn, ms) => {
      const id = window.setTimeout(fn, ms);
      return () => window.clearTimeout(id);
    },
  });
  const onVisible = () => {
    if (document.visibilityState === "visible") void routine.wake();
  };
  document.addEventListener("visibilitychange", onVisible);
  const unsubscribe = useUiStore.subscribe((state, previous) => {
    if (state.autoUpdateCheck && !previous.autoUpdateCheck) void routine.wake();
  });
  routine.start();
  return () => {
    routine.stop();
    unsubscribe();
    document.removeEventListener("visibilitychange", onVisible);
  };
}
