import { describe, expect, test } from "bun:test";

import {
  choiceGroupAlign,
  isControlLiteral,
  parseChoiceControlLine,
  parseChoicePromptLine,
  setChoicePromptAlign,
  parseToggleLine,
  selectChoiceControlGroup,
  setChoiceControlSelected,
  setToggleOn,
} from "./controlState";

test("control examples are identifiable without treating ordinary code as controls", () => {
  expect(["[#]", "[##]", "[##?]", "[|]", "[True][False]", "[:blue|:green]"].every(isControlLiteral)).toBe(
    true,
  );
  expect(isControlLiteral("const values = [1, 2]")).toBe(false);
});

describe("hash choice controls", () => {
  test("capital X selections parse and clear like lowercase selections", () => {
    for (const marker of ["#X", "##X"]) {
      expect(isControlLiteral(`[${marker}]`)).toBe(true);
      expect(parseChoiceControlLine(`- [${marker}] Selected`)?.selected).toBe(true);
      expect(setChoiceControlSelected(`- [${marker}] Selected`, false)).toBe(
        `- [${marker.slice(0, -1)}] Selected`,
      );
    }
  });
  test("reads an optional question row without treating it as an answer", () => {
    expect(parseChoicePromptLine("- [##?] Which channels should we use?")).toEqual({
      indent: 0,
      indentSource: "",
      marker: "- ",
      align: "left",
      prefixLen: 8,
      text: "Which channels should we use?",
    });
    expect(parseChoiceControlLine("- [##?] Which channels should we use?")).toBeNull();
  });

  test("a prompt marker carries the panel placement and rewrites it in source", () => {
    expect(parseChoicePromptLine("- [##?] Plain")?.align).toBe("left");
    expect(parseChoicePromptLine("- [##?:right] Edge")?.align).toBe("right");
    expect(parseChoicePromptLine("  1. [##?:center] Centered")).toMatchObject({
      indent: 2,
      marker: "1. ",
      align: "center",
      prefixLen: 18,
      text: "Centered",
    });
    expect(parseChoicePromptLine("- [##?:top] Unknown")).toBeNull();
    expect(setChoicePromptAlign("- [##?] Q", "right")).toBe("- [##?:right] Q");
    expect(setChoicePromptAlign("- [##?:right] Q", "left")).toBe("- [##?] Q");
    expect(setChoicePromptAlign("- [##] Q", "left")).toBeNull();
    expect(["[##?:left]", "[##?:center]", "[##?:right]"].every(isControlLiteral)).toBe(true);
    expect(isControlLiteral("[##?:top]")).toBe(false);
  });

  test("answer rows inherit placement from the prompt of their own group", () => {
    const lines = [
      "- [##?:center] Q",
      "- [##] A",
      "- [##x] B",
      "  - [##] Nested keeps the default",
      "",
      "- [##] Promptless",
      "- [#] Radio",
    ];
    const at = (index: number) => lines[index];
    expect(choiceGroupAlign(at, 1)).toBe("center");
    expect(choiceGroupAlign(at, 2)).toBe("center");
    expect(choiceGroupAlign(at, 3)).toBe("left");
    expect(choiceGroupAlign(at, 5)).toBe("left");
    expect(choiceGroupAlign(at, 6)).toBe("left");
    expect(choiceGroupAlign(at, 0)).toBe("left");
  });

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
    expect(parseToggleLine("- [|] Enabled")).toMatchObject({
      compact: true,
      on: false,
      text: "Enabled",
    });
    expect(parseToggleLine("- [x|] Enabled")).toMatchObject({
      compact: true,
      on: true,
    });
    expect(parseToggleLine("- [True|False] Feature")).toMatchObject({
      compact: false,
      on: false,
      labels: ["True", "False"],
    });
    expect(parseToggleLine("- [:blue|:green] Feature")).toMatchObject({
      compact: false,
      on: false,
      labels: ["On", "Off"],
      options: [
        { color: "blue", source: ":blue" },
        { color: "green", source: ":green" },
      ],
    });
    expect(parseToggleLine("- [:blue|:purple] Feature")).toMatchObject({
      labels: ["On", "Off"],
      options: [{ color: "blue" }, { color: "purple" }],
    });
  });

  test("writes an unambiguous active side while preserving labels and colors", () => {
    expect(setToggleOn("- [True:green|False:red] Feature", true)).toBe("- [x True:green|False:red] Feature");
    expect(setToggleOn("- [x True:green|False:red] Feature", false)).toBe(
      "- [True:green|x False:red] Feature",
    );
    expect(setToggleOn("- [|] Feature", true)).toBe("- [x|] Feature");
    expect(setToggleOn("- [:blue|:green] Feature", true)).toBe("- [x :blue|:green] Feature");
  });

  test("fails closed for two active sides or malformed color", () => {
    expect(parseToggleLine("- [x True|x False] Feature")).toBeNull();
    expect(parseToggleLine("- [True:#12|False:red] Feature")).toBeNull();
  });
});
