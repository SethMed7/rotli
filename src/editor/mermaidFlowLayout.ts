import type { MermaidFlowchart } from "./mermaidFlowchart";

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
