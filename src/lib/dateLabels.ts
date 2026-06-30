// Shared relative-date formatting (Seth, 2026-06-30) — one home for the two
// date voices the UI used to redefine per surface:
//   • longDateLabel — note LISTS (All notes / Recent / sidebar rows): a calendar
//     day name (Today / Yesterday / weekday / "Mon 5").
//   • relativeLabel — compact timestamps (Board cards / the editor's "updated"):
//     a terse "since" reading (just now / 5m / 3h / 2d / "Jun 5").

/** Today / Yesterday / weekday (this week) / "Mon 5" (older) — for note lists. */
export function longDateLabel(ts: number): string {
  const date = new Date(ts);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayStart = new Date(ts);
  dayStart.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - dayStart.getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return date.toLocaleDateString(undefined, { weekday: "short" });
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** just now / 5m / 3h / 2d / "Jun 5" (>1 week) — for compact timestamps. */
export function relativeLabel(ts: number): string {
  const date = new Date(ts);
  const mins = Math.round((Date.now() - ts) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayStart = new Date(ts);
  dayStart.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - dayStart.getTime()) / 86_400_000);
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
