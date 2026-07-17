import { describe, expect, test } from "bun:test";
import {
  dailyDue,
  dailySlot,
  intervalDue,
  parseHm,
  schedulerParentGone,
} from "../../breve-runtime/scripts/scheduler-core";

describe("Rotli Breve scheduler", () => {
  test("parses only real HH:MM values", () => {
    expect(parseHm("07:30")).toBe(450);
    expect(parseHm("24:00")).toBeNull();
    expect(parseHm("7:30")).toBeNull();
  });

  test("daily jobs run once inside the catch-up window", () => {
    expect(dailyDue(390, 360, "2026-07-10", undefined)).toBe(true);
    expect(dailyDue(390, 360, "2026-07-10", "2026-07-10")).toBe(false);
    expect(dailyDue(800, 360, "2026-07-10", undefined)).toBe(false);
    expect(dailyDue(350, 360, "2026-07-10", undefined)).toBe(false);
  });

  test("a lead crossing midnight belongs to the delivery day", () => {
    const delivery = parseHm("00:30")!;
    const fire = (delivery - 90 + 1440) % 1440;
    expect(dailySlot("2026-07-09", 23 * 60 + 15, delivery, fire)).toBe("2026-07-10");
    expect(dailySlot("2026-07-10", 15, delivery, fire)).toBe("2026-07-10");
    expect(dailyDue(15, fire, "2026-07-10", "2026-07-10")).toBe(false);
  });

  test("interval jobs establish a baseline and never double-fire early", () => {
    const now = Date.parse("2026-07-10T12:00:00Z");
    expect(intervalDue(now, 1800, undefined)).toBe(false);
    expect(intervalDue(now, 1800, "2026-07-10T11:29:59Z")).toBe(true);
    expect(intervalDue(now, 1800, "2026-07-10T11:45:00Z")).toBe(false);
  });

  test("a managed scheduler exits when its Rotli parent disappears", () => {
    expect(schedulerParentGone(42, 42, () => true)).toBe(false);
    expect(schedulerParentGone(42, 1, () => false)).toBe(true);
    expect(schedulerParentGone(42, 42, () => false)).toBe(true);
    expect(schedulerParentGone(0, 1, () => false)).toBe(false);
  });
});
