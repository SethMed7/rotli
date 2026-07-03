import { describe, expect, test } from "bun:test";
import { nextRun, parseHhmm } from "./schedule";
import type { Schedule } from "./types";

// A fixed timezone with no DST so wall-clock math is exact in the assertions.
const TZ = "America/Panama"; // UTC-5 year-round

/** Build an epoch-ms for a wall-clock instant in the UTC-5 test zone. */
function at(y: number, mo: number, d: number, h: number, min: number): number {
  return Date.UTC(y, mo - 1, d, h + 5, min, 0);
}

describe("parseHhmm", () => {
  test("parses HH:MM to minutes", () => {
    expect(parseHhmm("07:00")).toBe(420);
    expect(parseHhmm("00:00")).toBe(0);
    expect(parseHhmm("23:59")).toBe(1439);
  });
  test("rejects malformed input", () => {
    expect(parseHhmm("7am")).toBeNull();
    expect(parseHhmm("24:00")).toBeNull();
    expect(parseHhmm("07:60")).toBeNull();
    expect(parseHhmm("")).toBeNull();
  });
});

describe("nextRun · everySecs", () => {
  test("fires now + secs", () => {
    const s: Schedule = { kind: "everySecs", secs: 1800 };
    expect(nextRun(s, 1_000_000)).toBe(1_000_000 + 1_800_000);
  });
  test("a zero/negative cadence clamps to now", () => {
    expect(nextRun({ kind: "everySecs", secs: 0 }, 5_000)).toBe(5_000);
    expect(nextRun({ kind: "everySecs", secs: -10 }, 5_000)).toBe(5_000);
  });
});

describe("nextRun · dailyAt", () => {
  // Breve's morning brief: delivers 07:00, generates 60 min earlier → fire 06:00.
  const morning: Schedule = { kind: "dailyAt", hhmm: "07:00", leadMinutes: 60 };

  test("honors the lead offset (fires 06:00 for a 07:00 delivery)", () => {
    const now = at(2026, 7, 3, 5, 0); // 05:00 local, before the 06:00 fire
    expect(nextRun(morning, now, TZ)).toBe(at(2026, 7, 3, 6, 0));
  });

  test("after today's fire, rolls to tomorrow's fire", () => {
    const now = at(2026, 7, 3, 6, 30); // just past 06:00
    expect(nextRun(morning, now, TZ)).toBe(at(2026, 7, 4, 6, 0));
  });

  test("exactly at the fire instant picks the NEXT day (strictly future)", () => {
    const now = at(2026, 7, 3, 6, 0);
    expect(nextRun(morning, now, TZ)).toBe(at(2026, 7, 4, 6, 0));
  });

  test("no lead: fires at the delivery time itself", () => {
    const lunch: Schedule = { kind: "dailyAt", hhmm: "12:00", leadMinutes: 0 };
    const now = at(2026, 7, 3, 11, 59);
    expect(nextRun(lunch, now, TZ)).toBe(at(2026, 7, 3, 12, 0));
  });

  test("midnight rollover: a lead crossing midnight fires the previous evening", () => {
    // deliver 00:30, lead 60 → fire 23:30 the day BEFORE the delivery date.
    const s: Schedule = { kind: "dailyAt", hhmm: "00:30", leadMinutes: 60 };
    const now = at(2026, 7, 3, 20, 0); // 20:00 on the 3rd
    // next delivery is 00:30 on the 4th → fire 23:30 on the 3rd
    expect(nextRun(s, now, TZ)).toBe(at(2026, 7, 3, 23, 30));
  });

  test("just after a midnight-rollover fire rolls to the next evening", () => {
    const s: Schedule = { kind: "dailyAt", hhmm: "00:30", leadMinutes: 60 };
    const now = at(2026, 7, 3, 23, 45); // past 23:30 fire for the 4th's delivery
    expect(nextRun(s, now, TZ)).toBe(at(2026, 7, 4, 23, 30));
  });

  test("throws on a malformed time", () => {
    expect(() => nextRun({ kind: "dailyAt", hhmm: "nope", leadMinutes: 0 }, 0, TZ)).toThrow();
  });
});
