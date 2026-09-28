import { describe, expect, test } from "bun:test";

import { HIDEABLE, hideDescription, parseHidden } from "./hideable";

describe("what can be hidden", () => {
  test("read tolerantly: only known names set to true count", () => {
    for (const value of [undefined, null, "all", [], 3]) expect(parseHidden(value)).toEqual({});
    expect(
      parseHidden({ overview: true, browserButton: true, tasks: false, settings: true, search: "yes" }),
    ).toEqual({
      overview: true,
      browserButton: true,
    });
  });

  test("every item says how to reach it without the button, and names are unique", () => {
    expect(new Set(HIDEABLE.map((item) => item.id)).size).toBe(HIDEABLE.length);
    for (const item of HIDEABLE) expect(item.desc.length).toBeGreaterThan(10);
    // shortcuts only where Rotli shows them (Rotli Web names no app chord)
    const newButton = HIDEABLE[0];
    expect(hideDescription(newButton, true)).toBe("The + that opens the New chooser. Still ⌘N.");
    expect(hideDescription(newButton, false)).toBe("The + that opens the New chooser.");
    for (const item of HIDEABLE) expect(hideDescription(item, false)).not.toMatch(/⌘|⇧|⌥/);
    // Settings itself can't be hidden: it's where things come back from
    expect(HIDEABLE.some((item) => /settings/i.test(item.title))).toBe(false);
  });
});
