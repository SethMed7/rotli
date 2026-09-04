import { describe, expect, test } from "bun:test";

import type { ResultOption } from "./resultState";

// CodeMirror performs one browser feature check at module load. The production
// app has a real document; this focused identity test supplies only that seam.
(document as unknown as { documentElement: { style: Record<string, never> } }).documentElement = {
  style: {},
};
const { ResultWidget } = await import("./resultWidget");

const OPTIONS: ResultOption[] = [
  { label: "True", selected: true, color: "green", source: "True:green" },
  { label: "False", selected: false, color: "red", source: "False:red" },
];

describe("result widget identity", () => {
  test("tracks labels, colors, selection, shape, and ordered markers", () => {
    expect(new ResultWidget(OPTIONS, false).eq(new ResultWidget(OPTIONS, false))).toBe(true);
    expect(
      new ResultWidget(OPTIONS, false).eq(
        new ResultWidget([{ ...OPTIONS[0]!, selected: false }, OPTIONS[1]!], false),
      ),
    ).toBe(false);
    expect(new ResultWidget(OPTIONS, false).eq(new ResultWidget(OPTIONS, true))).toBe(false);
    expect(new ResultWidget(OPTIONS, false, "2.").eq(new ResultWidget(OPTIONS, false, "3."))).toBe(false);
  });
});
