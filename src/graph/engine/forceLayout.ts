// The Graph view's layout engine — the ONE file that imports d3-force
// (check:architecture vendorSeams). Positions are view state, never saved:
// reopening the graph lays it out again from the links.

import {
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
} from "d3-force";

export interface LayoutNode extends SimulationNodeDatum {
  id: string;
  r: number;
}

type LayoutLink = SimulationLinkDatum<LayoutNode>;

export interface Layout {
  nodes: readonly LayoutNode[];
  /** Pin a node under the pointer while dragging, and wake the layout. */
  hold: (id: string, x: number, y: number) => void;
  release: (id: string) => void;
  stop: () => void;
}

/** Lay out `nodes` joined by `edges`. `animate: false` (reduced motion) runs
 * the simulation to rest synchronously and calls `onTick` once; otherwise the
 * layout settles over ~2 seconds, calling `onTick` per frame. */
export function createLayout(
  nodes: readonly { id: string; r: number }[],
  edges: readonly { source: string; target: string }[],
  options: { animate: boolean; onTick: () => void; previous?: ReadonlyMap<string, { x: number; y: number }> },
): Layout {
  const items: LayoutNode[] = nodes.map((node) => {
    const was = options.previous?.get(node.id);
    return was ? { id: node.id, r: node.r, x: was.x, y: was.y } : { id: node.id, r: node.r };
  });
  const byId = new Map(items.map((node) => [node.id, node] as const));
  const links: LayoutLink[] = edges.map((edge) => ({ source: edge.source, target: edge.target }));
  const simulation: Simulation<LayoutNode, LayoutLink> = forceSimulation(items)
    .force(
      "link",
      forceLink<LayoutNode, LayoutLink>(links)
        .id((node) => node.id)
        // a small graph (most local graphs) gets room for every label
        .distance(nodes.length <= 30 ? 110 : 64)
        .strength(0.6),
    )
    .force("charge", forceManyBody<LayoutNode>().strength(-140).distanceMax(480))
    .force(
      "collide",
      forceCollide<LayoutNode>((node) => node.r + 4),
    )
    // a gentle pull to the middle keeps unlinked notes from drifting away
    .force("x", forceX<LayoutNode>(0).strength(0.045))
    .force("y", forceY<LayoutNode>(0).strength(0.045))
    .alphaDecay(0.035);
  if (options.animate) {
    simulation.on("tick", options.onTick);
  } else {
    simulation.stop();
    const steps = Math.ceil(Math.log(simulation.alphaMin()) / Math.log(1 - simulation.alphaDecay()));
    simulation.tick(steps);
    options.onTick();
  }
  return {
    nodes: items,
    hold(id, x, y) {
      const node = byId.get(id);
      if (!node) return;
      node.fx = x;
      node.fy = y;
      if (options.animate) simulation.alphaTarget(0.25).restart();
      else {
        node.x = x;
        node.y = y;
        options.onTick();
      }
    },
    release(id) {
      const node = byId.get(id);
      if (!node) return;
      node.fx = null;
      node.fy = null;
      if (options.animate) simulation.alphaTarget(0);
    },
    stop: () => simulation.stop(),
  };
}
