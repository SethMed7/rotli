// Edits to a canvas, as pure functions over the parsed document: add a text
// or note card, move, resize, connect, remove. Each returns a new document;
// the editor saves whatever comes back. No note is ever touched — a note card
// only names the note's path.

import type { CanvasDoc, CanvasEdge, CanvasNode, CanvasSide, FileNode, GroupNode, TextNode } from "./model";

export const CARD = { width: 260, height: 140 } as const;
export const NOTE_CARD = { width: 320, height: 220 } as const;
export const MIN_CARD = { width: 120, height: 60 } as const;

/** A 16-hex id like Obsidian's. Injected in tests. */
export type MakeId = () => string;
export const randomId: MakeId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );

function freshId(doc: CanvasDoc, makeId: MakeId): string {
  const taken = new Set([...doc.nodes.map((node) => node.id), ...doc.edges.map((edge) => edge.id)]);
  let id = makeId();
  while (taken.has(id)) id = makeId();
  return id;
}

/** A text card centered on (x, y), on top of everything. */
export function addText(doc: CanvasDoc, x: number, y: number, text: string, makeId = randomId) {
  const node: TextNode = {
    id: freshId(doc, makeId),
    type: "text",
    text,
    x: x - CARD.width / 2,
    y: y - CARD.height / 2,
    ...CARD,
  };
  return { doc: { ...doc, nodes: [...doc.nodes, node] }, id: node.id };
}

/** A card for a note (by vault path), centered on (x, y). The same note may
 * sit on a canvas more than once, like Obsidian. */
export function addFile(doc: CanvasDoc, x: number, y: number, file: string, makeId = randomId) {
  const node: FileNode = {
    id: freshId(doc, makeId),
    type: "file",
    file,
    x: x - NOTE_CARD.width / 2,
    y: y - NOTE_CARD.height / 2,
    ...NOTE_CARD,
  };
  return { doc: { ...doc, nodes: [...doc.nodes, node] }, id: node.id };
}

const inside = (node: CanvasNode, group: CanvasNode): boolean =>
  node.x >= group.x &&
  node.y >= group.y &&
  node.x + node.width <= group.x + group.width &&
  node.y + node.height <= group.y + group.height;

/** Move cards by (dx, dy). Moving a group carries every card wholly inside it. */
export function moveNodes(doc: CanvasDoc, ids: readonly string[], dx: number, dy: number): CanvasDoc {
  const moving = new Set(ids);
  for (const group of doc.nodes) {
    if (group.type !== "group" || !moving.has(group.id)) continue;
    for (const node of doc.nodes) if (node.id !== group.id && inside(node, group)) moving.add(node.id);
  }
  return {
    ...doc,
    nodes: doc.nodes.map((node) =>
      moving.has(node.id) ? { ...node, x: node.x + dx, y: node.y + dy } : node,
    ),
  };
}

export function resizeNode(doc: CanvasDoc, id: string, width: number, height: number): CanvasDoc {
  return {
    ...doc,
    nodes: doc.nodes.map((node) =>
      node.id === id
        ? { ...node, width: Math.max(MIN_CARD.width, width), height: Math.max(MIN_CARD.height, height) }
        : node,
    ),
  };
}

export function setText(doc: CanvasDoc, id: string, text: string): CanvasDoc {
  return {
    ...doc,
    nodes: doc.nodes.map((node) => (node.id === id && node.type === "text" ? { ...node, text } : node)),
  };
}

/** The side of `from` that faces `to` — where a line leaves a card. */
export function facingSide(from: CanvasNode, to: CanvasNode): CanvasSide {
  const dx = to.x + to.width / 2 - (from.x + from.width / 2);
  const dy = to.y + to.height / 2 - (from.y + from.height / 2);
  if (Math.abs(dx) * from.height >= Math.abs(dy) * from.width) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
}

/** Join two cards with a line (an arrow at `to`, the spec's default). A card
 * never joins itself, and the same two cards join once. */
export function connect(doc: CanvasDoc, fromId: string, toId: string, makeId = randomId) {
  const from = doc.nodes.find((node) => node.id === fromId);
  const to = doc.nodes.find((node) => node.id === toId);
  const exists = doc.edges.some(
    (edge) =>
      (edge.fromNode === fromId && edge.toNode === toId) ||
      (edge.fromNode === toId && edge.toNode === fromId),
  );
  if (!from || !to || fromId === toId || exists) return { doc, id: null };
  const edge: CanvasEdge = {
    id: freshId(doc, makeId),
    fromNode: fromId,
    fromSide: facingSide(from, to),
    toNode: toId,
    toSide: facingSide(to, from),
  };
  return { doc: { ...doc, edges: [...doc.edges, edge] }, id: edge.id };
}

/** Remove cards and every line touching them, or lines by id. */
export function removeItems(doc: CanvasDoc, ids: readonly string[]): CanvasDoc {
  const gone = new Set(ids);
  return {
    ...doc,
    nodes: doc.nodes.filter((node) => !gone.has(node.id)),
    edges: doc.edges.filter(
      (edge) => !gone.has(edge.id) && !gone.has(edge.fromNode) && !gone.has(edge.toNode),
    ),
  };
}

/** Raise cards to the top of the z-order (selection lifts what you touch). */
export function bringToFront(doc: CanvasDoc, ids: readonly string[]): CanvasDoc {
  const lift = new Set(ids);
  const groupsFirst = (a: CanvasNode, b: CanvasNode) =>
    Number(b.type === "group") - Number(a.type === "group");
  const lifted = doc.nodes.filter((node) => lift.has(node.id)).sort(groupsFirst);
  if (lifted.length === 0) return doc;
  return { ...doc, nodes: [...doc.nodes.filter((node) => !lift.has(node.id)), ...lifted] };
}

/** Gather cards into a new group drawn around them (beneath everything, as
 * groups sit), with room for its label above. Nothing to gather, no group. */
export function groupAround(doc: CanvasDoc, ids: readonly string[], makeId = randomId) {
  const members = doc.nodes.filter((node) => ids.includes(node.id));
  const box = bounds({ nodes: members, edges: [] });
  if (!box) return { doc, id: null };
  const pad = 32;
  const group: GroupNode = {
    id: freshId(doc, makeId),
    type: "group",
    x: box.x - pad,
    y: box.y - pad,
    width: box.width + pad * 2,
    height: box.height + pad * 2,
  };
  return { doc: { ...doc, nodes: [group, ...doc.nodes] }, id: group.id };
}

/** Grow a group just enough to hold a card written on its floor. */
export function growGroupAround(doc: CanvasDoc, groupId: string, cardId: string): CanvasDoc {
  const card = doc.nodes.find((node) => node.id === cardId);
  if (!card) return doc;
  const pad = 16;
  return {
    ...doc,
    nodes: doc.nodes.map((node) => {
      if (node.id !== groupId || node.type !== "group") return node;
      const left = Math.min(node.x, card.x - pad);
      const top = Math.min(node.y, card.y - pad);
      const right = Math.max(node.x + node.width, card.x + card.width + pad);
      const bottom = Math.max(node.y + node.height, card.y + card.height + pad);
      return { ...node, x: left, y: top, width: right - left, height: bottom - top };
    }),
  };
}

/** Name a group or a line; an empty name removes it from the file. */
export function setLabel(doc: CanvasDoc, id: string, label: string): CanvasDoc {
  const named = <T extends { label?: string }>(item: T): T => {
    const { label: _old, ...rest } = item;
    return (label.trim() ? { ...rest, label: label.trim() } : rest) as T;
  };
  return {
    ...doc,
    nodes: doc.nodes.map((node) => (node.id === id && node.type === "group" ? named(node) : node)),
    edges: doc.edges.map((edge) => (edge.id === id ? named(edge) : edge)),
  };
}

/** The middle of a line, where its label and its handle sit. */
export function edgeMidpoint(doc: CanvasDoc, edge: CanvasEdge): { x: number; y: number } | null {
  const from = doc.nodes.find((node) => node.id === edge.fromNode);
  const to = doc.nodes.find((node) => node.id === edge.toNode);
  if (!from || !to) return null;
  const a = anchor(from, edge.fromSide ?? "right");
  const b = anchor(to, edge.toSide ?? "left");
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Where a line meets a card's side (its midpoint). */
export function anchor(node: CanvasNode, side: CanvasSide): { x: number; y: number } {
  switch (side) {
    case "top":
      return { x: node.x + node.width / 2, y: node.y };
    case "bottom":
      return { x: node.x + node.width / 2, y: node.y + node.height };
    case "left":
      return { x: node.x, y: node.y + node.height / 2 };
    case "right":
      return { x: node.x + node.width, y: node.y + node.height / 2 };
  }
}

/** The bounding box of every card, for fit-to-view. */
export function bounds(doc: CanvasDoc): { x: number; y: number; width: number; height: number } | null {
  if (doc.nodes.length === 0) return null;
  const left = Math.min(...doc.nodes.map((node) => node.x));
  const top = Math.min(...doc.nodes.map((node) => node.y));
  const right = Math.max(...doc.nodes.map((node) => node.x + node.width));
  const bottom = Math.max(...doc.nodes.map((node) => node.y + node.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}
