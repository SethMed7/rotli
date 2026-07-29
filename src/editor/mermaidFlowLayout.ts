import type { MermaidFlowchart, MermaidNodeShape } from "./mermaidFlowchart";

export interface MermaidCanvasPoint {
  x: number;
  y: number;
}

export interface MermaidFlowLayout {
  height: number;
  positions: Record<string, MermaidCanvasPoint>;
  width: number;
}

export const MERMAID_VISUAL_NODE_SIZE = { width: 164, height: 72 } as const;

export interface MermaidEdgeSegment {
  from: MermaidCanvasPoint;
  to: MermaidCanvasPoint;
}

/* circle/dbl-circ render as 72px circles centered in the node wrap, so their
   boundary is the wrap's half-height in every direction */
function boundaryDistance(shape: MermaidNodeShape, ux: number, uy: number): number {
  const halfW = MERMAID_VISUAL_NODE_SIZE.width / 2;
  const halfH = MERMAID_VISUAL_NODE_SIZE.height / 2;
  if (shape === "circle" || shape === "dbl-circ") return halfH;
  if (shape === "diamond") return 1 / (Math.abs(ux) / halfW + Math.abs(uy) / halfH);
  return Math.min(ux === 0 ? Infinity : halfW / Math.abs(ux), uy === 0 ? Infinity : halfH / Math.abs(uy));
}

/* Trim a center-to-center connection so it starts and ends at each node's
   border instead of running beneath (or across) the labels. Takes the nodes'
   wrap top-left positions; falls back to the centers when the nodes overlap. */
export function trimMermaidEdge(
  from: MermaidCanvasPoint,
  to: MermaidCanvasPoint,
  fromShape: MermaidNodeShape,
  toShape: MermaidNodeShape,
): MermaidEdgeSegment {
  const halfW = MERMAID_VISUAL_NODE_SIZE.width / 2;
  const halfH = MERMAID_VISUAL_NODE_SIZE.height / 2;
  const c1 = { x: from.x + halfW, y: from.y + halfH };
  const c2 = { x: to.x + halfW, y: to.y + halfH };
  const dx = c2.x - c1.x;
  const dy = c2.y - c1.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { from: c1, to: c2 };
  const ux = dx / length;
  const uy = dy / length;
  const exitFrom = boundaryDistance(fromShape, ux, uy);
  const exitTo = boundaryDistance(toShape, ux, uy);
  if (exitFrom + exitTo >= length) return { from: c1, to: c2 };
  return {
    from: { x: c1.x + ux * exitFrom, y: c1.y + uy * exitFrom },
    to: { x: c2.x - ux * exitTo, y: c2.y - uy * exitTo },
  };
}

function nodeLevels(model: MermaidFlowchart): Map<string, number> {
  const nodeIds = new Set(model.nodes.map((node) => node.id));
  const incoming = new Map(model.nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(model.nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of model.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) continue;
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from)?.push(edge.to);
  }

  const levels = new Map<string, number>();
  const visitFrom = (root: string, offset: number) => {
    const queue: Array<{ id: string; level: number }> = [{ id: root, level: offset }];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) break;
      const known = levels.get(current.id);
      if (known !== undefined && known <= current.level) continue;
      levels.set(current.id, current.level);
      for (const target of outgoing.get(current.id) ?? []) {
        queue.push({ id: target, level: current.level + 1 });
      }
    }
  };

  for (const node of model.nodes) {
    if ((incoming.get(node.id) ?? 0) === 0) visitFrom(node.id, 0);
  }
  for (const node of model.nodes) {
    if (!levels.has(node.id)) visitFrom(node.id, 0);
  }
  return levels;
}

export function layoutMermaidFlowchart(model: MermaidFlowchart): MermaidFlowLayout {
  const padding = 72;
  const rankGap = 124;
  const peerGap = 48;
  const levels = nodeLevels(model);
  const ranks = new Map<number, string[]>();
  for (const node of model.nodes) {
    const level = levels.get(node.id) ?? 0;
    const rank = ranks.get(level) ?? [];
    rank.push(node.id);
    ranks.set(level, rank);
  }

  const rankEntries = [...ranks.entries()].sort(([a], [b]) => a - b);
  const maxPeers = Math.max(1, ...rankEntries.map(([, ids]) => ids.length));
  const rankCount = Math.max(1, rankEntries.length);
  const horizontal = model.direction === "LR" || model.direction === "RL";
  const primaryStep = horizontal
    ? MERMAID_VISUAL_NODE_SIZE.width + rankGap
    : MERMAID_VISUAL_NODE_SIZE.height + rankGap;
  const peerStep = horizontal
    ? MERMAID_VISUAL_NODE_SIZE.height + peerGap
    : MERMAID_VISUAL_NODE_SIZE.width + peerGap;
  const width = horizontal
    ? padding * 2 + MERMAID_VISUAL_NODE_SIZE.width + (rankCount - 1) * primaryStep
    : padding * 2 + MERMAID_VISUAL_NODE_SIZE.width + (maxPeers - 1) * peerStep;
  const height = horizontal
    ? padding * 2 + MERMAID_VISUAL_NODE_SIZE.height + (maxPeers - 1) * peerStep
    : padding * 2 + MERMAID_VISUAL_NODE_SIZE.height + (rankCount - 1) * primaryStep;
  const positions: Record<string, MermaidCanvasPoint> = {};

  for (let rankIndex = 0; rankIndex < rankEntries.length; rankIndex += 1) {
    const ids = rankEntries[rankIndex]?.[1] ?? [];
    const reversedRank =
      model.direction === "RL" || model.direction === "BT" ? rankCount - 1 - rankIndex : rankIndex;
    const peerSpan = (ids.length - 1) * peerStep;
    const availablePeerSpan = (maxPeers - 1) * peerStep;
    const peerOffset = (availablePeerSpan - peerSpan) / 2;
    for (let peerIndex = 0; peerIndex < ids.length; peerIndex += 1) {
      const id = ids[peerIndex];
      if (!id) continue;
      positions[id] = horizontal
        ? {
            x: padding + reversedRank * primaryStep,
            y: padding + peerOffset + peerIndex * peerStep,
          }
        : {
            x: padding + peerOffset + peerIndex * peerStep,
            y: padding + reversedRank * primaryStep,
          };
    }
  }

  return { positions, width, height };
}
