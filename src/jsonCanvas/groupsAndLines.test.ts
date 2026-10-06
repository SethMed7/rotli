import { expect, test } from "bun:test";

import type { CanvasDoc } from "./model";
import { edgeMidpoint, groupAround, growGroupAround, setLabel } from "./workflow";

const two: CanvasDoc = {
  nodes: [
    { id: "a", type: "text", text: "", x: 0, y: 0, width: 100, height: 50 },
    { id: "b", type: "text", text: "", x: 200, y: 100, width: 100, height: 50 },
  ],
  edges: [{ id: "e", fromNode: "a", fromSide: "right", toNode: "b", toSide: "left", label: "old" }],
};

test("a group gathers the chosen cards with room around them, beneath everything", () => {
  const grouped = groupAround(two, ["a", "b"], () => "g");
  expect(grouped.id).toBe("g");
  expect(grouped.doc.nodes[0]).toEqual({ id: "g", type: "group", x: -32, y: -32, width: 364, height: 214 });
  expect(grouped.doc.nodes.slice(1)).toEqual(two.nodes);
  // nothing chosen, nothing made
  expect(groupAround(two, ["missing"])).toEqual({ doc: two, id: null });
});

test("groups and lines take a name; an empty name leaves none in the file", () => {
  const grouped = groupAround(two, ["a"], () => "g").doc;
  const named = setLabel(setLabel(grouped, "g", "  Reading  "), "e", "cites");
  expect(named.nodes[0]).toMatchObject({ label: "Reading" });
  expect(named.edges[0]?.label).toBe("cites");
  const cleared = setLabel(named, "e", " ");
  expect(cleared.edges[0]).not.toHaveProperty("label");
  // a text card never gets a label
  expect(setLabel(two, "a", "x").nodes[0]).not.toHaveProperty("label");
});

test("a line's handle sits midway between the sides it joins", () => {
  expect(edgeMidpoint(two, two.edges[0]!)).toEqual({ x: 150, y: 75 });
  expect(edgeMidpoint({ nodes: [], edges: [] }, two.edges[0]!)).toBeNull();
});

test("a card written on a group's floor grows the group to hold it", () => {
  const grouped = groupAround(two, ["a"], () => "g").doc;
  const spilled: CanvasDoc = {
    ...grouped,
    nodes: [...grouped.nodes, { id: "n", type: "text", text: "", x: 50, y: 60, width: 100, height: 80 }],
  };
  const grown = growGroupAround(spilled, "g", "n");
  expect(grown.nodes[0]).toMatchObject({ x: -32, y: -32, width: 198, height: 188 });
  expect(growGroupAround(spilled, "g", "missing")).toBe(spilled);
});
