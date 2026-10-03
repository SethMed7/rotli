// The vault's note dates. `created`/`updated` are date-only YYYY-MM-DD by
// contract (docs/architecture/memex-data-contract.md, "Metadata ownership"),
// stamped with the writer's own calendar day. Pure: contract.ts re-exports both.

// The composition helpers take an explicit `date` so they stay pure/testable;
// the service passes today().
export const today = (now: Date = new Date(), tz?: string): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now);

const HOUR = 3_600_000;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A frontmatter `created`/`updated` stamp as epoch ms, or null when it is not
 * a date. A full timestamp is taken as written. A date-only stamp names a day,
 * not an hour, so it never becomes an age in hours on its own: the file's own
 * time stands in when it falls on the stamped day somewhere on Earth (UTC−12
 * to UTC+14), so a note saved a minute ago reads "just now"; otherwise (a copy
 * or clone reset the file time) the stamp is local midnight of that day. */
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
  if (fileMs !== undefined && fileMs >= utcMidnight - 14 * HOUR && fileMs < utcMidnight + 36 * HOUR)
    return fileMs;
  return new Date(y, m, d).getTime();
}
