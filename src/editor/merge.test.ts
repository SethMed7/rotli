import { describe, expect, test } from "bun:test";

import { threeWayMerge } from "./merge";

const base = ["# Plan", "", "- [ ] buy milk", "- [ ] call mom", "", "Notes here."].join("\n");

describe("threeWayMerge", () => {
  test("a task ticked elsewhere folds into a buffer edited further down", () => {
    const theirs = base.replace("- [ ] buy milk", "- [x] buy milk"); // Tasks view toggle
    const mine = base.replace("Notes here.", "Notes here.\nMore notes typed meanwhile.");
    const result = threeWayMerge(base, mine, theirs);
    expect(result).toEqual({
      ok: true,
      merged: [
        "# Plan",
        "",
        "- [x] buy milk",
        "- [ ] call mom",
        "",
        "Notes here.",
        "More notes typed meanwhile.",
      ].join("\n"),
    });
  });

  test("an appended paragraph from a chat edit joins a buffer edited at the top", () => {
    const theirs = `${base}\n\nAppended by the assistant.`;
    const mine = base.replace("# Plan", "# Plan for Monday");
    const result = threeWayMerge(base, mine, theirs);
    expect(result.ok).toBe(true);
    expect(result.ok && result.merged).toBe(
      `${base.replace("# Plan", "# Plan for Monday")}\n\nAppended by the assistant.`,
    );
  });

  test("the same edit on both sides is accepted once", () => {
    const both = base.replace("- [ ] call mom", "- [x] call mom");
    expect(threeWayMerge(base, both, both)).toEqual({ ok: true, merged: both });
    const mine = both.replace("Notes here.", "Notes here. Done.");
    expect(threeWayMerge(base, mine, both)).toEqual({ ok: true, merged: mine });
  });

  test("edits to the same line refuse instead of guessing", () => {
    const mine = base.replace("Notes here.", "Notes here, mine.");
    const theirs = base.replace("Notes here.", "Notes here, theirs.");
    const result = threeWayMerge(base, mine, theirs);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain("line 6");
  });

  test("one side unchanged returns the other; identical sides return themselves", () => {
    expect(threeWayMerge(base, base, "x")).toEqual({ ok: true, merged: "x" });
    expect(threeWayMerge(base, "y", base)).toEqual({ ok: true, merged: "y" });
    expect(threeWayMerge(base, "z", "z")).toEqual({ ok: true, merged: "z" });
  });

  test("a deletion on one side and an unrelated insertion on the other both survive", () => {
    const mine = base.replace("- [ ] call mom\n", ""); // removed a task
    const theirs = base.replace("# Plan", "# Plan\n\nIntro line."); // inserted near the top
    const result = threeWayMerge(base, mine, theirs);
    expect(result).toEqual({
      ok: true,
      merged: ["# Plan", "", "Intro line.", "", "- [ ] buy milk", "", "Notes here."].join("\n"),
    });
  });

  test("CRLF on disk merges against the editor's LF buffer", () => {
    const theirs = base.replace("- [ ] buy milk", "- [x] buy milk").replace(/\n/g, "\r\n");
    const mine = `${base}\nTail.`;
    const result = threeWayMerge(base, mine, theirs);
    expect(result.ok && result.merged).toBe(`${base.replace("- [ ] buy milk", "- [x] buy milk")}\nTail.`);
  });
});
