import { describe, expect, test } from "bun:test";

import { CHART_TYPES, chartStarter, parseChart, serializeChart } from "./chartSpec";

const BAR = `type: bar
title: Hours this week
unit: h

Day, Writing, Reading
Mon, 4, 1
Tue, 6, 2
Wed, 3, 2`;

describe("parseChart — the SYNTAX.md chart fence", () => {
  test("options, a blank line, then a header and rows", () => {
    const parsed = parseChart(BAR);
    expect(parsed).toEqual({
      ok: true,
      spec: {
        type: "bar",
        title: "Hours this week",
        unit: "h",
        columns: ["Day", "Writing", "Reading"],
        rows: [
          { label: "Mon", values: [4, 1] },
          { label: "Tue", values: [6, 2] },
          { label: "Wed", values: [3, 2] },
        ],
      },
    });
  });

  test("quoted fields, negatives, decimals, and empty fields as missing values", () => {
    const parsed = parseChart(`type: line\n\nWho, Score\n"Smith, J.", -2.5\nLee, \nKim`);
    expect(parsed.ok && parsed.spec.rows).toEqual([
      { label: "Smith, J.", values: [-2.5] },
      { label: "Lee", values: [null] },
      { label: "Kim", values: [null] },
    ]);
  });

  test("blank lines inside the data and around it are ignored", () => {
    const parsed = parseChart(`type: area\n\n\nX, Y\n\na, 1\n\n`);
    expect(parsed.ok && parsed.spec.rows).toEqual([{ label: "a", values: [1] }]);
  });

  const refusals: [string, string, RegExp][] = [
    ["no type", "title: T\n\nX, Y\na, 1", /needs a type/],
    ["an unknown type", "type: radar\n\nX, Y\na, 1", /“radar” isn’t a chart type/],
    ["an unknown option", "type: bar\ncolor: red\n\nX, Y\na, 1", /“color” isn’t a chart option/],
    ["an uppercase option", "Type: bar\n\nX, Y\na, 1", /“Type” isn’t a chart option/],
    ["an option twice", "type: bar\ntype: line\n\nX, Y\na, 1", /“type” is given twice/],
    ["no blank line before the data", "type: bar\nX, Y\na, 1", /blank line/],
    ["no data rows", "type: bar\n\nX, Y", /no data rows/],
    ["no series in the header", "type: bar\n\nX\na", /at least one series/],
    ["an empty series name", "type: bar\n\nX, , Z\na, 1, 2", /column 2 has no name/],
    ["a row with too many fields", "type: bar\n\nX, Y\na, 1, 2", /Row 1 has 3 fields/],
    ["an unquoted thousands separator", "type: bar\n\nX, Y\na, 1,200", /Row 1 has 3 fields/],
    ["a word for a number", "type: bar\n\nX, Y\na, lots", /“lots” in row 1 isn’t a number/],
    ["a thousands separator", 'type: bar\n\nX, Y\na, "1,200"', /“1,200” in row 1 isn’t a number/],
    ["a negative pie slice", "type: pie\n\nX, Y\na, -1\nb, 2", /pie can’t have negative/],
    ["an empty pie", "type: pie\n\nX, Y\na, 0\nb,", /pie needs a value above zero/],
    ["an unclosed quote", 'type: bar\n\nX, Y\n"a, 1', /unclosed quote/],
  ];
  for (const [name, body, reason] of refusals) {
    test(`fails closed on ${name}`, () => {
      const parsed = parseChart(body);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.reason).toMatch(reason);
    });
  }

  test("fails closed past the limits", () => {
    const wide = `type: bar\n\nX, ${Array.from({ length: 9 }, (_, i) => `S${i}`).join(", ")}\na`;
    expect(parseChart(wide)).toMatchObject({ ok: false, reason: expect.stringMatching(/8 series/) });
    const long = `type: bar\n\nX, Y\n${Array.from({ length: 201 }, (_, i) => `r${i}, ${i}`).join("\n")}`;
    expect(parseChart(long)).toMatchObject({ ok: false, reason: expect.stringMatching(/200 rows/) });
  });
});

describe("serializeChart — what Apply writes", () => {
  test("round-trips the canonical form exactly", () => {
    const parsed = parseChart(BAR);
    expect(parsed.ok && serializeChart(parsed.spec)).toBe(BAR);
  });

  test("quotes a field that needs it, leaves a missing value empty, omits empty options", () => {
    expect(
      serializeChart({
        type: "line",
        title: "",
        columns: ["Who", "Score"],
        rows: [
          { label: "Smith, J.", values: [2] },
          { label: 'Say "hi"', values: [null] },
        ],
      }),
    ).toBe(`type: line\n\nWho, Score\n"Smith, J.", 2\n"Say ""hi""", `);
  });

  test("a hand-written chart reads the same after a rewrite", () => {
    const hand = "type:   pie\n\nFruit,Count\napple,3\n pear , 4.50";
    const first = parseChart(hand);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const again = parseChart(serializeChart(first.spec));
    expect(again).toEqual(first);
  });
});

describe("chartStarter — what the slash commands insert", () => {
  test("every type's starter is a valid chart of that type", () => {
    for (const type of CHART_TYPES) {
      const parsed = parseChart(chartStarter(type));
      expect(parsed.ok && parsed.spec.type).toBe(type);
    }
  });
});
