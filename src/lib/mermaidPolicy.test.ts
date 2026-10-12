import { expect, test } from "bun:test";

import { mermaidRefusal } from "./mermaidPolicy";

const refused = [
  'flowchart LR\nA@{ img: "/app/index.html?note=synthetic-private", w:40, h:40 }',
  "flowchart LR\nA@{ shape: icon }",
  "flowchart LR\nA@{ shape: image }",
  "flowchart LR\nA@{ shape: iconSquare }",
  "flowchart LR\nA@{ shape: iconCircle }",
  "flowchart LR\nA@{ shape: iconRounded }",
  "flowchart LR\nA@{ shape: imageSquare }",
  'flowchart LR\nA["<IMG src=relative.png>"]',
  "classDef x fill:URL(relative.png)",
  'click A href "relative.html"',
  "click A callback",
  'A["https://example.com"]',
  'A["http://example.com"]',
  'A["//example.com"]',
  "A[//example.com]",
  "links: relative.html",
  '%%{init: {"themeCSS":"@import "relative.css""}}%%\nflowchart LR\nA-->B',
  "---\nconfig:\n  themeCSS: url(relative.png)\n---\nflowchart LR\nA-->B",
  'flowchart LR\nA["&lt;img src=relative.png&gt;"]',
  'flowchart LR\nA["#60;img src=relative.png#62;"]',
  'flowchart LR\nA["&#x3c;img src=relative.png>"]',
  "classDef x fill:u\\72l(relative.png)",
  "flowchart LR\nA[\"<span style='background:red'>x</span>\"]",
  'classDiagram\nclass A\nlink A "relative.html"',
  "flowchart LR\nA@{ shape: 'image' }",
  String.raw`A["\x2fapp/index.html"]`,
  'flowchart LR\nA["&amp;lt;img src=relative.png&amp;gt;"]',
  "A[&amp;lt;img>]",
  'flowchart LR\nA["![](/app/index.html?note=synthetic-private)"]',
  "![](/app/...?note=synthetic-private)",
  'flowchart LR\nA["file://vault/private.md"]',
  'flowchart LR\nA["data:image/png;base64,AA=="]',
  'flowchart LR\nA["ws://example.com"]',
  'flowchart LR\nA["ftp://example.com"]',
  'flowchart LR\nA["wss://example.com"]',
  'flowchart LR\nA["src=//example.com/private.png"]',
];
test("the pure web preflight refuses the entire network-bearing source matrix", () => {
  for (const source of refused) {
    expect(mermaidRefusal(source, "web")).toContain("privacy");
    expect(mermaidRefusal(source, "desktop")).toBeNull();
  }
});
test("entity nesting past the decoder limit is refused", () => {
  let source = "&lt;img src=relative.png&gt;";
  for (let i = 0; i < 9; i += 1) source = source.replaceAll("&", "&amp;");
  expect(mermaidRefusal(`flowchart LR\nA["${source}"]`, "web")).toContain("privacy");
});
test("ordinary diagrams, bidirectional edges and arithmetic labels remain available", () => {
  for (const source of [
    "flowchart LR\nA --> B",
    "flowchart LR\nA <--> B",
    'flowchart LR\nA["1/2"]',
    "sequenceDiagram\nAlice->>Bob: Hello",
    'pie\n"Work": 40',
    'flowchart LR\nA["one<br>two"] --> B["<b>bold</b> and <i>italic</i>"]',
    'flowchart LR\nA["Click here"] --> B["Links page"] --> C["Image upload"] --> D["Icon set"]',
    'flowchart LR\nA["R&D"] --> B["A / B"] --> C["Tom &amp; Jerry"]',
    "%%{init: {'theme':'dark'}}%%\nflowchart LR\nA-->B",
    "---\ntitle: Synthetic plan\n---\nflowchart LR\nA-->B",
    'flowchart LR\nA["/app/index.html as plain text"]',
    "flowchart LR\nA[click] --> Link",
    'flowchart LR\nA["C://Users as plain text"]',
    "A[C://Users]",

    "",
  ])
    expect(mermaidRefusal(source, "web")).toBeNull();
});
