import { expect, test } from "bun:test";

import type { Graph } from "../../graph/model";
import { graphFingerprint } from "./graphRenderer";

const graph: Graph = {
  nodes: [
    { id: "a", title: "Alpha", secure: false, degree: 1 },
    { id: "b", title: "Beta", secure: false, degree: 1 },
    { id: "c", title: "Gamma", secure: true, degree: 0 },
  ],
  edges: [
    { source: "a", target: "b", suggested: false },
    { source: "c", target: "a", suggested: true },
  ],
};

test("the layout key ignores row order, titles, and the Librarian's lines", () => {
  const reordered: Graph = {
    nodes: [...graph.nodes].reverse().map((node) => ({ ...node, title: `${node.title} renamed` })),
    edges: [{ source: "b", target: "a", suggested: false }],
  };
  expect(graphFingerprint(reordered)).toBe(graphFingerprint(graph));
});

test("a new note, a new written link, or a dot's size change re-lays it out", () => {
  const base = graphFingerprint(graph);
  expect(
    graphFingerprint({
      ...graph,
      nodes: [...graph.nodes, { id: "d", title: "D", secure: false, degree: 0 }],
    }),
  ).not.toBe(base);
  expect(
    graphFingerprint({ ...graph, edges: [...graph.edges, { source: "b", target: "c", suggested: false }] }),
  ).not.toBe(base);
  expect(
    graphFingerprint({
      ...graph,
      nodes: graph.nodes.map((node) => (node.id === "c" ? { ...node, degree: 3 } : node)),
    }),
  ).not.toBe(base);
});
