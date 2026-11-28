import { expect, test } from "bun:test";

import {
  type AppHost,
  type HostFirstRun,
  aboutBody,
  DEFAULT_ABOUT_LABEL,
  DEFAULT_CONNECTIONS_LEAD,
  DEFAULT_DOCK_ROW,
  DEFAULT_INLINE_NAME,
  DEFAULT_PRODUCT_NAME,
  DEFAULT_UPDATES_WORDS,
  aboutLabel,
  appHost,
  connectionsLead,
  createHostRegistry,
  dockRow,
  hostSetupStep,
  hostThemeFamily,
  hostVersion,
  inlineName,
  mascotShown,
  navFootLabel,
  notesOn,
  notesSectionTag,
  paneBlocks,
  plainFirstRun,
  plainPaneHeads,
  productMark,
  productName,
  registerHost,
  setupOrder,
  setupStepBlocks,
  setupStepWords,
  setupThemeChoice,
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
  expect(plainPaneHeads()).toBe(false);
  expect(connectionsLead()).toBe(DEFAULT_CONNECTIONS_LEAD);
  expect(notesSectionTag()).toBeNull();
  expect(DEFAULT_DOCK_ROW).toEqual({
    label: "Show in the Dock",
    detail: "Otherwise Rotli lives in the menu bar only.",
  });
  expect(dockRow()).toEqual(DEFAULT_DOCK_ROW);
  expect(aboutBody()).toBeUndefined();
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

test("a host asks for plain heads, words its Connections lead and tags Rotli's sections", () => {
  expect(plainPaneHeads({ paneHeads: "plain" })).toBe(true);
  expect(plainPaneHeads({ paneHeads: "rotli" })).toBe(false);
  const words = { connectionsLead: "A registry lead.", notesSectionTag: "A registry label" };
  expect(connectionsLead({ words })).toBe("A registry lead.");
  expect(notesSectionTag({ words })).toBe("A registry label");
  // an empty lead hides it; an absent or empty tag tags nothing
  expect(connectionsLead({ words: { connectionsLead: "" } })).toBe("");
  expect(connectionsLead({})).toBe(DEFAULT_CONNECTIONS_LEAD);
  expect(notesSectionTag({ words: { notesSectionTag: "" } })).toBeNull();
});

test("Rotli's default sentences that name the app follow a host's product name", () => {
  const words = { productName: "Synthetic" };
  expect(connectionsLead({ words })).toBe(DEFAULT_CONNECTIONS_LEAD.replace("Rotli", "Synthetic"));
  expect(dockRow({ words })?.detail).toBe("Otherwise Synthetic lives in the menu bar only.");
  expect(DEFAULT_CONNECTIONS_LEAD).toStartWith("Choose the outside services Rotli can contact.");
});

test("a host rewords or retires the Dock row, and replaces or drops About's wording", () => {
  expect(dockRow({ words: { dockRow: { label: "A registry row" } } })).toEqual({
    label: "A registry row",
    detail: DEFAULT_DOCK_ROW.detail,
  });
  expect(dockRow({ words: { dockRow: { detail: "" } } })).toEqual({
    label: DEFAULT_DOCK_ROW.label,
    detail: "",
  });
  expect(dockRow({ words: { dockRow: null } })).toBeNull();
  expect(dockRow({})).toEqual(DEFAULT_DOCK_ROW);
  expect(aboutBody({ words: { aboutBody: "A registry paragraph." } })).toBe("A registry paragraph.");
  expect(aboutBody({ words: { aboutBody: null } })).toBeNull();
  expect(aboutBody({})).toBeUndefined();
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

test("standalone Rotli keeps its wordmark, its theme family and its quokka", () => {
  expect(inlineName()).toBe("rotli");
  expect(DEFAULT_INLINE_NAME).toBe("rotli");
  expect(hostThemeFamily()).toBeNull();
  expect(mascotShown()).toBe(true);
  expect(productMark()).toBeNull();
});

test("a host's name stands in for the wordmark, unless it gives its own", () => {
  expect(inlineName({ words: { productName: "Synthetic App" } })).toBe("Synthetic App");
  expect(inlineName({ words: { productName: "Synthetic App", inlineName: "synthetic" } })).toBe("synthetic");
  expect(inlineName({})).toBe("rotli");
});

test("a host picks the starting theme family and can retire the quokka for its own mark", () => {
  const mark = () => null;
  const host: AppHost = { themeFamily: "ocean", mascot: "none", productMark: mark };
  expect(hostThemeFamily(host)).toBe("ocean");
  expect(mascotShown(host)).toBe(false);
  expect(productMark(host)).toBe(mark);
  expect(mascotShown({ mascot: "quokka" })).toBe(true);
});

test("an unknown theme family or mascot is refused at registration", () => {
  expect(() => createHostRegistry().register({ themeFamily: "neon" as never })).toThrow("theme family");
  expect(() => createHostRegistry().register({ mascot: "otter" as never })).toThrow("mascot");
  expect(() => createHostRegistry().register({ themeFamily: "grove", mascot: "none" })).not.toThrow();
});

test("a host's first run: its order, its steps, blocks and words, and Rotli's own without one", () => {
  const Body = () => null;
  const host: AppHost = {
    firstRun: {
      plain: true,
      order: ["you", "synthetic-tools", "vault"],
      steps: [{ id: "synthetic-tools", label: "Tools", title: "Pick your tools.", Body }],
      blocks: [{ step: "vault", place: "before", Block: Body }],
      words: { vault: { label: "Connect", primary: "Finish setup" } },
      themeChoice: false,
    },
  };
  expect(() => createHostRegistry().register(host)).not.toThrow();
  expect(setupOrder(host)).toEqual(["you", "synthetic-tools", "vault"]);
  expect(plainFirstRun(host)).toBe(true);
  expect(hostSetupStep("synthetic-tools", host)?.title).toBe("Pick your tools.");
  expect(hostSetupStep("vault", host)).toBeNull();
  expect(setupStepBlocks("vault", "before", host)).toHaveLength(1);
  expect(setupStepBlocks("vault", "after", host)).toEqual([]);
  expect(setupStepWords("vault", host)).toEqual({ label: "Connect", primary: "Finish setup" });
  expect(setupStepWords("you", host)).toEqual({});
  expect(setupThemeChoice(host)).toBe(false);
  // with no order, Rotli's four come first and the host's steps after
  expect(setupOrder({ firstRun: { steps: host.firstRun!.steps! } })).toEqual([
    "you",
    "vault",
    "librarian",
    "shortcuts",
    "synthetic-tools",
  ]);
  // standalone
  expect(setupOrder(null)).toEqual(["you", "vault", "librarian", "shortcuts"]);
  expect(plainFirstRun(null)).toBe(false);
  expect(setupThemeChoice(null)).toBe(true);
});

test("a first run that can't be followed is refused at registration", () => {
  const Body = () => null;
  const step = (id: string) => ({ id, label: id, title: id, Body });
  const refused = (firstRun: HostFirstRun) => () => createHostRegistry().register({ firstRun });
  expect(refused({ order: ["vault", "you"] })).toThrow('starts with "you"');
  expect(refused({ order: ["you", "librarian"] })).toThrow('holds "vault"');
  expect(refused({ order: ["you", "vault", "nowhere"] })).toThrow("Unknown first-run steps: nowhere");
  expect(refused({ order: ["you", "vault", "vault"] })).toThrow("named twice");
  expect(refused({ steps: [step("vault")] })).toThrow("none of them a built-in step's");
  expect(refused({ steps: [step("a"), step("a")] })).toThrow("unique ids");
  expect(refused({ order: ["you", "vault"], steps: [step("a")] })).toThrow("left out of the order: a");
  expect(
    refused({ order: ["you", "vault"], blocks: [{ step: "librarian", place: "before", Block: Body }] }),
  ).toThrow("a step in the order: librarian");
});
