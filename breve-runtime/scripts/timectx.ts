/**
 * BREVE time context — one place that knows what "today" and "now" mean for the maintainer.
 * Never use new Date().toISOString().slice(0,10) for "today": that's UTC, and after
 * 8pm Eastern it's tomorrow (the bug that served yesterday's brief). Always go
 * through these helpers; they honor settings.json (home tz + travel mode).
 */

import { CONFIG_PATH } from "./paths";

export type Settings = {
  timezone: string;
  leadMinutes: number;
  /** Per-meal generation lead (minutes before arrival) — overrides leadMinutes for that meal only. */
  leadOverrides?: { morning?: number; lunch?: number; night?: number };
  deliveryTimes: { morning: string; lunch: string; night: string };
  travel: { start: string; end: string; tz: string } | null;
  _notes?: string;
};

const SETTINGS_PATH = CONFIG_PATH;
const DEFAULTS: Settings = {
  timezone: "America/New_York",
  leadMinutes: 30,
  deliveryTimes: { morning: "07:00", lunch: "12:00", night: "18:00" },
  travel: null,
};

export async function loadSettings(): Promise<Settings> {
  const s =
    (await Bun.file(SETTINGS_PATH)
      .json()
      .catch(() => null)) ?? {};
  return { ...DEFAULTS, ...s, deliveryTimes: { ...DEFAULTS.deliveryTimes, ...s.deliveryTimes } };
}
export async function saveSettings(s: Settings) {
  await Bun.write(SETTINGS_PATH, JSON.stringify(s, null, 2));
}

/** Generation lead (minutes before arrival) for a meal — a per-meal override falls back to global. */
export function leadFor(s: Settings, meal: "morning" | "lunch" | "night"): number {
  return s.leadOverrides?.[meal] ?? s.leadMinutes;
}

/** YYYY-MM-DD in a tz (en-CA locale formats exactly that). */
export function todayIn(tz: string, d = new Date()): string {
  return d.toLocaleDateString("en-CA", { timeZone: tz });
}
/** Minutes since local midnight in a tz. */
export function minutesNowIn(tz: string, d = new Date()): number {
  const [h, m] = d
    .toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false })
    .split(":");
  return parseInt(h) * 60 + parseInt(m);
}
/** The tz that currently governs the maintainer's day (travel-aware; auto-expires by date). */
export function effectiveTz(s: Settings): string {
  if (s.travel) {
    const today = todayIn(s.timezone);
    if (today >= s.travel.start && today <= s.travel.end) return s.travel.tz;
  }
  return s.timezone;
}
export function travelExpired(s: Settings): boolean {
  return !!s.travel && todayIn(s.timezone) > s.travel.end;
}
/** Offset difference in minutes between a tz and the SYSTEM tz right now (tz − system). */
export function tzOffsetDiffMinutes(tz: string, d = new Date()): number {
  let diff = minutesNowIn(tz, d) - d.getHours() * 60 - d.getMinutes();
  if (diff > 720) diff -= 1440;
  if (diff < -720) diff += 1440;
  return diff;
}
export const hm = (mins: number) =>
  `${String(Math.floor((((mins % 1440) + 1440) % 1440) / 60)).padStart(2, "0")}:${String((((mins % 1440) + 1440) % 1440) % 60).padStart(2, "0")}`;
export const parseHM = (s: string): number => {
  const [h, m] = s.split(":");
  return parseInt(h) * 60 + parseInt(m ?? "0");
};

/** Friendly tz-name → IANA mapping for chat ("eastern", "pacific", "london", "CET"…). */
export function resolveTz(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  const MAP: Record<string, string> = {
    eastern: "America/New_York",
    et: "America/New_York",
    est: "America/New_York",
    edt: "America/New_York",
    central: "America/Chicago",
    ct: "America/Chicago",
    cst: "America/Chicago",
    cdt: "America/Chicago",
    mountain: "America/Denver",
    mt: "America/Denver",
    mst: "America/Denver",
    mdt: "America/Denver",
    pacific: "America/Los_Angeles",
    pt: "America/Los_Angeles",
    pst: "America/Los_Angeles",
    pdt: "America/Los_Angeles",
    uk: "Europe/London",
    london: "Europe/London",
    gmt: "Europe/London",
    bst: "Europe/London",
    cet: "Europe/Paris",
    cest: "Europe/Paris",
    paris: "Europe/Paris",
    madrid: "Europe/Madrid",
    berlin: "Europe/Berlin",
    utc: "UTC",
    tokyo: "Asia/Tokyo",
    japan: "Asia/Tokyo",
    india: "Asia/Kolkata",
    dubai: "Asia/Dubai",
  };
  if (MAP[t]) return MAP[t];
  if (/^[A-Za-z]+\/[A-Za-z_]+$/.test(raw.trim())) {
    try {
      new Date().toLocaleDateString("en-CA", { timeZone: raw.trim() });
      return raw.trim();
    } catch {}
  }
  return null;
}
