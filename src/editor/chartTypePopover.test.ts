import { expect, test } from "bun:test";

import { CHART_KINDS, parseChart } from "./chartSpec";
import { chartFenceFor, kindForDigit } from "./chartTypePopover";

test("the digit beside a kind picks it: 1–9, then 0 for the tenth", () => {
  expect(kindForDigit("1")).toBe("bar");
  expect(kindForDigit("9")).toBe("radar");
  expect(kindForDigit("0")).toBe("heatmap");
  expect(kindForDigit("a")).toBeNull();
});

test("every kind the picker offers inserts a fence the note can draw", () => {
  expect(CHART_KINDS).toHaveLength(10);
  for (const { type } of CHART_KINDS) {
    const fence = chartFenceFor(type);
    const body = /```chart\n([\s\S]*?)\n```\n$/.exec(fence)?.[1] ?? "";
    expect(parseChart(body)).toMatchObject({ ok: true, spec: { type } });
  }
});
