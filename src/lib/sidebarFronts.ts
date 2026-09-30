// The sidebar's fronts, each on or off (the owner, 2026-09-30: "I should be
// able to turn off Chat and Breve, then have Notes be able to turn off too,
// and the user can choose their home, but Notes is the default home. The user
// needs at least one on. If they only have one on, hide the switcher.").
// Pure policy: state/fronts.ts holds the choice and applies it.

export const FRONTS = ["notes", "chat", "breve"] as const;
export type Front = (typeof FRONTS)[number];

export interface FrontsPrefs {
  /** The fronts turned off. */
  off: Front[];
  /** Where Rotli opens. */
  home: Front;
}

export const DEFAULT_FRONTS: FrontsPrefs = { off: [], home: "notes" };

const isFront = (value: unknown): value is Front => FRONTS.includes(value as Front);

/** The saved choice read tolerantly: anything unknown is the default. */
export function parseFronts(value: unknown): FrontsPrefs {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_FRONTS, off: [] };
  const raw = value as Record<string, unknown>;
  const off = Array.isArray(raw.off) ? [...new Set(raw.off.filter(isFront))] : [];
  return { off, home: isFront(raw.home) ? raw.home : DEFAULT_FRONTS.home };
}

/** The fronts that are on, in switcher order. Never empty: with everything
 * off (a hand-edited file), the first available front stays on. */
export function enabledFronts(prefs: FrontsPrefs, available: readonly Front[]): Front[] {
  const on = available.filter((front) => !prefs.off.includes(front));
  return on.length > 0 ? on : available.slice(0, 1);
}

/** A front can go off only while another stays on. */
export function canTurnOff(front: Front, prefs: FrontsPrefs, available: readonly Front[]): boolean {
  const on = enabledFronts(prefs, available);
  return on.includes(front) && on.length > 1;
}

/** Where Rotli opens: the chosen home while it's on, else the first front on. */
export function homeFront(prefs: FrontsPrefs, available: readonly Front[]): Front {
  const on = enabledFronts(prefs, available);
  return on.includes(prefs.home) ? prefs.home : on[0]!;
}

/** Turn one front on or off. Turning off the last one is refused; turning off
 * the home moves home to the first front still on. */
export function withFront(
  prefs: FrontsPrefs,
  front: Front,
  on: boolean,
  available: readonly Front[],
): FrontsPrefs {
  if (!on && !canTurnOff(front, prefs, available)) return prefs;
  const off = on ? prefs.off.filter((f) => f !== front) : [...new Set([...prefs.off, front])];
  const next = { off, home: prefs.home };
  return { off, home: homeFront(next, available) };
}

/** The front the sidebar shows, from the UI's mode and view. */
export function frontOf(mode: "notes" | "breve", view: "home" | "chat"): Front {
  if (mode === "breve") return "breve";
  return view === "chat" ? "chat" : "notes";
}

/** The UI's mode and view that show one front. */
export function frontState(front: Front): { sidebarMode: "notes" | "breve"; sidebarView: "home" | "chat" } {
  if (front === "breve") return { sidebarMode: "breve", sidebarView: "home" };
  return { sidebarMode: "notes", sidebarView: front === "chat" ? "chat" : "home" };
}
