import { describe, expect, test } from "bun:test";

import type { MermaidFlowchart } from "./mermaidFlowchart";
import { MERMAID_VISUAL_NODE_SIZE, layoutMermaidFlowchart, trimMermaidEdge } from "./mermaidFlowLayout";

const MODEL: MermaidFlowchart = {
  direction: "LR",
  comments: [],
  nodes: [
    { id: "A", label: "Start", shape: "circle", style: {} },
    { id: "B", label: "Yes", shape: "rect", style: {} },
    { id: "C", label: "No", shape: "rect", style: {} },
  ],
  edges: [
    { id: "edge-1", from: "A", to: "B", label: "", kind: "arrow" },
    { id: "edge-2", from: "A", to: "C", label: "", kind: "arrow" },
  ],
};

describe("Mermaid visual flowchart layout", () => {
  test("places downstream nodes in the requested direction and separates peers", () => {
    const layout = layoutMermaidFlowchart(MODEL);
    expect(layout.positions.B?.x).toBeGreaterThan(layout.positions.A?.x ?? 0);
    expect(layout.positions.B?.y).not.toBe(layout.positions.C?.y);
  });

  test("reverses rank placement for right-to-left diagrams", () => {
    const layout = layoutMermaidFlowchart({ ...MODEL, direction: "RL" });
    expect(layout.positions.B?.x).toBeLessThan(layout.positions.A?.x ?? 0);
  });
});

describe("Mermaid visual edge trimming", () => {
  const { width, height } = MERMAID_VISUAL_NODE_SIZE;

  test("stops a horizontal connection at each rectangle's border", () => {
    const segment = trimMermaidEdge({ x: 0, y: 0 }, { x: 400, y: 0 }, "rect", "rect");
    expect(segment.from).toEqual({ x: width, y: height / 2 });
    expect(segment.to).toEqual({ x: 400, y: height / 2 });
  });

  test("stops at a circle's radius instead of the wrap rectangle", () => {
    const segment = trimMermaidEdge({ x: 0, y: 0 }, { x: 400, y: 0 }, "circle", "rect");
    expect(segment.from.x).toBe(width / 2 + height / 2);
  });

  test("trims diagonal connections short of both label centers", () => {
    const segment = trimMermaidEdge({ x: 0, y: 0 }, { x: 300, y: 200 }, "rect", "diamond");
    const fromCenter = { x: width / 2, y: height / 2 };
    const toCenter = { x: 300 + width / 2, y: 200 + height / 2 };
    expect(Math.hypot(segment.from.x - fromCenter.x, segment.from.y - fromCenter.y)).toBeGreaterThan(0);
    expect(Math.hypot(segment.to.x - toCenter.x, segment.to.y - toCenter.y)).toBeGreaterThan(0);
    expect(segment.from.x).toBeGreaterThan(fromCenter.x);
    expect(segment.to.x).toBeLessThan(toCenter.x);
  });

  test("falls back to node centers when the nodes overlap", () => {
    const segment = trimMermaidEdge({ x: 0, y: 0 }, { x: 10, y: 4 }, "rect", "rect");
    expect(segment.from).toEqual({ x: width / 2, y: height / 2 });
    expect(segment.to).toEqual({ x: 10 + width / 2, y: 4 + height / 2 });
  });
});
