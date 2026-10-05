// The vault's note dates. `created`/`updated` are date-only YYYY-MM-DD by
// contract (docs/architecture/memex-data-contract.md, "Metadata ownership"),
// stamped by Rotli Web with the writer's own calendar day (the Mac app still
// stamps UTC; see stampToMs). Pure: contract.ts re-exports both.

// The composition helpers take an explicit `date` so they stay pure/testable;
// the service passes today().
export const today = (now: Date = new Date(), tz?: string): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now);

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A frontmatter `created`/`updated` stamp as epoch ms, or null when it is not
 * a date. A full timestamp is taken as written. A date-only stamp names a day,
 * not an hour, so it never becomes an age in hours on its own: the file's own
 * time stands in when it falls on the stamped day, so a note saved a minute
 * ago reads "just now"; otherwise (a copy or clone reset the file time) the
 * stamp is local midnight of that day.
 *
 * "On the stamped day" means the reader's local day — Rotli Web stamps the
 * writer's day and reader and writer are normally the same browser — widened
 * to the UTC day, because the Mac app still stamps UTC (`today_stamp`,
 * corpus.rs). The tradeoff: a move/rename/copy refreshes the file time without
 * touching `updated`, so east of UTC a note stamped yesterday whose file was
 * touched before UTC midnight can still read "just now" (at most the zone's
 * offset, e.g. 9h in Tokyo); west of UTC the local day already covers the UTC
 * day and yesterday's note never does. Drop the UTC half once native stamps
 * the local day. */
export function stampToMs(stamp: string | null | undefined, fileMs?: number): number | null {
  const value = stamp?.trim();
  if (!value) return null;
  const day = DATE_ONLY.exec(value);
  if (!day) {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? null : ms;
  }
  const [y, m, d] = [Number(day[1]), Number(day[2]) - 1, Number(day[3])];
  const utcMidnight = Date.UTC(y, m, d);
  const check = new Date(utcMidnight);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m || check.getUTCDate() !== d) return null;
  const localMidnight = new Date(y, m, d).getTime();
  if (fileMs === undefined) return localMidnight;
  const start = Math.min(localMidnight, utcMidnight);
  const end = Math.max(new Date(y, m, d + 1).getTime(), Date.UTC(y, m, d + 1));
  return fileMs >= start && fileMs < end ? fileMs : localMidnight;
}
