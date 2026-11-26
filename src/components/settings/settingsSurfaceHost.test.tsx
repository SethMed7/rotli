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
}));
// SSR runs no effects, so the surface starts on the pane under test
const startAt = (initial: unknown) => (initial === "general" ? selectedPane : initial);
await mock.module("react", () => ({
  ...react,
  useState: (initial: unknown) => react.useState(startAt(initial)),
}));
const { SettingsSurface } = await import("../settingsSurface");
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

test("Rotli's own pane keeps its character under a host", () => {
  selectedPane = "general";
  expect(render()).toContain("set-banner-quokka");
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
