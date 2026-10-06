import { expect, test } from "bun:test";

import type { NoteSummary } from "../types";
import {
  RESTING_LABELS,
  buildGraph,
  labelVisible,
  matchingNodes,
  neighborhood,
  restingLabels,
  restingLineAlpha,
  writtenOnly,
} from "./model";
import { scopedGraph } from "./workflow";

const note = (id: string, title: string, extra: Partial<NoteSummary> = {}): NoteSummary => ({
  id,
  title,
  snippet: "",
  folderId: "Inbox",
  createdAt: 0,
  updatedAt: 0,
  pinned: false,
  ...extra,
});

const notes = [
  note("a", "Books"),
  note("b", "Philosophy", { aliases: ["phil"] }),
  note("c", "René Descartes"),
  note("d", "Loose end"),
  note("chat", "A chat"),
  note("dup1", "Twin"),
  note("dup2", "Twin"),
];

test("edges follow the editor's resolver: aliases, headings, and labels resolve; missing and ambiguous draw nothing", () => {
  const graph = buildGraph(notes, [
    {
      noteId: "a",
      secure: false,
      targets: ["Philosophy", "René Descartes#Life", "Nowhere", "Twin", "a"],
      suggested: [],
    },
    { noteId: "b", secure: false, targets: ["phil", "Books|my books", "A chat"], suggested: [] },
    { noteId: "c", secure: true, targets: [], suggested: [] },
    { noteId: "d", secure: false, targets: [], suggested: [] },
  ]);
  // b→a duplicates a→b (one undirected line); a→a and b→b (self) draw nothing;
  // the chat resolves but isn't a node, so no edge
  expect(graph.edges).toEqual([
    { source: "a", target: "b", suggested: false },
    { source: "a", target: "c", suggested: false },
  ]);
  expect(graph.nodes.map((n) => [n.id, n.degree, n.secure])).toEqual([
    ["a", 2, false],
    ["b", 1, false],
    ["c", 1, true],
    ["d", 0, false],
  ]);
});

test("the local graph keeps the center and its hops; an unknown center shows nothing", () => {
  const graph = buildGraph(notes, [
    { noteId: "a", secure: false, targets: ["Philosophy"], suggested: [] },
    { noteId: "b", secure: false, targets: ["René Descartes"], suggested: [] },
    { noteId: "c", secure: false, targets: [], suggested: [] },
    { noteId: "d", secure: false, targets: [], suggested: [] },
  ]);
  expect(neighborhood(graph, "a", 1).nodes.map((n) => n.id)).toEqual(["a", "b"]);
  expect(neighborhood(graph, "a", 2).nodes.map((n) => n.id)).toEqual(["a", "b", "c"]);
  expect(neighborhood(graph, "a", 2).edges).toHaveLength(2);
  expect(neighborhood(graph, "gone", 2)).toEqual({ nodes: [], edges: [] });
  expect(scopedGraph(graph, { kind: "all" })).toBe(graph);
  expect(scopedGraph(graph, { kind: "around", noteId: "d", depth: 2 }).nodes.map((n) => n.id)).toEqual(["d"]);
});

test("the Librarian's links draw apart, never double a written link, and switch off cleanly", () => {
  const graph = buildGraph(notes, [
    {
      noteId: "a",
      secure: false,
      targets: ["Philosophy"],
      suggested: ["Philosophy", "René Descartes", "Nowhere"],
    },
    { noteId: "b", secure: false, targets: [], suggested: ["Books"] },
    { noteId: "c", secure: false, targets: [], suggested: [] },
    { noteId: "d", secure: false, targets: [], suggested: ["Books"] },
  ]);
  // a–b is written (the Librarian agreeing adds nothing); a–c and d–a are only suggested
  expect(graph.edges).toEqual([
    { source: "a", target: "b", suggested: false },
    { source: "a", target: "c", suggested: true },
    { source: "d", target: "a", suggested: true },
  ]);
  // suggested links never change a dot's size or which labels rest
  expect(graph.nodes.map((n) => [n.id, n.degree])).toEqual([
    ["a", 1],
    ["b", 1],
    ["c", 0],
    ["d", 0],
  ]);
  // switched on, a local graph reaches through them; switched off, it doesn't
  expect(scopedGraph(graph, { kind: "around", noteId: "d", depth: 1 }).nodes.map((n) => n.id)).toEqual([
    "a",
    "d",
  ]);
  expect(scopedGraph(graph, { kind: "around", noteId: "d", depth: 1 }, false).nodes.map((n) => n.id)).toEqual(
    ["d"],
  );
  expect(writtenOnly(graph).edges).toEqual([{ source: "a", target: "b", suggested: false }]);
  const plain = writtenOnly(graph);
  expect(writtenOnly(plain)).toBe(plain);
});

test("search matches every word of a title, case-insensitively", () => {
  const graph = buildGraph(notes, [
    { noteId: "a", secure: false, targets: [], suggested: [] },
    { noteId: "c", secure: false, targets: [], suggested: [] },
  ]);
  expect([...matchingNodes(graph, "rené DESC")]).toEqual(["c"]);
  expect(matchingNodes(graph, "  ").size).toBe(0);
});

test("labels stay quiet: a few hubs at rest, everything when close or emphasized", () => {
  const hubNode = { id: "h", title: "Hub", secure: false, degree: 9 };
  const leaf = { id: "l", title: "Leaf", secure: false, degree: 1 };
  const rest = {
    zoom: 1,
    resting: new Set(["h"]),
    emphasized: new Set<string>(),
    matched: new Set<string>(),
  };
  expect(labelVisible(hubNode, rest)).toBe(true);
  expect(labelVisible(leaf, rest)).toBe(false);
  expect(labelVisible(hubNode, { ...rest, zoom: 0.4 })).toBe(false);
  expect(labelVisible(leaf, { ...rest, zoom: 2 })).toBe(true);
  expect(labelVisible(leaf, { ...rest, emphasized: new Set(["l"]) })).toBe(true);
  expect(labelVisible(leaf, { ...rest, zoom: 0.2, matched: new Set(["l"]) })).toBe(true);
});

test("a small graph names every note; a big one names only its dozen most-linked", () => {
  const leaf = { id: "l", title: "Leaf", secure: false, degree: 1 };
  expect(restingLabels({ nodes: [], edges: [] }).size).toBe(0);
  expect([...restingLabels({ nodes: [leaf], edges: [] })]).toEqual(["l"]);
  const big = Array.from({ length: 200 }, (_, at) => ({
    ...leaf,
    id: `n${at}`,
    degree: at < 40 ? 5 + at : 1,
  }));
  const named = restingLabels({ nodes: big, edges: [] });
  expect(named.size).toBe(RESTING_LABELS);
  expect(named.has("n39")).toBe(true);
  expect(named.has("n0")).toBe(false);
  expect(restingLineAlpha(10)).toBe(0.9);
  expect(restingLineAlpha(5000)).toBe(0.35);
});

test("a big sparse vault still rests with names: the most-linked, then the most recent", () => {
  const many = Array.from({ length: 40 }, (_, at) => note(`n${at}`, `Note ${at}`));
  const sparse = buildGraph(many, [
    ...many.map((each) => ({
      noteId: each.id,
      secure: false,
      targets: [] as string[],
      suggested: [] as string[],
    })),
  ]);
  // only one pair is linked
  const linked = buildGraph(many, [
    { noteId: "n5", secure: false, targets: ["Note 6"], suggested: [] },
    ...many
      .filter((each) => each.id !== "n5")
      .map((each) => ({ noteId: each.id, secure: false, targets: [], suggested: [] })),
  ]);
  expect(restingLabels(sparse).size).toBe(RESTING_LABELS);
  const resting = restingLabels(linked);
  expect(resting.size).toBe(RESTING_LABELS);
  expect(resting.has("n5") && resting.has("n6")).toBe(true);
});
