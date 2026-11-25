import { expect, test } from "bun:test";

import { EXISTING_VAULT_REFUSAL } from "../lib/appIdentity";
import {
  type AppHost,
  DEFAULT_UPDATES_WORDS,
  appHost,
  createHostRegistry,
  existingVaultWords,
  notesOn,
  registerHost,
  updatesWords,
} from "./registry";

const Pane = () => null;
const glyph = () => null;
const pane = (id: string) => ({ id, label: id, glyph, Pane });

test("standalone Rotli has no host: notes on, Rotli's own words", () => {
  expect(appHost()).toBeNull();
  expect(notesOn()).toBe(true);
  expect(updatesWords()).toBe(DEFAULT_UPDATES_WORDS);
  expect(existingVaultWords()).toBe(EXISTING_VAULT_REFUSAL);
  // the app has read the registry, so a late host is refused
  expect(() => registerHost({ notes: false })).toThrow("before the app starts");
  expect(appHost()).toBeNull();
});

test("a host registers once, before the first read, and can't change afterwards", () => {
  const registry = createHostRegistry();
  const host: AppHost = {
    notes: false,
    settingsPanes: [pane("capabilities")],
    words: { updates: "Updated elsewhere" },
  };
  registry.register(host);
  expect(() => registry.register({})).toThrow("already registered");
  const read = registry.read();
  expect(read?.settingsPanes?.map((entry) => entry.id)).toEqual(["capabilities"]);
  expect(Object.isFrozen(read)).toBe(true);
  expect(Object.isFrozen(read?.settingsPanes)).toBe(true);
  expect(notesOn(read)).toBe(false);
  expect(updatesWords(read)).toBe("Updated elsewhere");
  expect(existingVaultWords(read)).toBe(EXISTING_VAULT_REFUSAL);
  expect(existingVaultWords({ words: { existingVault: "Host words." } })).toBe("Host words.");
  expect(notesOn({})).toBe(true);
});

test("a registry refuses a host after the app has read it, and duplicate pane ids", () => {
  const late = createHostRegistry();
  expect(late.read()).toBeNull();
  expect(() => late.register({})).toThrow("before the app starts");
  const duplicate = createHostRegistry();
  expect(() => duplicate.register({ settingsPanes: [pane("cards"), pane("cards")] })).toThrow("unique ids");
});
