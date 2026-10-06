// Mounts the Graph view's renderer (graphRenderer.ts) once and feeds it
// props; React owns only the elements and the screen-reader live region.

import { useEffect, useRef, useState } from "react";

import type { Graph, GraphNode } from "../../graph/model";
import { useDataTheme } from "../../state/theme";
import { type GraphRenderer, createGraphRenderer } from "./graphRenderer";

export interface GraphCanvasProps {
  graph: Graph;
  center: string | null;
  matched: ReadonlySet<string>;
  onOpen: (id: string, newTab: boolean) => void;
  onCenter: (id: string) => void;
}

export function GraphCanvas({ graph, center, matched, onOpen, onCenter }: GraphCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<GraphRenderer | null>(null);
  // the renderer outlives renders; it calls whatever handlers are current
  const handlers = useRef({ onOpen, onCenter });
  const [focused, setFocused] = useState<GraphNode | null>(null);
  const theme = useDataTheme();

  useEffect(() => {
    handlers.current = { onOpen, onCenter };
  }, [onOpen, onCenter]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const renderer = createGraphRenderer(wrap, canvas, {
      onOpen: (id, newTab) => handlers.current.onOpen(id, newTab),
      onCenter: (id) => handlers.current.onCenter(id),
      onFocus: setFocused,
    });
    rendererRef.current = renderer;
    return () => {
      renderer.destroy();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    rendererRef.current?.update({ graph, center, matched });
  }, [graph, center, matched]);

  useEffect(() => {
    rendererRef.current?.repaint();
  }, [theme]);

  const announce = focused
    ? `${focused.title}${focused.secure ? ", secure" : ""}, ${focused.degree} ${focused.degree === 1 ? "link" : "links"}`
    : "";

  return (
    <div ref={wrapRef} className="graph-canvas">
      <canvas
        ref={canvasRef}
        tabIndex={0}
        role="application"
        aria-roledescription="note graph"
        aria-label={`Graph of ${graph.nodes.length} notes and ${graph.edges.length} links. Arrow keys move between notes, Enter opens one, Shift-Enter centers the graph on it.`}
      />
      <p className="graph-live" aria-live="polite">
        {announce}
      </p>
    </div>
  );
}
