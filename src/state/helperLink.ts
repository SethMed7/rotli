// Rotli Web: the pairing with Rotli Helper on this computer. `link` is the
// port and token the user pasted; `reachable` is the last health answer.
// Hydrated at boot from the browser vault, so surfaces can ask synchronously.

import { create } from "zustand";

import { LAUNCH_FEATURES } from "../lib/featurePolicy";
import type { HelperLink } from "../lib/helperPairing";

/** What stands between a pairing and a working chat (2026-09-17, the owner:
 * "if there is ever a missing token for the helper or anything we shouldn't
 * be able to go in chat without addressing it"). */
export type HelperProblem = "unreachable" | "refused";

interface HelperLinkState {
  link: HelperLink | null;
  /** null = not checked yet this session */
  reachable: boolean | null;
  /** The helper answered but would not take our token (a new install printed
   * a new code), or nothing answers at all. Cleared by a call that succeeds. */
  problem: HelperProblem | null;
  /** The boot (or Check again) verification is in flight. */
  verifying: boolean;
  hydrated: boolean;
  setLink: (link: HelperLink | null) => void;
  setReachable: (reachable: boolean | null) => void;
  setProblem: (problem: HelperProblem | null) => void;
  setVerifying: (verifying: boolean) => void;
}

export const useHelperLink = create<HelperLinkState>((set) => ({
  link: null,
  reachable: null,
  problem: null,
  verifying: false,
  hydrated: false,
  setLink: (link) => set({ link, hydrated: true, problem: null }),
  setReachable: (reachable) => set({ reachable }),
  setProblem: (problem) => set({ problem }),
  setVerifying: (verifying) => set({ verifying }),
}));

/** Paired with a helper (whether or not it answered yet). */
export function helperLinked(): boolean {
  return useHelperLink.getState().link !== null;
}

/** Paired AND proven: the helper answered health this session, has not
 * refused the token, and no verification is mid-flight. A pairing not yet
 * checked (a reload, before the boot verification lands) is NOT ready, and
 * neither is one being checked — health answers before the authenticated
 * call does, and a reinstalled helper answers health while refusing the old
 * token (review of #19, twice). Unreachable or refused is not a chat runtime
 * either; the surfaces route to the setup dialog. Pure over the state shape
 * so the rule is testable. */
export function helperReadyFrom(
  s: Pick<HelperLinkState, "link" | "reachable" | "problem" | "verifying">,
): boolean {
  return s.link !== null && s.problem === null && s.reachable === true && !s.verifying;
}

export function helperReady(): boolean {
  return helperReadyFrom(useHelperLink.getState());
}

/** Chat actions fire where something can chat: the desktop's Rust side, or
 * Rotli Web paired with a helper that answers. Actions register everywhere so
 * the palette and Settings → Hotkeys list them; this decides at fire time. */
export function chatRuntimeEnabled(): boolean {
  return LAUNCH_FEATURES.chat || helperReady();
}
