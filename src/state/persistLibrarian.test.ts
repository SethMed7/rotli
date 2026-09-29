// The Librarian lane and model knobs through the settings parser: connected
// clients survive, everything else fails closed, and a model id sticks only
// inside its lane's catalog.

import { expect, test } from "bun:test";

import type { LibrarianRules } from "../lib/librarianRules";
import { parseSettings, unknownSettingsKeys } from "./persist";

test("the Librarian lane keeps the connected clients and fails closed on everything else", () => {
  const lane = (id: string) => parseSettings(`{"organizerModel":"${id}"}`).organizerModel;
  expect(["claude", "antigravity"].map(lane)).toEqual(["claude", "antigravity"]);
  expect(["gemini35", "cursor", "future"].map(lane)).toEqual(["local", "local", "local"]);
});

test("a Librarian model id is kept only when its lane's catalog lists it", () => {
  const id = (raw: string) => parseSettings(raw).organizerModelId;
  expect(id('{"organizerModel":"claude","organizerModelId":"opus"}')).toBe("opus[1m]");
  expect(id('{"organizerModel":"claude","organizerModelId":"gemini-3.8-flash-high"}')).toBeNull();
  expect(id('{"organizerModel":"local","organizerModelId":"opus"}')).toBeNull();
  expect(id("{}")).toBeNull();
});

test("a model id the client may still report survives load; discovery has not answered yet", () => {
  const parsed = parseSettings(
    '{"providerDefaults":{"codex":"gpt-7-nova"},"organizerModel":"codex","organizerModelId":"gpt-7-nova"}',
  );
  expect(parsed.providerDefaults.codex).toBe("gpt-7-nova");
  expect(parsed.organizerModelId).toBe("gpt-7-nova");
});

test("the Librarian rules round-trip through the vault settings, and fall back to the defaults", () => {
  const rules: LibrarianRules = {
    secureKeywords: ["bank", "passport"],
    people: { mode: "groups", groups: ["Family", "Neighbors"] },
    filing: ["Recipes go to Cooking"],
  };
  expect(parseSettings(JSON.stringify({ librarianRules: rules })).librarianRules).toEqual(rules);
  expect(parseSettings("{}").librarianRules.people.groups).toEqual([
    "Family",
    "Friends",
    "Work",
    "Acquaintances",
  ]);
  expect(parseSettings('{"librarianRules":"nonsense"}').librarianRules.secureKeywords).toEqual([]);
  // a known key: written from the rules store, never passed through as unknown
  expect(unknownSettingsKeys(JSON.stringify({ librarianRules: rules }))).toEqual({});
});
