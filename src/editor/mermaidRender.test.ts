import { afterAll, expect, mock, test } from "bun:test";

const liveMermaid = { ...(await import("mermaid")) };
const rendered: string[] = [];
const securityAtRender: unknown[] = [];
let securityLevel: unknown;
await mock.module("mermaid", () => ({
  default: {
    initialize: (config: { securityLevel?: unknown }) => {
      securityLevel = config.securityLevel;
    },
    render: async (_id: string, code: string) => {
      rendered.push(code);
      securityAtRender.push(securityLevel);
      return { svg: "<svg></svg>" };
    },
  },
}));
const { renderMermaidElement } = await import("./mermaidRender");
const originalDocument = globalThis.document;
Object.assign(globalThis, {
  document: {
    createElement: () => ({ className: "", textContent: "", innerHTML: "" }),
    getElementById: () => null,
  },
});
afterAll(async () => {
  Object.assign(globalThis, { document: originalDocument });
  await mock.module("mermaid", () => liveMermaid);
});

const payloads = [
  'flowchart LR\nA@{ img: "/app/index.html?note=synthetic-private", w: 40, h: 40 }',
  'flowchart LR\nA@{ shape: image, img: "relative.png" }',
  'flowchart LR\nA@{ shape: icon, icon: "fa:house" }',
  'flowchart LR\nA["<img src=relative.png>"]',
  "flowchart LR\nclassDef x fill:url(relative.png)",
  'flowchart LR\nclick A href "relative.html"',
  "flowchart LR\nclick A callback",
  'flowchart LR\nA["https://example.com/synthetic-private"]',
  'flowchart LR\nA["//example.com/synthetic-private"]',
  'flowchart LR\nA["#60;img src=/app/synthetic-private#62;"]',
  'flowchart LR\nA["<a href=relative.html>link</a>"]',
];
for (const code of payloads)
  test(`web refuses network-bearing Mermaid before renderer: ${code}`, async () => {
    rendered.length = 0;
    const element = await renderMermaidElement(code, { dark: false, id: "test", platform: "web" });
    expect(rendered).toEqual([]);
    expect(element.textContent).toContain("privacy");
  });
test("ordinary web diagrams and desktop image diagrams retain their renderer", async () => {
  for (const [code, platform] of [
    ["flowchart LR\nA --> B", "web"],
    ['flowchart LR\nA["one<br>two"] --> B["R&D / Q3"]', "web"],
    [payloads[0]!, "desktop"],
  ] as const) {
    rendered.length = 0;
    await renderMermaidElement(code, { dark: false, id: "test", platform });
    expect(rendered).toEqual([code]);
  }
});

// The rendered SVG goes into innerHTML. That is safe only because Mermaid's
// "strict" level sanitizes every label and the whole SVG (DOMPurify) and turns
// off click handlers, and a diagram's own init directive can't change it
// (securityLevel is one of Mermaid's secure keys). Mermaid's config is global
// and the board converter initializes it too, so the level is set again before
// every render. e2e/mermaid-workspace.spec.ts renders a hostile diagram.
test("every render sets Mermaid's strict security level before Mermaid reads the source", async () => {
  securityAtRender.length = 0;
  for (const code of [
    "flowchart LR\nA --> B",
    '%%{init: {"securityLevel": "loose"}}%%\nflowchart LR\nA --> B',
  ]) {
    securityLevel = "loose";
    await renderMermaidElement(code, { dark: false, id: "test", platform: "desktop" });
  }
  expect(securityAtRender).toEqual(["strict", "strict"]);
});
