import { describe, expect, test } from "bun:test";

import { specFromDraft } from "./chartForm";
import { chartData } from "./chartRender";

const draft = {
  type: "bar" as const,
  title: " Steps ",
  unit: "",
  columns: ["Month", " Walked "],
  rows: [
    { label: " Jan ", values: [" 4 "] },
    { label: "Feb", values: [""] },
  ],
};

describe("specFromDraft — the form writes only what the fence reads", () => {
  test("trims fields and turns an empty value into a missing one", () => {
    expect(specFromDraft(draft)).toEqual({
      ok: true,
      spec: {
        type: "bar",
        title: "Steps",
        columns: ["Month", "Walked"],
        rows: [
          { label: "Jan", values: [4] },
          { label: "Feb", values: [null] },
        ],
      },
    });
  });

  test("refuses a word for a number with the fence's own wording", () => {
    expect(specFromDraft({ ...draft, rows: [{ label: "Jan", values: ["lots"] }] })).toEqual({
      ok: false,
      reason: "“lots” in row 1 isn’t a number.",
    });
  });

  test("refuses what the fence refuses — a pie with a negative slice", () => {
    const pie = { ...draft, type: "pie" as const, rows: [{ label: "a", values: ["-1"] }] };
    expect(specFromDraft(pie)).toMatchObject({ ok: false, reason: "A pie can’t have negative values." });
  });
});

describe("chartData — the long form the renderer draws", () => {
  test("one datum per label and series, a blank label numbered, a repeat counted", () => {
    const data = chartData({
      type: "bar",
      columns: ["Fruit", "Kept", "Sold"],
      rows: [
        { label: "Fig", values: [1, null] },
        { label: "", values: [2, 3] },
        { label: "Fig", values: [4, 5] },
      ],
    });
    expect(data.map(({ id: _id, ...datum }) => datum)).toEqual([
      { label: "Fig", series: "Kept", value: 1 },
      { label: "Fig", series: "Sold", value: null },
      { label: "#2", series: "Kept", value: 2 },
      { label: "#2", series: "Sold", value: 3 },
      { label: "Fig (2)", series: "Kept", value: 4 },
      { label: "Fig (2)", series: "Sold", value: 5 },
    ]);
    // every datum keeps its own key, so no two bars share one
    expect(new Set(data.map((datum) => datum.id)).size).toBe(data.length);
  });
});
