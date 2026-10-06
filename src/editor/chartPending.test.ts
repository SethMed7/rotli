import { expect, test } from "bun:test";

import { requestChartEdit, takeChartEdit } from "./chartPending";
import { chartStarter } from "./chartSpec";

test("a starter's block opens its form once, soon after it was inserted", () => {
  const body = chartStarter("bar");
  requestChartEdit(body, 1_000);
  expect(takeChartEdit(`  ${body.replace(/\n/g, "\n  ")}`, 2_000)).toBe(true); // a list indent can't hide it
  expect(takeChartEdit(body, 2_000)).toBe(false); // once
});

test("a request nobody took expires, so a later identical chart opens no form", () => {
  const body = chartStarter("pie");
  requestChartEdit(body, 1_000);
  expect(takeChartEdit(body, 1_000 + 60_000)).toBe(false);
});
