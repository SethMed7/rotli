#!/usr/bin/env bun
/**
 * Deterministic tests for the time-context helpers (scripts/timectx.ts).
 * Pins a FIXED instant and feeds it into every tz-aware helper, so "today"/"now"
 * never drift with the wall clock. Run: bun scripts/test-timectx.ts
 */
import type { Settings } from "../scripts/timectx";
import { todayIn, minutesNowIn, effectiveTz, travelExpired, hm, parseHM, resolveTz } from "../scripts/timectx";

// 2026-01-15 18:30 UTC = 13:30 EST (same day, NY) = 03:30 next day (Tokyo, date rollover).
const FIXED = new Date("2026-01-15T18:30:00Z");

let fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = got === want;
  if (!ok) fail++;
  console.log(`${ok ? "✓" : "✗"} ${label}${ok ? "" : ` → ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`}`);
};

// ── todayIn — tz-correct date, including the rollover that broke the brief ─────
eq(`todayIn(New_York)`, todayIn("America/New_York", FIXED), "2026-01-15");
eq(`todayIn(Tokyo) rolls to next day`, todayIn("Asia/Tokyo", FIXED), "2026-01-16");

// ── minutesNowIn — minutes since local midnight ──────────────────────────────
eq(`minutesNowIn(New_York)`, minutesNowIn("America/New_York", FIXED), 13 * 60 + 30);
eq(`minutesNowIn(Tokyo)`, minutesNowIn("Asia/Tokyo", FIXED), 3 * 60 + 30);

// ── parseHM / hm — string ↔ minutes, with wrap ───────────────────────────────
eq(`parseHM("07:30")`, parseHM("07:30"), 450);
eq(`parseHM("00:00")`, parseHM("00:00"), 0);
eq(`parseHM("23:59")`, parseHM("23:59"), 1439);
eq(`hm(450)`, hm(450), "07:30");
eq(`hm(0)`, hm(0), "00:00");
eq(`hm round-trips parseHM`, hm(parseHM("18:05")), "18:05");
eq(`hm wraps negative`, hm(-30), "23:30");
eq(`hm wraps over 1440`, hm(1440 + 90), "01:30");

// ── effectiveTz / travelExpired — travel-aware, date-bounded ──────────────────
const base: Settings = {
  timezone: "America/New_York",
  leadMinutes: 30,
  deliveryTimes: { morning: "07:00", lunch: "12:00", night: "18:00" },
  travel: null,
};
// Note: effectiveTz/travelExpired compare against todayIn(home) with the live clock,
// so build windows relative to "today" rather than a pinned date.
const homeToday = todayIn(base.timezone);
const shift = (days: number) => {
  const d = new Date(`${homeToday}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return todayIn("UTC", d);
};

eq(`effectiveTz(no travel) → home`, effectiveTz(base), "America/New_York");
const active: Settings = { ...base, travel: { start: shift(-1), end: shift(1), tz: "Europe/Paris" } };
eq(`effectiveTz(active window) → travel tz`, effectiveTz(active), "Europe/Paris");
const expired: Settings = { ...base, travel: { start: shift(-3), end: shift(-1), tz: "Europe/Paris" } };
eq(`effectiveTz(expired) → home`, effectiveTz(expired), "America/New_York");

eq(`travelExpired(no travel)`, travelExpired(base), false);
eq(`travelExpired(active window)`, travelExpired(active), false);
eq(`travelExpired(past window)`, travelExpired(expired), true);

// ── resolveTz — friendly name → IANA, with reject ────────────────────────────
eq(`resolveTz("eastern")`, resolveTz("eastern"), "America/New_York");
eq(`resolveTz("CET")`, resolveTz("CET"), "Europe/Paris");
eq(`resolveTz("Europe/London")`, resolveTz("Europe/London"), "Europe/London");
eq(`resolveTz("nonsense")`, resolveTz("nonsense"), null);

console.log(fail ? `${fail} FAILURES` : "all timectx checks pass");
process.exit(fail ? 1 : 0);
