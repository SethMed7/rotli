import { expect, test } from "bun:test";

import { dateFor, dateToken, expandDateTokens, noteDateText } from "./noteDates";

const NOW = new Date(2026, 8, 29, 15, 50); // Tuesday, September 29, 2026, 3:50 pm

test("yesterday, today, and tomorrow are calendar days counted from now", () => {
  expect(noteDateText(dateFor("today", NOW))).toBe("September 29, 2026");
  expect(noteDateText(dateFor("yesterday", NOW))).toBe("September 28, 2026");
  expect(noteDateText(dateFor("tomorrow", NOW))).toBe("September 30, 2026");
  // across a month and a year
  expect(noteDateText(dateFor("tomorrow", new Date(2026, 11, 31, 23, 59)))).toBe("January 1, 2027");
  expect(noteDateText(dateFor("yesterday", new Date(2026, 2, 1, 0, 5)))).toBe("February 28, 2026");
});

test("a template keeps a placeholder, and using it fills in the day it's used", () => {
  expect(dateToken("today")).toBe("{{today}}");
  const template = "# Daily for {{today}}\n\nFrom {{ Yesterday }} to {{tomorrow}}; also {{date}}.";
  expect(expandDateTokens(template, NOW)).toBe(
    "# Daily for September 29, 2026\n\nFrom September 28, 2026 to September 30, 2026; also September 29, 2026.",
  );
  expect(expandDateTokens("{{weekday}} and {{today", NOW)).toBe("{{weekday}} and {{today");
});
