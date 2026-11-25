import { expect, test } from "bun:test";

import {
  type AppHost,
  DEFAULT_ABOUT_LABEL,
  DEFAULT_PRODUCT_NAME,
  DEFAULT_UPDATES_WORDS,
  aboutLabel,
  appHost,
  createHostRegistry,
  hostVersion,
  navFootLabel,
  notesOn,
  paneBlocks,
  productName,
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
  expect(productName()).toBe("Rotli");
  expect(aboutLabel()).toBe("About Rotli");
  expect(hostVersion()).toBeNull();
  expect(paneBlocks("general", "before")).toEqual([]);
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
  expect(productName(read)).toBe(DEFAULT_PRODUCT_NAME);
  expect(aboutLabel(read)).toBe(DEFAULT_ABOUT_LABEL);
  expect(notesOn({})).toBe(true);
});

test("a registry refuses a host after the app has read it, and duplicate pane ids", () => {
  const late = createHostRegistry();
  expect(late.read()).toBeNull();
  expect(() => late.register({})).toThrow("before the app starts");
  const duplicate = createHostRegistry();
  expect(() => duplicate.register({ settingsPanes: [pane("cards"), pane("cards")] })).toThrow("unique ids");
});

test("a host names its product, its version and its About row; Rotli's stay as they are", () => {
  const words = { productName: "Synthetic App", version: "2.0.1", aboutLabel: "About Synthetic" };
  expect(productName({ words })).toBe("Synthetic App");
  expect(hostVersion({ words })).toBe("2.0.1");
  expect(aboutLabel({ words })).toBe("About Synthetic");
  expect(navFootLabel("Rotli", "1.9.7")).toBe("Rotli 1.9.7");
  expect(navFootLabel("Rotli", null)).toBe("Rotli");
  expect(navFootLabel("Synthetic App", "2.0.1")).toBe("Synthetic App 2.0.1");
});

test("a host adds blocks before or after the body of General, Connections and About, in order", () => {
  const First = () => null;
  const Second = () => null;
  const Closing = () => null;
  const registry = createHostRegistry();
  registry.register({
    paneBlocks: [
      { pane: "general", place: "before", Block: First },
      { pane: "about", place: "after", Block: Closing },
      { pane: "general", place: "before", Block: Second },
    ],
  });
  const host = registry.read();
  expect(paneBlocks("general", "before", host)).toEqual([First, Second]);
  expect(paneBlocks("general", "after", host)).toEqual([]);
  expect(paneBlocks("about", "after", host)).toEqual([Closing]);
  expect(paneBlocks("connections", "before", host)).toEqual([]);
  expect(Object.isFrozen(host?.paneBlocks)).toBe(true);
});

test("a block can only go in a pane that takes blocks, before or after its body", () => {
  const Block = () => null;
  for (const bad of [
    { pane: "location", place: "before", Block },
    { pane: "general", place: "inside", Block },
  ]) {
    expect(() => createHostRegistry().register({ paneBlocks: [bad as never] })).toThrow("Host pane blocks");
  }
});
