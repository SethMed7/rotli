import { afterAll, expect, mock, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";

import type { AppHost } from "../../host/registry";
import { settingsNav } from "./settingsNav";

// Settings under a host build with notes off: the window is Settings, the
// notes panes are gone, and a host pane carries the banner's scenery with no
// character. The host is synthetic; nothing here names a real product.
const registry = { ...(await import("../../host/registry")) };
const react = { ...(await import("react")) };
const HostBody = () => <p className="setnote">Synthetic host pane body.</p>;
const Opening = () => <p className="setnote">Synthetic opening block.</p>;
const Closing = () => <p className="setnote">Synthetic closing block.</p>;
const host: AppHost = {
  notes: false,
  paneBlocks: [
    { pane: "general", place: "before", Block: Opening },
    { pane: "general", place: "after", Block: Closing },
    { pane: "connections", place: "before", Block: Opening },
    { pane: "about", place: "after", Block: Closing },
  ],
  navOrder: ["general", "appearance", "connections", "synthetic"],
  words: { productName: "Synthetic App", version: "2.0.1", aboutLabel: "About Synthetic" },
  settingsPanes: [
    {
      id: "synthetic",
      label: "Synthetic",
      title: "Synthetic pane",
      after: "general",
      glyph: () => null,
      Pane: HostBody,
    },
  ],
};
let selectedPane = "general";
await mock.module("../../host/registry", () => ({
  ...registry,
  appHost: () => host,
  notesOn: (given: AppHost | null = host) => registry.notesOn(given),
  paneBlocks: (pane: never, place: never, given: AppHost | null = host) =>
    registry.paneBlocks(pane, place, given),
  productName: (given: AppHost | null = host) => registry.productName(given),
  aboutLabel: (given: AppHost | null = host) => registry.aboutLabel(given),
  hostVersion: (given: AppHost | null = host) => registry.hostVersion(given),
  plainPaneHeads: (given: AppHost | null = host) => registry.plainPaneHeads(given),
  connectionsLead: (given: AppHost | null = host) => registry.connectionsLead(given),
  notesSectionTag: (given: AppHost | null = host) => registry.notesSectionTag(given),
  dockRow: (given: AppHost | null = host) => registry.dockRow(given),
  aboutBody: (given: AppHost | null = host) => registry.aboutBody(given),
}));
// SSR runs no effects, so the surface starts on the pane under test
const startAt = (initial: unknown) => (initial === "general" ? selectedPane : initial);
await mock.module("react", () => ({
  ...react,
  useState: (initial: unknown) => react.useState(startAt(initial)),
}));
const { SettingsSurface } = await import("../settingsSurface");
const { ConnectionsSettings } = await import("./connectionsSettings");
const { DEFAULT_DOCK_ROW } = registry;
afterAll(async () => {
  await mock.module("react", () => react);
  await mock.module("../../host/registry", () => registry);
});
const render = () =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <SettingsSurface />
    </QueryClientProvider>,
  );
const navLabels = (html: string) =>
  [...html.matchAll(/<span class="fname">([^<]+)<\/span>/g)].map((m) => m[1]);

test("without notes, Settings has no way back to notes and no notes panes", () => {
  selectedPane = "general";
  const html = render();
  expect(html).not.toContain("Back to notes");
  expect(navLabels(html)).toEqual(settingsNav("desktop", host).map((entry) => entry.label));
  for (const notes of ["Keybindings", "Librarian", "Location"]) expect(navLabels(html)).not.toContain(notes);
  expect(navLabels(html)).toContain("Synthetic");
});

test("a host pane is its scenery heading with no character, then the host's body", () => {
  selectedPane = "synthetic";
  const html = render();
  expect(html).toContain('<h3 class="set-banner-title">Synthetic pane</h3>');
  expect(html).toContain('data-banner="');
  expect(html).toContain(':scenery"');
  expect(html).not.toContain("set-banner-quokka");
  expect(html).toContain("Synthetic host pane body.");
});

/** Every built-in pane's heading banner, with notes on so none is left out. */
const builtInHeads = () => {
  host.notes = true;
  try {
    return settingsNav("desktop", host)
      .filter((entry) => !entry.host)
      .map((entry) => {
        selectedPane = entry.id;
        const head = render().match(/data-banner="[^:"]+:([^"]+)">.*?<\/h3>/s);
        return { id: entry.id, motif: head?.[1], quokka: head?.[0].includes("set-banner-quokka") };
      });
  } finally {
    host.notes = false;
  }
};

test("Rotli's own panes keep their character and object under a host", () => {
  const heads = builtInHeads();
  expect(heads.length).toBeGreaterThan(8);
  expect(heads.filter((head) => !head.quokka || !head.motif || head.motif === "scenery")).toEqual([]);
});

test("a host that asks for plain heads gets scenery alone on every built-in pane", () => {
  host.paneHeads = "plain";
  try {
    expect(builtInHeads().filter((head) => head.quokka !== false || head.motif !== "scenery")).toEqual([]);
  } finally {
    delete host.paneHeads;
  }
});

test("a host words or hides the Connections lead and tags each of Rotli's own sections", () => {
  const words = host.words;
  const connections = (agents: boolean) =>
    renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <ConnectionsSettings agents={agents} braveKeyRow={null} />
      </QueryClientProvider>,
    );
  const tag = ' <span class="set-section-tag">Synthetic tag</span>';
  const headings = (agents: boolean) =>
    [...connections(agents).matchAll(/<h4 class="set-subhead"[^>]*>(.*?)<\/h4>/g)].map((match) => match[1]);
  try {
    // Rotli's own headings, stable then with agents, as they read before any word
    const untagged = [false, true].map(headings);
    expect(untagged.map((list) => list.length)).toEqual([2, 3]);
    host.words = { ...words, connectionsLead: "Synthetic lead.", notesSectionTag: "Synthetic tag" };
    selectedPane = "connections";
    expect(render()).toContain('<p class="lead">Synthetic lead.</p>');
    expect([false, true].map(headings)).toEqual(untagged.map((list) => list.map((heading) => heading + tag)));
    host.words = { ...words, connectionsLead: "" };
    expect(connections(false)).not.toContain('class="lead"');
    expect(connections(false)).toStartWith('<section class="aisection">');
    expect(connections(true)).not.toContain("set-section-tag");
  } finally {
    host.words = words!;
  }
});

test("a host's blocks sit below the heading, before and after Rotli's own body", () => {
  selectedPane = "general";
  const html = render();
  const title = html.indexOf('<h3 class="set-banner-title">General</h3>');
  const opening = html.indexOf("Synthetic opening block.");
  const body = html.indexOf("Start fresh");
  const closing = html.indexOf("Synthetic closing block.");
  expect(title).toBeGreaterThan(-1);
  expect([title < opening, opening < body, body < closing]).toEqual([true, true, true]);
  selectedPane = "connections";
  expect(render()).toContain("Synthetic opening block.");
});

test("a host's order, name, version and About label replace Rotli's", () => {
  selectedPane = "about";
  const html = render();
  // the host's order puts its pane fourth, after Rotli's Connections
  expect(navLabels(html)).toEqual(settingsNav("desktop", host).map((entry) => entry.label));
  expect(settingsNav("desktop", host).map((entry) => entry.id)).toEqual([
    "general",
    "appearance",
    "connections",
    "synthetic",
    "about",
  ]);
  expect(navLabels(html).at(-1)).toBe("About Synthetic");
  expect(html).toContain('<h3 class="set-banner-title">About Synthetic</h3>');
  expect(html).toContain('<span class="set-nav-version">Synthetic App 2.0.1</span>');
  expect(html.indexOf("Synthetic closing block.")).toBeGreaterThan(html.indexOf("About Synthetic</h3>"));
  expect(html).not.toContain("About Rotli");
});

/** Renders `pane` with `extra` words over the host's own, then restores them. */
const renderWith = (extra: AppHost["words"], pane: string) => {
  const words = host.words;
  host.words = { ...words, ...extra };
  selectedPane = pane;
  try {
    return render();
  } finally {
    host.words = words!;
  }
};
const switchTitles = (html: string) =>
  [...html.matchAll(/<span class="swt">([^<]+)<\/span>/g)].map((m) => m[1]);

test("a host rewords the Dock row, and the App icon line follows its label", () => {
  const row = { label: "A synthetic switch", detail: "A synthetic explanation." };
  const general = renderWith({ dockRow: row }, "general");
  expect(switchTitles(general)).toContain(row.label);
  expect(general).toContain(`<span class="swd">${row.detail}</span>`);
  expect(general).not.toContain(DEFAULT_DOCK_ROW.label);
  expect(renderWith({ dockRow: row }, "appearance")).toContain(`it shows when <b>${row.label}</b> is on.`);
});

test("a host that retires the Dock row loses only that row and its mention", () => {
  const standalone = switchTitles(renderWith({}, "general"));
  expect(standalone).toContain(DEFAULT_DOCK_ROW.label);
  expect(switchTitles(renderWith({ dockRow: null }, "general"))).toEqual(
    standalone.filter((title) => title !== DEFAULT_DOCK_ROW.label),
  );
  const appearance = renderWith({ dockRow: null }, "appearance");
  expect(appearance).toContain('<p class="lead">Pick the Dock icon.</p>');
});

test("a host replaces or drops About's wording; the version row and its blocks stay", () => {
  const version = "<span>Synthetic App 2.0.1</span></div>";
  const replaced = renderWith({ aboutBody: "A synthetic paragraph." }, "about");
  expect(replaced).toContain(
    `<p class="lead">A synthetic paragraph.</p><div class="setselect-row">${version}`,
  );
  const dropped = renderWith({ aboutBody: null }, "about");
  expect(dropped).not.toContain('<p class="lead">');
  for (const html of [replaced, dropped]) {
    // no link, heading or note of Rotli's is left behind
    expect([html.includes("<a "), html.includes("sethead"), html.includes('class="setnote">The')]).toEqual([
      false,
      false,
      false,
    ]);
    expect(html).toContain(version);
    expect(html).toContain('<h3 class="set-banner-title">About Synthetic</h3>');
    expect(html).toContain("Synthetic closing block.");
  }
  expect(renderWith({}, "about")).toContain('<a class="ghostbtn about-link"');
});
