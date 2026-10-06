import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { colorName, fileTitle, parseCanvas, serializeCanvas } from "./model";

// the shape Obsidian writes (tabs, one item per line), with every node type,
// an unknown type, an extra field, a hex color, and a top-level key from
// another app — a real .canvas file, so the hex is content, not a style
const OBSIDIAN = readFileSync(new URL("./fixtures/obsidian.canvas", import.meta.url), "utf8");

test("a canvas Obsidian wrote round-trips byte for byte, unknown parts included", () => {
  const parsed = parseCanvas(OBSIDIAN);
  if (!parsed.ok) throw new Error(parsed.error);
  expect(parsed.doc.nodes.map((node) => node.type)).toEqual(["group", "text", "file", "link", "unknown"]);
  expect(parsed.doc.nodes[4]).toMatchObject({
    type: "unknown",
    rawType: "widget",
    extra: { pluginData: { k: 1 } },
  });
  expect(parsed.doc.edges[0]).toMatchObject({
    fromSide: "right",
    label: "cites",
    extra: { styleAttributes: {} },
  });
  expect(serializeCanvas(parsed.doc)).toBe(OBSIDIAN);
});

test("an empty file is an empty canvas, and positions save as whole pixels", () => {
  const empty = parseCanvas("  \n");
  expect(empty).toEqual({ ok: true, doc: { nodes: [], edges: [] } });
  expect(serializeCanvas({ nodes: [], edges: [] })).toBe('{\n\t"nodes":[],\n\t"edges":[]\n}');
  const doc = {
    nodes: [{ id: "t", type: "text" as const, text: "", x: 1.6, y: -2.4, width: 99.5, height: 50 }],
    edges: [],
  };
  expect(serializeCanvas(doc)).toContain('"x":2,"y":-2,"width":100,"height":50');
});

test("a broken canvas is refused with a reason instead of opening half-read", () => {
  const refused = (text: string) => {
    const parsed = parseCanvas(text);
    return parsed.ok ? null : parsed.error;
  };
  expect(refused("{nope")).toBe("This canvas isn’t valid JSON.");
  expect(refused("[]")).toBe("This canvas isn’t a JSON Canvas object.");
  expect(refused('{"nodes":{}}')).toBe("This canvas’s nodes or edges aren’t lists.");
  expect(refused('{"nodes":[{"id":"a","type":"text","x":0,"y":0,"width":1}]}')).toContain(
    "no position or size",
  );
  expect(refused('{"nodes":[{"id":"a","type":"file","x":0,"y":0,"width":1,"height":1}]}')).toContain(
    "has no file",
  );
  const twin = '{"id":"a","type":"text","text":"","x":0,"y":0,"width":1,"height":1}';
  expect(refused(`{"nodes":[${twin},${twin}]}`)).toContain("two items share id a");
  expect(refused(`{"nodes":[${twin}],"edges":[{"id":"e","fromNode":"a","toNode":"gone"}]}`)).toContain(
    "points at a missing card",
  );
});

test("colors read as names for the accessible label; note cards title by file name", () => {
  expect(colorName("1")).toBe("red");
  expect(colorName("6")).toBe("purple");
  // another app's hex pick (the fixture's link card) reads as custom
  const parsed = parseCanvas(OBSIDIAN);
  if (!parsed.ok) throw new Error(parsed.error);
  expect(colorName(parsed.doc.nodes[3]?.color)).toBe("custom");
  expect(colorName(undefined)).toBeNull();
  expect(fileTitle("wiki/Projects/Q3 plan.md")).toBe("Q3 plan");
  expect(fileTitle("board.canvas")).toBe("board.canvas");
});
