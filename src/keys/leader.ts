// Two-step hotkeys (1.3.0): press a leader chord (⌘⇧W for views, ⌘⇧S for the
// sidebar), then a number. While a leader is pending, the dispatcher offers it
// every key FIRST — that is how ⌘1–9 mean "slot 1–9" for one keystroke and
// stay tab jumps the rest of the time, with no change to the binding format,
// the recorder, or the persisted overrides. The leader chords themselves are
// ordinary registered actions, so they are listed and rebindable like
// everything else; the number step is positional by nature.
//
// The number step is ⌘1–9 anywhere, or the bare digit when focus is not in a
// text field (the dispatcher's typing guard runs first — a digit typed into a
// note is never stolen).
//
// Pending is never sticky: a pick, Esc, any other chord, a timeout, or another
// leader all end it.

import { create } from "zustand";

export type LeaderId = "views" | "sidebar";

export interface LeaderMode {
  id: LeaderId;
  /** `n` is 1–9. The mode has already ended when this runs. */
  pick: (n: number) => void;
  /** Runs once however the mode ends — take the hints down here. */
  onEnd?: () => void;
}

export const LEADER_TIMEOUT_MS = 4000;

/** What is pending, for the surfaces that paint number hints. */
export const useLeaderStore = create<{ mode: LeaderId | null }>(() => ({ mode: null }));

let active: LeaderMode | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function end(): LeaderMode | null {
  const mode = active;
  active = null;
  if (timer) clearTimeout(timer);
  timer = null;
  if (mode) {
    useLeaderStore.setState({ mode: null });
    mode.onEnd?.();
  }
  return mode;
}

export function enterLeader(mode: LeaderMode, timeoutMs = LEADER_TIMEOUT_MS): void {
  end();
  active = mode;
  useLeaderStore.setState({ mode: mode.id });
  timer = setTimeout(end, timeoutMs);
}

export function cancelLeader(): void {
  end();
}

/** Offer a pressed (normalized) chord to the pending leader. True = the leader
 * used it and the dispatcher must stop; false = dispatch as usual (after any
 * other chord the leader has already stood down). */
export function leaderConsumes(pressed: string): boolean {
  if (!active) return false;
  const slot = /^(?:Meta\+)?([1-9])$/.exec(pressed);
  const mode = end();
  if (slot) {
    mode?.pick(Number(slot[1]));
    return true;
  }
  return pressed === "Esc";
}
