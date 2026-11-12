import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { type CheckState, SettingsNavUpdates, shownState, statusLine } from "./updatesNav";

test("with no update known, the menu foot offers a check and invents no version", () => {
  const html = renderToStaticMarkup(<SettingsNavUpdates />);
  expect(html).toContain("Check for updates");
  expect(html).not.toContain("Install &amp; relaunch");
  expect(html).not.toMatch(/Rotli \d/);
});

test("an update the background check found replaces an idle or up-to-date footer", () => {
  const found: CheckState = { kind: "available", version: "1.10.1" };
  expect(shownState({ kind: "idle" }, true, "1.10.1")).toEqual(found);
  expect(shownState({ kind: "current" }, true, "1.10.1")).toEqual(found);
  expect(statusLine(found)).toBe("Update available: v1.10.1");
  expect(statusLine({ kind: "available", version: null })).toBe("Update available");
});

test("the footer's own check, install or error is never overwritten by the background result", () => {
  for (const local of [
    { kind: "checking" },
    { kind: "installing", pct: 40 },
    { kind: "error", message: "offline" },
  ] as const) {
    expect(shownState(local, true, "1.10.1")).toEqual(local);
  }
  expect(shownState({ kind: "idle" }, false, null)).toEqual({ kind: "idle" });
  expect(statusLine({ kind: "idle" })).toBeNull();
  expect(statusLine({ kind: "current" })).toBe("Up to date");
});
