import { expect, test } from "bun:test";

import type { AppHost } from "../../host/registry";
import { BUILTIN_NAV, NOTES_PANES, settingsNav } from "./settingsNav";

const Pane = () => null;
const glyph = () => null;
const pane = (id: string, after?: string) => ({
  id,
  label: `Label ${id}`,
  glyph,
  Pane,
  ...(after ? { after } : {}),
});
const ids = (host: AppHost | null, platform: "desktop" | "web" = "desktop") =>
  settingsNav(platform, host).map((entry) => entry.id);

const ROTLI_DESKTOP = [
  "general",
  "hotkeys",
  "appearance",
  "browser",
  "brain",
  "security",
  "models",
  "chat",
  "location",
  "connections",
  "about",
];

test("with no host the nav is exactly Rotli's, in Rotli's order", () => {
  expect(ids(null)).toEqual(ROTLI_DESKTOP);
  expect(settingsNav("desktop", null).map((entry) => entry.label)).toEqual([
    "General",
    "Keybindings",
    "Appearance",
    "Browser",
    "Librarian",
    "Security",
    "AI Models",
    "Chat",
    "Location",
    "Connections",
    "About Rotli",
  ]);
  expect(settingsNav("desktop", null).every((entry) => entry.host === undefined)).toBe(true);
  expect(ids(null, "web")).toEqual(ROTLI_DESKTOP.filter((id) => id !== "hotkeys" && id !== "browser"));
  // a host that adds nothing changes nothing
  expect(ids({})).toEqual(ROTLI_DESKTOP);
  expect(ids({ notes: true, settingsPanes: [] })).toEqual(ROTLI_DESKTOP);
});

test("a host's panes go after the pane they name, in the order given, or before About", () => {
  const host: AppHost = {
    settingsPanes: [
      pane("capabilities", "general"),
      pane("cards", "general"),
      pane("late"),
      pane("lost", "nowhere"),
    ],
  };
  expect(ids(host)).toEqual([
    "general",
    "capabilities",
    "cards",
    ...ROTLI_DESKTOP.slice(1, -1),
    "late",
    "lost",
    "about",
  ]);
  const entry = settingsNav("desktop", host).find((row) => row.id === "cards");
  expect(entry?.label).toBe("Label cards");
  expect(entry?.host?.Pane).toBe(Pane);
});

test("without notes, Settings drops every notes pane and keeps the rest", () => {
  expect(ids({ notes: false })).toEqual(["general", "appearance", "connections", "about"]);
  for (const id of NOTES_PANES) expect(ids({ notes: false })).not.toContain(id);
  // a pane anchored to a hidden notes pane falls back to just before About
  expect(
    ids({ notes: false, settingsPanes: [pane("capabilities", "general"), pane("extra", "location")] }),
  ).toEqual(["general", "capabilities", "appearance", "connections", "extra", "about"]);
});

test("a host pane can never take a Rotli pane's id", () => {
  for (const { id } of BUILTIN_NAV) {
    expect(() => settingsNav("desktop", { settingsPanes: [pane(id)] })).toThrow("already Rotli's");
  }
});

test("a host can reorder the nav: the panes it names take their slots in its order", () => {
  const host: AppHost = { notes: false, settingsPanes: [pane("capabilities", "appearance"), pane("cards")] };
  expect(ids(host)).toEqual(["general", "appearance", "capabilities", "connections", "cards", "about"]);
  expect(ids({ ...host, navOrder: ["general", "appearance", "connections", "capabilities"] })).toEqual([
    "general",
    "appearance",
    "connections",
    "capabilities",
    "cards",
    "about",
  ]);
  // a notes pane this build doesn't show is skipped, not an error
  expect(ids({ notes: false, navOrder: ["connections", "location", "general"] })).toEqual([
    "connections",
    "appearance",
    "general",
    "about",
  ]);
  expect(() => ids({ navOrder: ["general", "nowhere"] })).toThrow("unknown");
  expect(() => ids({ navOrder: ["general", "general"] })).toThrow("twice");
  // no order, or an empty one, changes nothing
  expect(ids({ navOrder: [] })).toEqual(ROTLI_DESKTOP);
});

test("a host's About label and glyph mark the About row; Rotli's stay About Rotli and the quokka", () => {
  const about = (host: AppHost | null) => settingsNav("desktop", host).find((row) => row.id === "about");
  const rotliGlyph = BUILTIN_NAV.find((row) => row.id === "about")?.glyph;
  expect(about(null)?.label).toBe("About Rotli");
  expect(about(null)?.glyph).toBe(rotliGlyph);
  const labelled = about({ words: { aboutLabel: "About Synthetic" } });
  expect(labelled?.label).toBe("About Synthetic");
  expect(labelled?.glyph).toBe(rotliGlyph);
  const mark = () => null;
  expect(about({ aboutGlyph: mark })?.glyph).toBe(mark);
});
