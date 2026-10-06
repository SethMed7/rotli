// The Graph view's domain (exploration 2026-10-05): notes as nodes, the
// wikilinks a person wrote as edges, and the Librarian's related notes (the
// frontmatter `links:` line) as separate "suggested" edges. A projection, never a store — Markdown is
// the only truth, and nothing here is written anywhere. Links resolve through
// the editor's own resolver so a link that opens a note in the editor is the
// same edge here; an ambiguous or missing link draws nothing.

import { buildWikilinkIndex, resolveWikilink } from "../editor/wikilink";
import type { NoteSummary } from "../types";

/** One note's raw outgoing targets — the Rust `corpus_links_list` row and its web twin. */
export interface NoteLinks {
  noteId: string;
  secure: boolean;
  targets: readonly string[];
  /** The raw targets of the frontmatter `links:` line — the Librarian's. */
  suggested: readonly string[];
}

export interface GraphNode {
  id: string;
  title: string;
  /** Titles show; text never does. Drawn hollow so the state isn't color-only. */
  secure: boolean;
  /** Distinct neighbors a person linked, either direction. Librarian links
   * don't count, so they never change a dot's size or which labels rest. */
  degree: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  /** Only the Librarian links these two; no one wrote a link between them.
   * Drawn dashed and fainter, and never pulled on by the layout. */
  suggested: boolean;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const edgeKey = (a: string, b: string): string => (a < b ? `${a}\0${b}` : `${b}\0${a}`);

/** Build the graph. `notes` is everything a link may resolve to (the editor's
 * linkable set); only notes present in `links` become nodes, so a link into a
 * chat, a board, or Archive resolves but draws no edge. Edges are undirected
 * and collapsed: A→B and B→A are one line, and a pair someone linked by hand
 * is never also a suggested line. */
export function buildGraph(notes: readonly NoteSummary[], links: readonly NoteLinks[]): Graph {
  const index = buildWikilinkIndex(notes);
  const byId = new Map(notes.map((note) => [note.id, note] as const));
  const live = new Set(links.map((row) => row.noteId));
  const seen = new Set<string>();
  const edges: GraphEdge[] = [];
  const neighbors = new Map<string, Set<string>>();
  const touch = (a: string, b: string) => {
    const set = neighbors.get(a) ?? new Set<string>();
    set.add(b);
    neighbors.set(a, set);
  };
  const join = (row: NoteLinks, targets: readonly string[], suggested: boolean) => {
    for (const target of targets) {
      const to = resolveWikilink(target, index);
      if (to === null || to === row.noteId || !live.has(to)) continue;
      const key = edgeKey(row.noteId, to);
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source: row.noteId, target: to, suggested });
      if (suggested) continue;
      touch(row.noteId, to);
      touch(to, row.noteId);
    }
  };
  // every written link first, so a pair linked both ways stays written
  for (const row of links) join(row, row.targets, false);
  for (const row of links) join(row, row.suggested, true);
  const nodes = links.map((row) => ({
    id: row.noteId,
    title: byId.get(row.noteId)?.title.trim() || "Untitled",
    secure: row.secure,
    degree: neighbors.get(row.noteId)?.size ?? 0,
  }));
  return { nodes, edges };
}

/** The graph with the Librarian's links switched off. */
export function writtenOnly(graph: Graph): Graph {
  return graph.edges.some((edge) => edge.suggested)
    ? { nodes: graph.nodes, edges: graph.edges.filter((edge) => !edge.suggested) }
    : graph;
}

/** Every node within `depth` hops of `focus` (the local graph). An unknown
 * focus yields an empty graph rather than the whole vault. */
export function neighborhood(graph: Graph, focus: string, depth: number): Graph {
  if (!graph.nodes.some((node) => node.id === focus)) return { nodes: [], edges: [] };
  const adjacent = new Map<string, string[]>();
  for (const { source, target } of graph.edges) {
    adjacent.set(source, [...(adjacent.get(source) ?? []), target]);
    adjacent.set(target, [...(adjacent.get(target) ?? []), source]);
  }
  const keep = new Set([focus]);
  let frontier = [focus];
  for (let hop = 0; hop < depth && frontier.length > 0; hop += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const other of adjacent.get(id) ?? []) {
        if (keep.has(other)) continue;
        keep.add(other);
        next.push(other);
      }
    }
    frontier = next;
  }
  return {
    nodes: graph.nodes.filter((node) => keep.has(node.id)),
    edges: graph.edges.filter((edge) => keep.has(edge.source) && keep.has(edge.target)),
  };
}

/** Ids whose title contains every word of `query` (case-insensitive). Search
 * highlights in place instead of removing nodes, so the layout never jumps. */
export function matchingNodes(graph: Graph, query: string): ReadonlySet<string> {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return new Set();
  return new Set(
    graph.nodes
      .filter((node) => {
        const title = node.title.toLocaleLowerCase();
        return words.every((word) => title.includes(word));
      })
      .map((node) => node.id),
  );
}

/** Up to this many notes, every label shows at rest — a small graph (most
 * local graphs) reads better named than as anonymous dots. */
export const LABEL_ALL_UP_TO = 30;
/** In a bigger graph, only this many of the most-linked notes keep a label at
 * rest. A count, not a degree cutoff: a dense vault must not turn into a
 * wall of words. Everything else labels on hover, keyboard focus, a search
 * match, or close zoom — the calm default the owner asked for. */
export const RESTING_LABELS = 12;

export function restingLabels(graph: Graph): ReadonlySet<string> {
  if (graph.nodes.length <= LABEL_ALL_UP_TO) return new Set(graph.nodes.map((node) => node.id));
  const ranked = graph.nodes.filter((node) => node.degree >= 2).sort((a, b) => b.degree - a.degree);
  return new Set(ranked.slice(0, RESTING_LABELS).map((node) => node.id));
}

export interface LabelContext {
  zoom: number;
  resting: ReadonlySet<string>;
  /** Hovered, keyboard-focused, or the scope's center note. */
  emphasized: ReadonlySet<string>;
  matched: ReadonlySet<string>;
}

export function labelVisible(node: GraphNode, context: LabelContext): boolean {
  if (context.emphasized.has(node.id) || context.matched.has(node.id)) return true;
  if (context.zoom >= 1.8) return true;
  return context.zoom >= 0.6 && context.resting.has(node.id);
}

/** How strongly lines draw at rest: fainter as a graph gets denser, so a
 * thousand links read as texture rather than a scribble. */
export function restingLineAlpha(edgeCount: number): number {
  return Math.min(0.9, Math.max(0.35, 1.1 - edgeCount / 800));
}

/** Dot radius in graph units: grows with links, gently, and stays small. */
export function nodeRadius(node: GraphNode): number {
  return Math.min(11, 3 + Math.sqrt(node.degree) * 1.6);
}
