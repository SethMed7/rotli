import { describe, expect, test } from "bun:test";

import {
  parseChoiceControlLine,
  parseToggleLine,
  selectChoiceControlGroup,
  setChoiceControlSelected,
  setToggleOn,
} from "./controlState";

describe("hash choice controls", () => {
  test("reads exclusive circles and independent square choices", () => {
    expect(parseChoiceControlLine("- [#] Alpha")).toMatchObject({
      kind: "radio",
      selected: false,
      text: "Alpha",
    });
    expect(parseChoiceControlLine("2. [#x] Beta")).toMatchObject({
      kind: "radio",
      selected: true,
      marker: "2. ",
    });
    expect(parseChoiceControlLine("  - [##x] Gamma")).toMatchObject({
      kind: "multi",
      selected: true,
      indent: 2,
    });
  });

  test("rewrites only the marker and radio selection clears adjacent siblings", () => {
    expect(setChoiceControlSelected("- [##] Keep this", true)).toBe("- [##x] Keep this");
    expect(selectChoiceControlGroup(["- [#x] Red", "- [#] Blue", "", "- [#x] Green"], 1)).toEqual([
      { index: 0, line: "- [#] Red" },
      { index: 1, line: "- [#x] Blue" },
    ]);
  });
});

describe("portable toggle controls", () => {
  test("reads compact and labeled toggles with off as the explicit default", () => {
    expect(parseToggleLine("- [|] Enabled")).toMatchObject({ compact: true, on: false, text: "Enabled" });
    expect(parseToggleLine("- [x|] Enabled")).toMatchObject({ compact: true, on: true });
    expect(parseToggleLine("- [True|False] Feature")).toMatchObject({
      compact: false,
      on: false,
      labels: ["True", "False"],
    });
  });

  test("writes an unambiguous active side while preserving labels and colors", () => {
    expect(setToggleOn("- [True:green|False:red] Feature", true)).toBe("- [x True:green|False:red] Feature");
    expect(setToggleOn("- [x True:green|False:red] Feature", false)).toBe(
      "- [True:green|x False:red] Feature",
    );
    expect(setToggleOn("- [|] Feature", true)).toBe("- [x|] Feature");
  });

  test("fails closed for two active sides or malformed color", () => {
    expect(parseToggleLine("- [x True|x False] Feature")).toBeNull();
    expect(parseToggleLine("- [True:#12|False:red] Feature")).toBeNull();
  });
});
