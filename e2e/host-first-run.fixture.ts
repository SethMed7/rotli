// A synthetic host's first run, for host-identity.fixture.ts: the plain look,
// two steps (You, then the folder as "Connect"), tool cards in You, and a
// connect row above the folder that holds the step until it's connected.
// `?hoststep` adds a step of the host's own between them. The tools and the
// service are invented; nothing here names a real product.

import { createElement as h, useState } from "react";

import type { HostFirstRun } from "../src/host/registry";

const TOOLS = [
  {
    id: "sketchpad",
    name: "Sketchpad",
    what: "Quick drawings beside your notes.",
    download: "Nothing to download.",
  },
  {
    id: "weather",
    name: "Weather strip",
    what: "Today's forecast in the corner.",
    download: "Nothing to download.",
  },
  { id: "reader", name: "Reading list", what: "Links saved for later.", download: "Downloads its reader." },
] as const;

function ToolCards() {
  const [on, setOn] = useState<Record<string, boolean>>({ sketchpad: true, weather: true, reader: false });
  return h(
    "div",
    { className: "synthetic-tools", role: "group", "aria-label": "Example Host tools" },
    TOOLS.map((tool, index) =>
      h(
        "label",
        { key: tool.id, className: "synthetic-tool" },
        h("span", { className: "synthetic-tool-n" }, String(index + 1)),
        h("strong", null, tool.name),
        h("input", {
          type: "checkbox",
          role: "switch",
          checked: on[tool.id] ?? false,
          onChange: () => setOn((now) => ({ ...now, [tool.id]: !now[tool.id] })),
        }),
        h("span", null, tool.what),
        h("span", null, tool.download),
      ),
    ),
  );
}

// the connect row's state: the folder step moves on once it is connected
let connected = false;
const listeners = new Set<() => void>();
const setConnected = (next: boolean) => {
  connected = next;
  for (const listener of listeners) listener();
};

function ConnectRow() {
  const [, rerender] = useState(0);
  return h(
    "div",
    { className: "setup-row" },
    h(
      "span",
      { className: "setup-row-copy" },
      h("strong", null, "Example Sync"),
      h(
        "span",
        null,
        connected
          ? "Connected. Example Host reads your sync status and nothing else."
          : "Connect once; Example Host reads your sync status and nothing else.",
      ),
    ),
    connected
      ? h("span", { className: "synthetic-connected" }, "Connected")
      : h(
          "button",
          {
            type: "button",
            className: "setup-button secondary",
            onClick: () => {
              setConnected(true);
              rerender((n) => n + 1);
            },
          },
          "Connect",
        ),
  );
}

// the host styles its own blocks; these use Rotli's tokens only
const style = document.createElement("style");
style.textContent = `
.synthetic-tools { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.synthetic-tool { display: grid; grid-template-columns: auto 1fr auto; gap: 4px 8px; align-items: center;
  padding: 12px 14px; border: 1px solid var(--border); border-radius: var(--r-control); background: var(--surface);
  color: var(--text-muted); font-size: 12.5px; }
.synthetic-tool strong { color: var(--text); font-size: 13.5px; }
.synthetic-tool > span:nth-of-type(n + 2) { grid-column: 1 / -1; }
.synthetic-tool-n { font-variant-numeric: tabular-nums; }
.synthetic-connected { color: var(--text-muted); font-size: 12.5px; }
`;
document.head.append(style);

const SyntheticStep = () => h("p", { className: "setup-lede" }, "A step of the host's own, between Rotli's.");

export function syntheticFirstRun(params: URLSearchParams): HostFirstRun {
  const ownStep = params.has("hoststep");
  return {
    plain: true,
    themeChoice: false,
    order: ownStep ? ["you", "synthetic-extra", "vault"] : ["you", "vault"],
    steps: ownStep
      ? [{ id: "synthetic-extra", label: "Extras", title: "One more thing.", Body: SyntheticStep }]
      : [],
    blocks: [
      { step: "you", place: "after", Block: ToolCards },
      {
        step: "vault",
        place: "before",
        Block: ConnectRow,
        ready: () => connected,
        subscribeReady: (onChange) => {
          listeners.add(onChange);
          return () => listeners.delete(onChange);
        },
      },
    ],
    words: {
      you: {
        title: "Make Example Host yours.",
        lede: "Your name and what Example Host does. Themes and the rest wait in Settings, where you can change any of this later.",
        primary: ownStep ? "Continue" : "Connect Example Sync",
      },
      vault: {
        label: "Connect",
        title: "Connect Example Sync, then pick a folder.",
        lede: "Example Host reads your sync status from Example Sync. Your notes are plain files in a folder you choose.",
      },
    },
  };
}
