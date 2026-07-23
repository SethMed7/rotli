import { describe, expect, test } from "bun:test";
import { layoutMermaidFlowchart } from "./mermaidFlowLayout";
import type { MermaidFlowchart } from "./mermaidFlowchart";

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
