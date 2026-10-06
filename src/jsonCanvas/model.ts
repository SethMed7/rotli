// JSON Canvas 1.0 (https://jsoncanvas.org/spec/1.0/) — the `.canvas` file a
// Rotli Canvas reads and writes, the same file Obsidian opens. The file is the
// truth; this module only parses, validates, and serializes it. Anything Rotli
// doesn't understand (an unknown node type, an extra field, a hex color) rides
// through a save untouched, so opening a canvas in Rotli never loses data
// another app put there.

export type CanvasSide = "top" | "right" | "bottom" | "left";
export type CanvasEnd = "none" | "arrow";

interface NodeBase {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** A preset "1"–"6" or a hex string — preserved as written. */
  color?: string;
  /** Fields this version doesn't know, kept for the round trip. */
  extra?: Record<string, unknown>;
}

export interface TextNode extends NodeBase {
  type: "text";
  text: string;
}
export interface FileNode extends NodeBase {
  type: "file";
  file: string;
  subpath?: string;
}
export interface LinkNode extends NodeBase {
  type: "link";
  url: string;
}
export interface GroupNode extends NodeBase {
  type: "group";
  label?: string;
  background?: string;
  backgroundStyle?: "cover" | "ratio" | "repeat";
}
/** A node type from a newer spec or another app: drawn as a placeholder,
 * saved back byte-for-byte (its `extra` holds everything). */
export interface UnknownNode extends NodeBase {
  type: "unknown";
  rawType: string;
}
export type CanvasNode = TextNode | FileNode | LinkNode | GroupNode | UnknownNode;

export interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: CanvasSide;
  toSide?: CanvasSide;
  fromEnd?: CanvasEnd;
  toEnd?: CanvasEnd;
  color?: string;
  label?: string;
  extra?: Record<string, unknown>;
}

export interface CanvasDoc {
  /** Array order is z-order: first is lowest (spec). */
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  extra?: Record<string, unknown>;
}

/** Why a file can't open as a canvas — one wording, shared with the tests. */
export const CANVAS_REFUSAL = {
  notJson: "This canvas isn’t valid JSON.",
  notObject: "This canvas isn’t a JSON Canvas object.",
  notLists: "This canvas’s nodes or edges aren’t lists.",
} as const;

export type ParseResult = { ok: true; doc: CanvasDoc } | { ok: false; error: string };

const SIDES = new Set<string>(["top", "right", "bottom", "left"]);
const ENDS = new Set<string>(["none", "arrow"]);
const NODE_KEYS = ["id", "type", "x", "y", "width", "height", "color"];
const TYPE_KEYS: Record<string, string[]> = {
  text: ["text"],
  file: ["file", "subpath"],
  link: ["url"],
  group: ["label", "background", "backgroundStyle"],
};
const EDGE_KEYS = ["id", "fromNode", "toNode", "fromSide", "toSide", "fromEnd", "toEnd", "color", "label"];

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function rest(source: Json, known: readonly string[]): Record<string, unknown> | undefined {
  const extra = Object.fromEntries(Object.entries(source).filter(([key]) => !known.includes(key)));
  return Object.keys(extra).length > 0 ? extra : undefined;
}

function optionalString(source: Json, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" ? value : undefined;
}

function parseNode(raw: unknown, at: number): CanvasNode | string {
  if (!isObject(raw)) return `node ${at} is not an object`;
  const { id, type, x, y, width, height } = raw;
  if (typeof id !== "string" || id === "") return `node ${at} has no id`;
  if (typeof type !== "string") return `node ${id} has no type`;
  if (!finite(x) || !finite(y) || !finite(width) || !finite(height))
    return `node ${id} has no position or size`;
  const base = { id, x, y, width, height, ...(typeof raw.color === "string" ? { color: raw.color } : {}) };
  const typeKeys = TYPE_KEYS[type];
  const extra = rest(raw, [...NODE_KEYS, ...(typeKeys ?? [])]);
  const withExtra = <T extends CanvasNode>(node: T): T => (extra ? { ...node, extra } : node);
  switch (type) {
    case "text":
      if (typeof raw.text !== "string") return `text node ${id} has no text`;
      return withExtra({ ...base, type, text: raw.text });
    case "file": {
      if (typeof raw.file !== "string" || raw.file === "") return `file node ${id} has no file`;
      const subpath = optionalString(raw, "subpath");
      return withExtra({ ...base, type, file: raw.file, ...(subpath ? { subpath } : {}) });
    }
    case "link":
      if (typeof raw.url !== "string") return `link node ${id} has no url`;
      return withExtra({ ...base, type, url: raw.url });
    case "group": {
      const label = optionalString(raw, "label");
      const background = optionalString(raw, "background");
      const style = optionalString(raw, "backgroundStyle");
      return withExtra({
        ...base,
        type,
        ...(label !== undefined ? { label } : {}),
        ...(background !== undefined ? { background } : {}),
        ...(style === "cover" || style === "ratio" || style === "repeat" ? { backgroundStyle: style } : {}),
      });
    }
    default:
      return withExtra({ ...base, type: "unknown", rawType: type });
  }
}

function parseEdge(raw: unknown, at: number): CanvasEdge | string {
  if (!isObject(raw)) return `edge ${at} is not an object`;
  const { id, fromNode, toNode } = raw;
  if (typeof id !== "string" || id === "") return `edge ${at} has no id`;
  if (typeof fromNode !== "string" || typeof toNode !== "string") return `edge ${id} has no ends`;
  const edge: CanvasEdge = { id, fromNode, toNode };
  const side = (key: "fromSide" | "toSide") => {
    const value = raw[key];
    if (typeof value === "string" && SIDES.has(value)) edge[key] = value as CanvasSide;
  };
  const end = (key: "fromEnd" | "toEnd") => {
    const value = raw[key];
    if (typeof value === "string" && ENDS.has(value)) edge[key] = value as CanvasEnd;
  };
  side("fromSide");
  side("toSide");
  end("fromEnd");
  end("toEnd");
  if (typeof raw.color === "string") edge.color = raw.color;
  if (typeof raw.label === "string") edge.label = raw.label;
  const extra = rest(raw, EDGE_KEYS);
  return extra ? { ...edge, extra } : edge;
}

/** Parse a `.canvas` file. An empty file is an empty canvas. Ids must be
 * unique across nodes and edges. An edge whose end is missing is refused: it
 * names a node that isn't there, and silently dropping it would lose data. */
export function parseCanvas(text: string): ParseResult {
  if (text.trim() === "") return { ok: true, doc: { nodes: [], edges: [] } };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: CANVAS_REFUSAL.notJson };
  }
  if (!isObject(raw)) return { ok: false, error: CANVAS_REFUSAL.notObject };
  const rawNodes = raw.nodes ?? [];
  const rawEdges = raw.edges ?? [];
  if (!Array.isArray(rawNodes) || !Array.isArray(rawEdges)) {
    return { ok: false, error: CANVAS_REFUSAL.notLists };
  }
  const nodes: CanvasNode[] = [];
  const ids = new Set<string>();
  for (const [at, entry] of rawNodes.entries()) {
    const node = parseNode(entry, at);
    if (typeof node === "string") return { ok: false, error: `This canvas can’t be read: ${node}.` };
    if (ids.has(node.id))
      return { ok: false, error: `This canvas can’t be read: two items share id ${node.id}.` };
    ids.add(node.id);
    nodes.push(node);
  }
  const edges: CanvasEdge[] = [];
  for (const [at, entry] of rawEdges.entries()) {
    const edge = parseEdge(entry, at);
    if (typeof edge === "string") return { ok: false, error: `This canvas can’t be read: ${edge}.` };
    if (ids.has(edge.id))
      return { ok: false, error: `This canvas can’t be read: two items share id ${edge.id}.` };
    if (!nodes.some((node) => node.id === edge.fromNode) || !nodes.some((node) => node.id === edge.toNode)) {
      return { ok: false, error: `This canvas can’t be read: line ${edge.id} points at a missing card.` };
    }
    ids.add(edge.id);
    edges.push(edge);
  }
  const extra = rest(raw, ["nodes", "edges"]);
  return { ok: true, doc: extra ? { nodes, edges, extra } : { nodes, edges } };
}

function nodeJson(node: CanvasNode): Json {
  const { extra, ...known } = node;
  const out: Json = { id: known.id, type: known.type === "unknown" ? known.rawType : known.type };
  if (known.type === "text") out.text = known.text;
  if (known.type === "file") {
    out.file = known.file;
    if (known.subpath) out.subpath = known.subpath;
  }
  if (known.type === "link") out.url = known.url;
  if (known.type === "group") {
    if (known.label !== undefined) out.label = known.label;
    if (known.background !== undefined) out.background = known.background;
    if (known.backgroundStyle !== undefined) out.backgroundStyle = known.backgroundStyle;
  }
  // the spec says integer pixels
  out.x = Math.round(known.x);
  out.y = Math.round(known.y);
  out.width = Math.round(known.width);
  out.height = Math.round(known.height);
  if (known.color !== undefined) out.color = known.color;
  return { ...out, ...extra };
}

function edgeJson(edge: CanvasEdge): Json {
  // Obsidian's key order: each end's node, then its side and arrow
  const out: Json = { id: edge.id, fromNode: edge.fromNode };
  if (edge.fromSide !== undefined) out.fromSide = edge.fromSide;
  if (edge.fromEnd !== undefined) out.fromEnd = edge.fromEnd;
  out.toNode = edge.toNode;
  if (edge.toSide !== undefined) out.toSide = edge.toSide;
  if (edge.toEnd !== undefined) out.toEnd = edge.toEnd;
  if (edge.color !== undefined) out.color = edge.color;
  if (edge.label !== undefined) out.label = edge.label;
  return { ...out, ...edge.extra };
}

/** Serialize the way Obsidian writes a canvas — tab-indented, one item per
 * line — so a canvas edited in both apps diffs line by line. */
export function serializeCanvas(doc: CanvasDoc): string {
  const list = (items: Json[]) =>
    items.length === 0 ? "[]" : `[\n${items.map((item) => `\t\t${JSON.stringify(item)}`).join(",\n")}\n\t]`;
  const extra = Object.entries(doc.extra ?? {}).map(
    ([key, value]) => `\t${JSON.stringify(key)}:${JSON.stringify(value)}`,
  );
  const body = [
    `\t"nodes":${list(doc.nodes.map(nodeJson))}`,
    `\t"edges":${list(doc.edges.map(edgeJson))}`,
    ...extra,
  ];
  return `{\n${body.join(",\n")}\n}`;
}

/** A new, empty canvas file — byte-identical to Rust `EMPTY_CANVAS`
 * (parity.json `emptyCanvasFile`). */
export const EMPTY_CANVAS_FILE = serializeCanvas({ nodes: [], edges: [] });

/** The spec's preset names (it leaves their exact colors to each app). */
export const PRESET_NAMES: Record<string, string> = {
  "1": "red",
  "2": "orange",
  "3": "yellow",
  "4": "green",
  "5": "cyan",
  "6": "purple",
};

/** The display name of a card's color, for its accessible label. A hex color
 * (another app's custom pick) reads as "custom". */
export function colorName(color: string | undefined): string | null {
  if (color === undefined) return null;
  return PRESET_NAMES[color] ?? "custom";
}

/** A file node's title — its file name without folder or `.md`. */
export function fileTitle(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.toLowerCase().endsWith(".md") ? name.slice(0, -3) : name;
}
