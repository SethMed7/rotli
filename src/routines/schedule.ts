// Pure schedule math for the routines scheduler (breve-merge.md §4). `nextRun`
// computes the next epoch-ms a routine should fire, given the current epoch-ms
// as a PARAMETER — no `Date.now()` here, so the core is deterministic and unit-
// testable. Timezone-aware for the daily briefs (Breve honored a home tz).

import type { Schedule } from "./types";

const MINUTE_MS = 60_000;
const DAY_MINUTES = 1440;

/** The runtime's own timezone, used when a caller doesn't pass one. */
function localTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** "HH:MM" → minutes since local midnight, or null if malformed. */
export function parseHhmm(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** The wall-clock parts of `epochMs` as observed in `tz`. */
function partsInTz(tz: string, epochMs: number): { y: number; mo: number; d: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, number> = {};
  for (const p of dtf.formatToParts(new Date(epochMs))) {
    if (p.type !== "literal") map[p.type] = Number(p.value);
  }
  return { y: map.year ?? 1970, mo: map.month ?? 1, d: map.day ?? 1 };
}

/** tz offset (wall-clock − UTC) in ms at `epochMs` — pure over its argument. */
function tzOffsetMs(tz: string, epochMs: number): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, number> = {};
  for (const p of dtf.formatToParts(new Date(epochMs))) {
    if (p.type !== "literal") map[p.type] = Number(p.value);
  }
  const asUtc = Date.UTC(
    map.year ?? 1970,
    (map.month ?? 1) - 1,
    map.day ?? 1,
    map.hour ?? 0,
    map.minute ?? 0,
    map.second ?? 0,
  );
  return asUtc - epochMs;
}

/**
 * Epoch-ms at which the given wall-clock (y/mo/d at `minutesOfDay`) occurs in
 * `tz`. We guess with the offset at the naive UTC instant, then refine once so
 * DST transitions land correctly for all but the rare fold.
 */
function wallClockToEpoch(tz: string, y: number, mo: number, d: number, minutesOfDay: number): number {
  const h = Math.floor(minutesOfDay / 60);
  const min = minutesOfDay % 60;
  const naiveUtc = Date.UTC(y, mo - 1, d, h, min, 0);
  const guess = naiveUtc - tzOffsetMs(tz, naiveUtc);
  return naiveUtc - tzOffsetMs(tz, guess);
}

/**
 * The next moment (epoch-ms) a schedule fires, strictly after `nowMs`.
 *
 * - `everySecs` → `nowMs + secs*1000`.
 * - `dailyAt` → the next occurrence of (delivery time − leadMinutes) in `tz`.
 *   The lead may push the fire before midnight of the delivery day (midnight
 *   rollover), so candidate delivery days from yesterday through +2 are checked
 *   and the earliest fire still in the future wins.
 *
 * `tz` defaults to the runtime's timezone. A malformed `dailyAt.hhmm` throws.
 */
export function nextRun(schedule: Schedule, nowMs: number, tz?: string): number {
  if (schedule.kind === "everySecs") {
    return nowMs + Math.max(0, schedule.secs) * 1000;
  }
  const zone = tz ?? localTz();
  const delivMin = parseHhmm(schedule.hhmm);
  if (delivMin === null) {
    throw new Error(`nextRun: bad dailyAt time "${schedule.hhmm}"`);
  }
  const lead = schedule.leadMinutes * MINUTE_MS;
  const today = partsInTz(zone, nowMs);
  const anchor = Date.UTC(today.y, today.mo - 1, today.d);

  let best = Infinity;
  for (let dayOffset = -1; dayOffset <= 2; dayOffset++) {
    const day = new Date(anchor + dayOffset * DAY_MINUTES * MINUTE_MS);
    const deliveryEpoch = wallClockToEpoch(
      zone,
      day.getUTCFullYear(),
      day.getUTCMonth() + 1,
      day.getUTCDate(),
      delivMin,
    );
    const fire = deliveryEpoch - lead;
    if (fire > nowMs && fire < best) best = fire;
  }
  return best;
}
