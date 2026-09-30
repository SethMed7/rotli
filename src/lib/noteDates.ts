// Dates in notes (the owner, 2026-09-29: "slash commands that do a date like
// yesterday, today, tomorrow … and with templates I can put /today as part of
// the template; it will render the day, not the day I created the template").
// Pure: `now` is always passed in by the caller that owns the clock.

export const DATE_WORDS = ["today", "yesterday", "tomorrow"] as const;
export type DateWord = (typeof DATE_WORDS)[number];

const OFFSET: Record<DateWord, number> = { yesterday: -1, today: 0, tomorrow: 1 };

/** The calendar day `word` names, counted from `now` in local time. */
export function dateFor(word: DateWord, now: Date): Date {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  day.setDate(day.getDate() + OFFSET[word]);
  return day;
}

/** How a date reads in a note: "September 29, 2026". */
export function noteDateText(day: Date): string {
  return day.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/** What a template keeps instead of a date, so the date is the day it's used. */
export function dateToken(word: DateWord): string {
  return `{{${word}}}`;
}

/** A template's date placeholders as the dates of the day it's used:
 * `{{today}}` (or `{{date}}`), `{{yesterday}}`, `{{tomorrow}}`, any case. */
export function expandDateTokens(text: string, now: Date): string {
  return text.replace(/\{\{\s*(today|date|yesterday|tomorrow)\s*\}\}/gi, (_, raw: string) => {
    const word = raw.toLowerCase() === "date" ? "today" : (raw.toLowerCase() as DateWord);
    return noteDateText(dateFor(word, now));
  });
}
