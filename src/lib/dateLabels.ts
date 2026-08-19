// Shared relative-date formatting (the maintainer, 2026-06-30) — one home for the two
// date voices the UI used to redefine per surface:
//   • longDateLabel — note LISTS (All notes / Recent / sidebar rows): a calendar
//     day name (Today / Yesterday / weekday / "Mon 5").
//   • relativeLabel — compact timestamps (Board cards / the editor's "updated"):
//     a terse "since" reading (just now / 5m / 3h / 2d / "Jun 5").

/** Whole LOCAL calendar days between ts's day and today (0 = today) — midnight
 * to midnight, so "yesterday 11pm" is 1 day ago even at 7am. */
export function daysSinceMidnight(ts: number, now = Date.now()): number {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const dayStart = new Date(ts);
  dayStart.setHours(0, 0, 0, 0);
  return Math.round((today.getTime() - dayStart.getTime()) / 86_400_000);
}

/** Today / Yesterday / weekday (this week) / "Mon 5" (older) — for note lists. */
export function longDateLabel(ts: number): string {
  const date = new Date(ts);
  const days = daysSinceMidnight(ts);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return date.toLocaleDateString(undefined, { weekday: "short" });
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** just now / 5m / 3h / 2d / "Jun 5" (>1 week) — for compact timestamps. */
export function relativeLabel(ts: number, now = Date.now()): string {
  const date = new Date(ts);
  const mins = Math.round((now - ts) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = daysSinceMidnight(ts, now);
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
