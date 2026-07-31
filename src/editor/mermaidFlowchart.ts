export const MERMAID_FLOW_DIRECTIONS = ["TD", "LR", "BT", "RL"] as const;

export type MermaidFlowDirection = (typeof MERMAID_FLOW_DIRECTIONS)[number];

export const MERMAID_NODE_SHAPES = [
  { id: "rect", label: "Process" },
  { id: "rounded", label: "Event" },
  { id: "stadium", label: "Terminal" },
  { id: "diamond", label: "Decision" },
  { id: "hex", label: "Prepare" },
  { id: "cyl", label: "Database" },
  { id: "circle", label: "Start" },
  { id: "dbl-circ", label: "Stop" },
  { id: "subproc", label: "Subprocess" },
  { id: "lean-r", label: "Input" },
  { id: "lean-l", label: "Output" },
  { id: "text", label: "Text" },
] as const;

export type MermaidNodeShape = (typeof MERMAID_NODE_SHAPES)[number]["id"];
export type MermaidEdgeKind = "arrow" | "line" | "dotted" | "thick";

export interface MermaidNodeStyle {
  fill?: string;
  stroke?: string;
  color?: string;
}

export interface MermaidFlowNode {
  id: string;
  label: string;
  shape: MermaidNodeShape;
  style: MermaidNodeStyle;
}

export interface MermaidFlowEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  kind: MermaidEdgeKind;
}

export interface MermaidFlowchart {
  direction: MermaidFlowDirection;
  comments: string[];
  nodes: MermaidFlowNode[];
  edges: MermaidFlowEdge[];
}

export type MermaidFlowchartParseResult =
  | { ok: true; model: MermaidFlowchart }
  | { ok: false; reason: string; line?: number };

const ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*/;
const COLOR_PATTERN = /^(?:#[0-9a-f]{3,8}|[a-z]+)$/i;
const PIPE_ENTITY = "#" + "124;";
const SHAPES = new Set<string>(MERMAID_NODE_SHAPES.map((shape) => shape.id));

interface ReadNodeResult {
  node: MermaidFlowNode;
  explicit: boolean;
  end: number;
}

interface LegacyShape {
  open: string;
  close: string;
  shape: MermaidNodeShape;
}

const LEGACY_SHAPES: LegacyShape[] = [
  { open: "(((", close: ")))", shape: "dbl-circ" },
  { open: "((", close: "))", shape: "circle" },
  { open: "([", close: "])", shape: "stadium" },
  { open: "[[", close: "]]", shape: "subproc" },
  { open: "[(", close: ")]", shape: "cyl" },
  { open: "{{", close: "}}", shape: "hex" },
  { open: "[/", close: "/]", shape: "lean-r" },
  { open: "[\\", close: "\\]", shape: "lean-l" },
  { open: "[", close: "]", shape: "rect" },
  { open: "(", close: ")", shape: "rounded" },
  { open: "{", close: "}", shape: "diamond" },
];

function skipSpace(source: string, start: number): number {
  let cursor = start;
  while (/\s/.test(source[cursor] ?? "")) cursor += 1;
  return cursor;
}

function decodeQuotedLabel(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith('"')) return trimmed;
  try {
    const decoded = JSON.parse(trimmed) as unknown;
    return typeof decoded === "string" ? decoded : null;
  } catch {
    return null;
  }
}

function splitMetadataFields(source: string): string[] | null {
  const fields: string[] = [];
  let quote = false;
  let escaped = false;
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\" && quote) {
      escaped = true;
      continue;
    }
    if (character === '"') quote = !quote;
    if (character === "," && !quote) {
      fields.push(source.slice(start, index));
      start = index + 1;
    }
  }
  if (quote) return null;
  fields.push(source.slice(start));
  return fields;
}

function readExpandedNode(source: string, id: string, start: number): ReadNodeResult | null {
  if (!source.startsWith("@{", start)) return null;
  let quote = false;
  let escaped = false;
  let close = -1;
  for (let index = start + 2; index < source.length; index += 1) {
    const character = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\" && quote) {
      escaped = true;
      continue;
    }
    if (character === '"') quote = !quote;
    if (character === "}" && !quote) {
      close = index;
      break;
    }
  }
  if (close < 0) return null;
  const fields = splitMetadataFields(source.slice(start + 2, close));
  if (!fields) return null;
  let shape: MermaidNodeShape | null = null;
  let label = id;
  for (const field of fields) {
    const match = /^\s*(shape|label)\s*:\s*(.+?)\s*$/.exec(field);
    if (!match?.[1] || match[2] === undefined) return null;
    if (match[1] === "shape") {
      const candidate = match[2].trim();
      if (!SHAPES.has(candidate)) return null;
      shape = candidate as MermaidNodeShape;
    } else {
      const decoded = decodeQuotedLabel(match[2]);
      if (decoded === null) return null;
      label = decoded;
    }
  }
  if (!shape) return null;
  return { node: { id, label, shape, style: {} }, explicit: true, end: close + 1 };
}

function readNode(source: string, start: number): ReadNodeResult | null {
  const cursor = skipSpace(source, start);
  const idMatch = ID_PATTERN.exec(source.slice(cursor));
  if (!idMatch?.[0]) return null;
  const id = idMatch[0];
  const descriptorStart = cursor + id.length;
  const expanded = readExpandedNode(source, id, descriptorStart);
  if (expanded) return expanded;

  for (const descriptor of LEGACY_SHAPES) {
    if (!source.startsWith(descriptor.open, descriptorStart)) continue;
    const labelStart = descriptorStart + descriptor.open.length;
    const close = source.indexOf(descriptor.close, labelStart);
    if (close < 0) return null;
    const decoded = decodeQuotedLabel(source.slice(labelStart, close));
    if (decoded === null) return null;
    return {
      node: { id, label: decoded, shape: descriptor.shape, style: {} },
      explicit: true,
      end: close + descriptor.close.length,
    };
  }

  return {
    node: { id, label: id, shape: "rect", style: {} },
    explicit: false,
    end: descriptorStart,
  };
}

function mergeNode(nodes: MermaidFlowNode[], incoming: ReadNodeResult): void {
  const index = nodes.findIndex((node) => node.id === incoming.node.id);
  if (index < 0) {
    nodes.push(incoming.node);
  } else if (incoming.explicit) {
    const existing = nodes[index];
    if (existing) nodes[index] = { ...incoming.node, style: existing.style };
  }
}

function parseGraphLine(line: string, nodes: MermaidFlowNode[], edges: MermaidFlowEdge[]): string | null {
  const sourceNode = readNode(line, 0);
  if (!sourceNode) return "Expected a supported node declaration.";
  let cursor = skipSpace(line, sourceNode.end);
  if (cursor === line.length || line[cursor] === ";") {
    mergeNode(nodes, sourceNode);
    return null;
  }

  const operators: Array<{ syntax: string; kind: MermaidEdgeKind }> = [
    { syntax: "-.->", kind: "dotted" },
    { syntax: "==>", kind: "thick" },
    { syntax: "-->", kind: "arrow" },
    { syntax: "---", kind: "line" },
  ];
  const operator = operators.find((candidate) => line.startsWith(candidate.syntax, cursor));
  if (!operator) return "Visual mode does not safely rewrite this connection syntax yet.";
  cursor = skipSpace(line, cursor + operator.syntax.length);

  let label = "";
  if (line[cursor] === "|") {
    const close = line.indexOf("|", cursor + 1);
    if (close < 0) return "This connection label is missing its closing | character.";
    label = line
      .slice(cursor + 1, close)
      .trim()
      .replaceAll(PIPE_ENTITY, "|");
    cursor = skipSpace(line, close + 1);
  }

  const targetNode = readNode(line, cursor);
  if (!targetNode) return "Expected a supported target node after the connection.";
  cursor = skipSpace(line, targetNode.end);
  if (line[cursor] === ";") cursor = skipSpace(line, cursor + 1);
  if (cursor !== line.length) return "Visual mode does not safely rewrite chained connections yet.";

  mergeNode(nodes, sourceNode);
  mergeNode(nodes, targetNode);
  edges.push({
    id: `edge-${edges.length + 1}`,
    from: sourceNode.node.id,
    to: targetNode.node.id,
    label,
    kind: operator.kind,
  });
  return null;
}

function parseStyleLine(line: string): { id: string; style: MermaidNodeStyle } | null {
  const match = /^style\s+([A-Za-z_][A-Za-z0-9_-]*)\s+(.+?);?$/.exec(line);
  if (!match?.[1] || !match[2]) return null;
  const style: MermaidNodeStyle = {};
  for (const declaration of match[2].split(",")) {
    const property = /^\s*(fill|stroke|color)\s*:\s*([^,;\s]+)\s*$/.exec(declaration);
    if (!property?.[1] || !property[2] || !COLOR_PATTERN.test(property[2])) return null;
    style[property[1] as keyof MermaidNodeStyle] = property[2];
  }
  return { id: match[1], style };
}

export function parseMermaidFlowchart(source: string): MermaidFlowchartParseResult {
  const lines = source.split(/\r?\n/);
  const firstContent = lines.findIndex((line) => line.trim() && !line.trim().startsWith("%%"));
  if (firstContent < 0) {
    return { ok: false, reason: "Add a flowchart declaration in Code before using Visual mode." };
  }
  const header = /^\s*(?:flowchart|graph)\s+(TD|TB|BT|LR|RL)\s*;?\s*$/i.exec(lines[firstContent] ?? "");
  if (!header?.[1]) {
    return {
      ok: false,
      reason: "Visual editing currently supports Mermaid flowcharts. This diagram remains editable in Code.",
      line: firstContent + 1,
    };
  }

  const direction = (
    header[1].toUpperCase() === "TB" ? "TD" : header[1].toUpperCase()
  ) as MermaidFlowDirection;
  const comments: string[] = [];
  const nodes: MermaidFlowNode[] = [];
  const edges: MermaidFlowEdge[] = [];
  const styles: Array<{ id: string; style: MermaidNodeStyle; line: number }> = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (index === firstContent) continue;
    const line = lines[index]?.trim() ?? "";
    if (!line) continue;
    if (line.startsWith("%%{")) {
      return {
        ok: false,
        reason: "Visual mode does not safely rewrite Mermaid initialization directives yet.",
        line: index + 1,
      };
    }
    if (line.startsWith("%%")) {
      comments.push(line);
      continue;
    }
    if (line.startsWith("style ")) {
      const parsed = parseStyleLine(line);
      if (!parsed) {
        return {
          ok: false,
          reason: "Visual mode supports node fill, border, and text colors; keep advanced styles in Code.",
          line: index + 1,
        };
      }
      styles.push({ ...parsed, line: index + 1 });
      continue;
    }
    const error = parseGraphLine(line, nodes, edges);
    if (error) return { ok: false, reason: error, line: index + 1 };
  }

  for (const item of styles) {
    const node = nodes.find((candidate) => candidate.id === item.id);
    if (!node) {
      return {
        ok: false,
        reason: `Style references unknown node ${item.id}.`,
        line: item.line,
      };
    }
    node.style = item.style;
  }

  return { ok: true, model: { direction, comments, nodes, edges } };
}

function serializeNode(node: MermaidFlowNode): string {
  return `  ${node.id}@{ shape: ${node.shape}, label: ${JSON.stringify(node.label)} }`;
}

function edgeSyntax(kind: MermaidEdgeKind): string {
  if (kind === "line") return "---";
  if (kind === "dotted") return "-.->";
  if (kind === "thick") return "==>";
  return "-->";
}

export function serializeMermaidFlowchart(model: MermaidFlowchart): string {
  const lines = [`flowchart ${model.direction}`];
  if (model.comments.length > 0) lines.push(...model.comments.map((comment) => `  ${comment}`));
  if (model.nodes.length > 0) lines.push(...model.nodes.map(serializeNode));
  if (model.edges.length > 0) {
    lines.push(
      ...model.edges.map((edge) => {
        const label = edge.label.trim() ? `|${edge.label.trim().replaceAll("|", PIPE_ENTITY)}|` : "";
        return `  ${edge.from} ${edgeSyntax(edge.kind)}${label} ${edge.to}`;
      }),
    );
  }
  for (const node of model.nodes) {
    const declarations = (Object.entries(node.style) as Array<[keyof MermaidNodeStyle, string]>)
      .filter(([, value]) => Boolean(value))
      .map(([property, value]) => `${property}:${value}`);
    if (declarations.length > 0) lines.push(`  style ${node.id} ${declarations.join(",")}`);
  }
  return lines.join("\n");
}

export function nextMermaidNodeId(nodes: readonly MermaidFlowNode[]): string {
  const existing = new Set(nodes.map((node) => node.id));
  let index = nodes.length + 1;
  while (existing.has(`node${index}`)) index += 1;
  return `node${index}`;
}
