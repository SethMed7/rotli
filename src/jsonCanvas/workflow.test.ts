import { expect, test } from "bun:test";

import type { CanvasDoc } from "./model";
import {
  CARD,
  MIN_CARD,
  addFile,
  addText,
  anchor,
  bounds,
  bringToFront,
  connect,
  facingSide,
  moveNodes,
  nudgeFor,
  removeItems,
  resizeNode,
  setText,
} from "./workflow";

const ids = (...list: string[]) => {
  let at = 0;
  return () => list[at++] ?? `id${at}`;
};

test("cards land centered where you asked, with fresh ids, on top", () => {
  const empty: CanvasDoc = { nodes: [], edges: [] };
  const first = addText(empty, 100, 100, "hello", ids("a"));
  expect(first.doc.nodes[0]).toMatchObject({ id: "a", x: 100 - CARD.width / 2, y: 100 - CARD.height / 2 });
  // a taken id is skipped
  const second = addFile(first.doc, 0, 0, "wiki/Books.md", ids("a", "b"));
  expect(second.id).toBe("b");
  expect(second.doc.nodes.map((node) => node.id)).toEqual(["a", "b"]);
  expect(setText(second.doc, "a", "changed").nodes[0]).toMatchObject({ text: "changed" });
  // setText never turns a note card into text
  expect(setText(second.doc, "b", "x").nodes[1]).not.toHaveProperty("text");
});

test("moving a group carries what sits inside it; resizing keeps a minimum", () => {
  const doc: CanvasDoc = {
    nodes: [
      { id: "g", type: "group", x: 0, y: 0, width: 500, height: 500 },
      { id: "in", type: "text", text: "", x: 10, y: 10, width: 100, height: 100 },
      { id: "out", type: "text", text: "", x: 600, y: 0, width: 100, height: 100 },
    ],
    edges: [],
  };
  const moved = moveNodes(doc, ["g"], 20, 5);
  expect(moved.nodes.map((node) => [node.id, node.x, node.y])).toEqual([
    ["g", 20, 5],
    ["in", 30, 15],
    ["out", 600, 0],
  ]);
  expect(resizeNode(doc, "in", 10, 10).nodes[1]).toMatchObject(MIN_CARD);
});

test("lines leave from the facing sides, never loop, never double", () => {
  const doc: CanvasDoc = {
    nodes: [
      { id: "a", type: "text", text: "", x: 0, y: 0, width: 100, height: 100 },
      { id: "b", type: "text", text: "", x: 400, y: 20, width: 100, height: 100 },
      { id: "c", type: "text", text: "", x: 0, y: 400, width: 100, height: 100 },
    ],
    edges: [],
  };
  const joined = connect(doc, "a", "b", ids("e"));
  expect(joined.doc.edges).toEqual([
    { id: "e", fromNode: "a", fromSide: "right", toNode: "b", toSide: "left" },
  ]);
  expect(connect(joined.doc, "b", "a").id).toBeNull();
  expect(connect(doc, "a", "a").id).toBeNull();
  expect(facingSide(doc.nodes[0]!, doc.nodes[2]!)).toBe("bottom");
  expect(anchor(doc.nodes[0]!, "right")).toEqual({ x: 100, y: 50 });
  // removing a card removes its lines
  expect(removeItems(joined.doc, ["b"]).edges).toEqual([]);
  expect(removeItems(joined.doc, ["e"]).nodes).toHaveLength(3);
});

test("touching a card lifts it, groups staying beneath; bounds cover every card", () => {
  const doc: CanvasDoc = {
    nodes: [
      { id: "a", type: "text", text: "", x: -10, y: 0, width: 100, height: 100 },
      { id: "g", type: "group", x: 0, y: 0, width: 50, height: 50 },
      { id: "b", type: "text", text: "", x: 200, y: 300, width: 100, height: 100 },
    ],
    edges: [],
  };
  expect(bringToFront(doc, ["a", "g"]).nodes.map((node) => node.id)).toEqual(["b", "g", "a"]);
  expect(bringToFront(doc, ["missing"])).toBe(doc);
  expect(bounds(doc)).toEqual({ x: -10, y: 0, width: 310, height: 400 });
  expect(bounds({ nodes: [], edges: [] })).toBeNull();
});

test("only a bare or ⇧ arrow nudges; ⌥, ⌘, and ⌃ arrows are other commands", () => {
  const key = (mods: Partial<KeyboardEvent> = {}) => ({
    key: "ArrowRight",
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ctrlKey: false,
    ...mods,
  });
  expect(nudgeFor(key())).toEqual([10, 0]);
  expect(nudgeFor(key({ shiftKey: true }))).toEqual([50, 0]);
  // resize, the app's tab and pane keys
  expect(nudgeFor(key({ altKey: true }))).toBeNull();
  expect(nudgeFor(key({ metaKey: true }))).toBeNull();
  expect(nudgeFor(key({ ctrlKey: true }))).toBeNull();
  expect(nudgeFor(key({ key: "a" }))).toBeNull();
});
