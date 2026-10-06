import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";

import { parseCanvas } from "../../jsonCanvas/model";
import { CanvasEditor, edgePath } from "./canvasEditor";

const parsed = parseCanvas(`{
\t"nodes":[
\t\t{"id":"t","type":"text","text":"# Idea\\n\\nWrite it down","x":0,"y":0,"width":200,"height":120,"color":"3"},
\t\t{"id":"n","type":"file","file":"wiki/Books.md","x":400,"y":0,"width":300,"height":200},
\t\t{"id":"s","type":"file","file":"wiki/Secret.md","x":0,"y":300,"width":300,"height":200},
\t\t{"id":"m","type":"file","file":"wiki/Gone.md","x":400,"y":300,"width":300,"height":200}
\t],
\t"edges":[{"id":"e","fromNode":"t","fromSide":"right","toNode":"n","toSide":"left","label":"cites"}]
}`);
if (!parsed.ok) throw new Error(parsed.error);
const doc = parsed.doc;

const render = () =>
  renderToStaticMarkup(
    <CanvasEditor
      doc={doc}
      onChange={() => {}}
      noteFor={(path) =>
        path === "wiki/Books.md"
          ? { title: "Books", body: "# Books\n\nThe shelf.", secure: false }
          : path === "wiki/Secret.md"
            ? { title: "Secret", body: "the code is 1234", secure: true }
            : null
      }
      resolveLink={() => null}
      onOpenNote={() => {}}
    />,
  );

test("cards name themselves for screen readers, color and kind included", () => {
  const markup = render();
  expect(markup).toContain('aria-label="Text card, yellow: Idea"');
  expect(markup).toContain('aria-label="Note card: Books"');
  expect(markup).toContain('aria-label="Note card: Gone (missing)"');
  expect(markup).toContain("Canvas with 4 cards and 1 lines.");
});

test("a note card shows the note; a secure one shows only its title; a missing one keeps its place", () => {
  const markup = render();
  expect(markup).toContain("The shelf.");
  expect(markup).toContain("Secure note. Open it to read.");
  expect(markup).not.toContain("the code is 1234");
  expect(markup).toContain("This note isn’t in the vault anymore.");
  // no toolbar at rest: the only text outside cards is the edge label
  expect(markup).not.toContain("jc-empty");
  // a named line shows its name on its handle, and says what it joins
  expect(markup).toContain(">cites</button>");
  expect(markup).toContain('aria-label="Line from Idea to Books, cites"');
});

test("an empty canvas says how to begin, and lines curve out of the sides they name", () => {
  const empty = renderToStaticMarkup(
    <CanvasEditor
      doc={{ nodes: [], edges: [] }}
      onChange={() => {}}
      noteFor={() => null}
      resolveLink={() => null}
      onOpenNote={() => {}}
    />,
  );
  expect(empty).toContain("Double-click anywhere to write a card.");
  expect(edgePath(doc, doc.edges[0]!)).toBe("M 200 60 C 282 60, 318 100, 400 100");
});

test("a preset colour paints through a theme token; another app's hex rides along only when valid", () => {
  // the Obsidian fixture's link card carries another app's hex colour
  const fixture = parseCanvas(
    readFileSync(new URL("../../jsonCanvas/fixtures/obsidian.canvas", import.meta.url), "utf8"),
  );
  if (!fixture.ok) throw new Error(fixture.error);
  const hex = fixture.doc.nodes.find((node) => node.type === "link")?.color ?? "";
  const doc = {
    nodes: [
      { id: "p", type: "text" as const, text: "preset", x: 0, y: 0, width: 100, height: 60, color: "4" },
      { id: "h", type: "text" as const, text: "hex", x: 200, y: 0, width: 100, height: 60, color: hex },
      {
        id: "x",
        type: "text" as const,
        text: "junk",
        x: 400,
        y: 0,
        width: 100,
        height: 60,
        color: "red;x:y",
      },
    ],
    edges: [],
  };
  const markup = renderToStaticMarkup(
    <CanvasEditor
      doc={doc}
      onChange={() => {}}
      noteFor={() => null}
      resolveLink={() => null}
      onOpenNote={() => {}}
    />,
  );
  expect(markup).toContain('data-colour="4"');
  expect(markup).toContain(`--card-colour:${hex}`);
  // a value that isn't a colour never reaches the style or the attribute
  expect(markup).not.toContain("x:y");
});

test("an image or PDF card from another app is a file card, never a missing note", () => {
  const markup = renderToStaticMarkup(
    <CanvasEditor
      doc={{
        nodes: [{ id: "i", type: "file", file: "attachments/Map.png", x: 0, y: 0, width: 200, height: 120 }],
        edges: [],
      }}
      onChange={() => {}}
      noteFor={() => null}
      resolveLink={() => null}
      onOpenNote={() => {}}
    />,
  );
  expect(markup).toContain('aria-label="File card: Map.png"');
  expect(markup).toContain("A file in your vault.");
  expect(markup).not.toContain("isn’t in the vault anymore");
});
