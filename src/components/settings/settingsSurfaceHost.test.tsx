import { afterAll, expect, mock, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";

import type { AppHost, HostPaneProps } from "../../host/registry";
import { settingsNav } from "./settingsNav";

// Settings under a host build with notes off: the window is Settings, the
// notes panes are gone, and a host pane carries the banner's scenery with no
// character. The host is synthetic; nothing here names a real product.
const registry = { ...(await import("../../host/registry")) };
const react = { ...(await import("react")) };
const identity = { ...(await import("../../lib/appIdentity")) };
const tauri = { ...(await import("../../lib/tauri")) };
// what the host pane was handed, and what the surface set the pane to
const links: HostPaneProps["openPane"][] = [];
const paneSets: unknown[] = [];
const HostBody = (props: HostPaneProps) => {
  links.push(props.openPane);
  return <p className="setnote">Synthetic host pane body.</p>;
};
let capable = true;
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
    { id: "gated", label: "Gated", glyph: () => null, Pane: HostBody, visible: () => capable },
  ],
};
let selectedPane = "general";
// null renders standalone Rotli
let active: AppHost | null = host;
// the Mac app's own copy (Location) shows only in the Tauri shell
let native = false;
// every `false` state starts true: the armed "Remove vault?" button
let armed = false;
await mock.module("../../host/registry", () => ({
  ...registry,
  appHost: () => active,
  notesOn: (given: AppHost | null = active) => registry.notesOn(given),
  paneBlocks: (pane: never, place: never, given: AppHost | null = active) =>
    registry.paneBlocks(pane, place, given),
  productName: (given: AppHost | null = active) => registry.productName(given),
  aboutLabel: (given: AppHost | null = active) => registry.aboutLabel(given),
  hostVersion: (given: AppHost | null = active) => registry.hostVersion(given),
  plainPaneHeads: (given: AppHost | null = active) => registry.plainPaneHeads(given),
  connectionsLead: (given: AppHost | null = active) => registry.connectionsLead(given),
  notesSectionTag: (given: AppHost | null = active) => registry.notesSectionTag(given),
  dockRow: (given: AppHost | null = active) => registry.dockRow(given),
  aboutBody: (given: AppHost | null = active) => registry.aboutBody(given),
}));
// a host build never has Rotli's bundle ID
await mock.module("../../lib/appIdentity", () => ({ ...identity, OWNS_SHARED_STATE: false }));
await mock.module("../../lib/tauri", () => ({ ...tauri, isTauri: () => native }));
// SSR runs no effects, so the surface starts on the pane under test
await mock.module("react", () => ({
  ...react,
  useState: (initial: unknown) => {
    const surfacePane = initial === "general";
    const start = surfacePane ? selectedPane : armed && initial === false ? true : initial;
    const [value, set] = react.useState(start);
    if (!surfacePane) return [value, set];
    return [value, (next: unknown) => (paneSets.push(next), set(next))];
  },
}));
const { SettingsSurface } = await import("../settingsSurface");
const { ConnectionsSettings } = await import("./connectionsSettings");
const { BUILT_IN, ROTLI_WEBSITE_URL } = await import("./aboutPane");
const { registerDefaultActions } = await import("../../keys/actions");
const { useUiStore } = await import("../../state/ui");
const { DEFAULT_DOCK_ROW } = registry;
afterAll(async () => {
  await mock.module("react", () => react);
  await mock.module("../../host/registry", () => registry);
  await mock.module("../../lib/appIdentity", () => identity);
  await mock.module("../../lib/tauri", () => tauri);
});
const wrap = (node: React.ReactNode, client = new QueryClient()) =>
  renderToStaticMarkup(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
const render = (client?: QueryClient) => wrap(<SettingsSurface />, client);
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
    "gated",
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

test("a host replaces or drops About's wording; version, credits and its blocks stay", () => {
  const version = "<span>Synthetic App 2.0.1</span></div>";
  const replaced = renderWith({ aboutBody: "A synthetic paragraph." }, "about");
  expect(replaced).toContain(
    `<p class="lead">A synthetic paragraph.</p><div class="setselect-row">${version}`,
  );
  const dropped = renderWith({ aboutBody: null }, "about");
  expect(dropped).not.toContain('<p class="lead">');
  for (const html of [replaced, dropped]) {
    // the third-party credits stay: attribution for code the host ships
    for (const editor of BUILT_IN) expect(html).toContain(`href="${editor.url}">${editor.name}</a>`);
    expect(html).toContain("live inside Synthetic App and save");
    // no website link, feedback link or note of Rotli's is left behind
    expect([
      html.includes(ROTLI_WEBSITE_URL),
      html.includes("about-link"),
      html.includes('class="setnote">The'),
      html.includes("inside Rotli"),
    ]).toEqual([false, false, false, false]);
    expect(html).toContain(version);
    expect(html).toContain('<h3 class="set-banner-title">About Synthetic</h3>');
    expect(html).toContain("Synthetic closing block.");
  }
  expect(renderWith({}, "about")).toContain('<a class="ghostbtn about-link"');
});

/** A vault, one connected vault (unless `linked` is false) and Antigravity not
 * yet installed: the states whose copy names the app. */
const seeded = (linked: boolean, openedInPlace: boolean) => {
  const vault = (id: string, label: string) => ({
    id,
    label,
    root: `/Users/example/${label}`,
    role: "brain",
    memexId: `mx_${id}`,
    mode: null,
    perms: "read-only",
    brainEnabled: true,
    layout: "memex",
    inPlace: false,
  });
  const client = new QueryClient();
  client.setQueryData(["memex", "config"], {
    activeId: "corpus",
    instances: [vault("corpus", "Garden"), ...(linked ? [vault("other", "Orchard")] : [])],
    developmentReadOnly: false,
    openedInPlace,
  });
  client.setQueryData(["antigravity", "status"], {
    platformSupported: true,
    installed: false,
    updateAvailable: false,
    signedIn: false,
    latestVersion: "1.0.0",
  });
  return client;
};

/** Every built-in pane but About (its words are `aboutBody`'s), in the Mac
 * shell, plus the states a single render can't show at once. */
const everyPane = () => {
  const initial = useUiStore.getInitialState();
  const provider = initial.webSearchProvider;
  Object.assign(initial, { webSearchProvider: "brave" });
  native = true;
  registerDefaultActions();
  try {
    const ids = settingsNav("desktop", null)
      .map((entry) => entry.id)
      .filter((id) => id !== "about");
    const panes = ids.map((id) => ((selectedPane = id), render(seeded(true, false))));
    selectedPane = "location";
    panes.push(render(seeded(false, false)));
    armed = true;
    panes.push(render(seeded(true, false)));
    armed = false;
    selectedPane = "brain";
    panes.push(render(seeded(true, true)));
    Object.assign(initial, { webSearchProvider: "duckduckgo" });
    panes.push(wrap(<ConnectionsSettings agents={false} braveKeyRow={null} />));
    panes.push(wrap(<ConnectionsSettings agents braveKeyRow={null} />));
    return panes.join("\n").replaceAll("&#x27;", "'");
  } finally {
    Object.assign(initial, { webSearchProvider: provider });
    native = armed = false;
  }
};

/** Every Settings sentence that means "this app", as the app called `name`. */
const meaningThisApp = (name: string) => [
  `Every shortcut in ${name} is yours to rebind.`,
  `Hold ⌘ for a moment and ${name} shows you what you can press`,
  `${name} is a visitor by default — summon it, write, dismiss it.`,
  `Otherwise ${name} lives in the menu bar only.`,
  `placeholder="How should ${name} address you?"`,
  `/template lists ${name}'s own starters — meeting notes`,
  `and ${name} draws the box half-filled.`,
  `toggling relaunches ${name}.`,
  `Shape ${name} into a workspace that feels like yours.`,
  `or let ${name} follow your Mac.`,
  `while ${name} keeps contrast safe.`,
  `Home is where ${name} opens`,
  `>Show in ${name}</h4>`,
  `what a hidden button opens stays in ${name}.`,
  `Open links and run quick searches inside ${name}.`,
  `Each page is a normal ${name} tab`,
  `research without leaving ${name}, not a replacement`,
  `connect a copy: ${name} copies “Garden” beside your vaults`,
  `so ${name} never lets the Librarian touch it: it organizes a copy ${name} makes instead.`,
  `renamed, edited, or deleted by ${name}.`,
  `is one ${name} treats as private from AI.`,
  `is flagged when ${name} reads it.`,
  `${name}’s organizer skips secure notes entirely`,
  `${name} enables a connected provider only through`,
  `${name} does not present provider logins`,
  `${name} reviews these boundaries`,
  `Sign in with your Claude account. ${name} never sees the credential.`,
  `Sign in with your ChatGPT account. ${name} never sees the credential.`,
  `Sign in with your Cursor account. ${name} uses Cursor's read-only Ask mode.`,
  `Come back to ${name}`,
  `${name} notices on its own; Check again asks right now.`,
  `${name} uses Google’s own published ACP agent`,
  `${name} uses only this runtime.`,
  `${name} downloads the exact release`,
  `${name} picks (this Mac's default)`,
  `${name} adds its organization and retrieval layer`,
  `${name} never holds your notes hostage.`,
  `takes a ${name} vault (used in place)`,
  `Connect another ${name} vault to make it available`,
  `${name} shows and searches only one active vault`,
  `only disconnects it from ${name}.`,
  `>Remove from ${name}</button>`,
  `aria-label="Confirm removing Orchard from ${name}"`,
  `Your current vault is all ${name} shows and searches.`,
  `Choose the outside services ${name} can contact.`,
  `and ${name} reads the result pages it`,
  `${name} never ships a shared key`,
  `${name} tells you when that happens.`,
  `${name} never displays a saved key.`,
  `Connect ${name} to Grok Bot`,
  `Extend ${name}’s corpus workflows`,
  `${name} must be open and connected for every request.`,
];

/** What still says Rotli under a host: sentences about Rotli itself, its
 * formats, its theme and its other builds (docs/architecture/host-seams.md). */
const ABOUT_ROTLI_ITSELF = [
  // Rotli, running beside a host, holds the system-wide chords
  "system-wide shortcuts stay with Rotli",
  // the About pane's row: its body describes Rotli, and `words.aboutLabel` renames it
  "About Rotli",
  // who made the music
  "from the Rotli studio",
  // Rotli's own link format, and its past versions
  "Rotli’s own format",
  "Older versions of Rotli",
  // Rotli's Finder Quick Action: a host build never adds it
  "Open in Rotli",
  "Rotli changes nothing in Finder",
  // Rotli's releases, and the dashboard named for them across the app
  "What’s new in Rotli",
  "Rotli activity dashboard",
  // the theme family and the syntax palette
  '<span class="famlabel">Rotli</span>',
  ">Rotli</button>",
  // the agent card whose command runs Rotli's own app and CLI
  "Use Rotli for your docs",
  "docs land in Rotli instead",
  "keep it in my Rotli",
  "/Applications/Rotli.app",
  "e.g. Rotli.",
];

test("under a host named Synthetic, no swept Settings sentence says Rotli", () => {
  const words = host.words;
  host.words = { productName: "Synthetic" };
  host.notes = true;
  try {
    const html = everyPane();
    expect(meaningThisApp("Synthetic").filter((sentence) => !html.includes(sentence))).toEqual([]);
    expect(meaningThisApp("Rotli").filter((sentence) => html.includes(sentence))).toEqual([]);
    // a host takes no system-wide chord: its own General note says so by name
    expect(html).toContain("Synthetic takes no system-wide shortcuts, so open it from its menu-bar icon.");
    expect(html).toContain('aria-label="Rebind Hide Synthetic');
    expect(html).toContain('<span class="hklabel">Open or hide Synthetic</span>');
    const left = ABOUT_ROTLI_ITSELF.reduce((rest, sentence) => rest.replaceAll(sentence, ""), html);
    expect(left.match(/.{0,60}Rotli.{0,60}/g)).toBeNull();
  } finally {
    host.words = words!;
    host.notes = false;
  }
});

test("standalone Rotli's Settings sentences are unchanged", () => {
  active = null;
  try {
    const html = everyPane();
    expect(meaningThisApp("Rotli").filter((sentence) => !html.includes(sentence))).toEqual([]);
  } finally {
    active = host;
  }
});

/** Renders Settings started on `pane`, and what it set the pane to meanwhile. */
const startedOn = (pane: string) => {
  selectedPane = pane;
  paneSets.length = 0;
  return { html: render(), set: [...paneSets] };
};

test("a host pane its capability hides has no row, and Settings shows General in its place", () => {
  const shown = startedOn("gated");
  expect(navLabels(shown.html)).toContain("Gated");
  expect(shown.html).toContain('<h3 class="set-banner-title">Gated</h3>');
  expect(shown.set).toEqual([]);
  capable = false;
  try {
    // read again on this render: the same open Settings would do the same
    const hidden = startedOn("gated");
    expect(navLabels(hidden.html)).not.toContain("Gated");
    expect(hidden.html).not.toContain("Gated</h3>");
    expect(hidden.html).toContain('<h3 class="set-banner-title">General</h3>');
    // set for good, so the pane coming back doesn't pull the person back to it
    expect(hidden.set).toEqual(["general"]);
  } finally {
    capable = true;
  }
});

test("a host pane opens another pane by id, Rotli's or the host's, never a hidden one", () => {
  startedOn("synthetic");
  paneSets.length = 0;
  links.at(-1)?.("connections");
  links.at(-1)?.("gated");
  expect(paneSets).toEqual(["connections", "gated"]);
  paneSets.length = 0;
  // a notes pane this build doesn't show, a pane hidden since the render, and
  // no pane at all (a built app ignores a typo): nothing moves
  capable = false;
  try {
    for (const id of ["location", "gated", "nowhere"]) links.at(-1)?.(id);
    expect(paneSets).toEqual([]);
    capable = true;
    links.at(-1)?.("gated");
    expect(paneSets).toEqual(["gated"]);
  } finally {
    capable = true;
  }
});
