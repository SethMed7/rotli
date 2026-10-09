// The Canvas's lines (split from canvasEditor.tsx, 2026-10-06): one SVG of
// gentle curves beneath the cards, and above them a small handle at each
// line's middle — its name when it has one, otherwise a dot that shows only on
// hover, focus, or selection. The handle is how a line is clicked, reached
// with Tab, named, and removed on its own.

import type { CanvasDoc, CanvasEdge, CanvasSide } from "../../jsonCanvas/model";
import { anchor, edgeMidpoint } from "../../jsonCanvas/workflow";
import { LabelField } from "./canvasCard";

const NORMAL: Record<CanvasSide, [number, number]> = {
  top: [0, -1],
  right: [1, 0],
  bottom: [0, 1],
  left: [-1, 0],
};

/** A gentle curve between two card sides, leaving each along its normal. */
export function edgePath(doc: CanvasDoc, edge: CanvasEdge): string | null {
  const from = doc.nodes.find((node) => node.id === edge.fromNode);
  const to = doc.nodes.find((node) => node.id === edge.toNode);
  if (!from || !to) return null;
  const fromSide = edge.fromSide ?? "right";
  const toSide = edge.toSide ?? "left";
  const a = anchor(from, fromSide);
  const b = anchor(to, toSide);
  const reach = Math.min(140, Math.hypot(b.x - a.x, b.y - a.y) * 0.4);
  const [ax, ay] = NORMAL[fromSide];
  const [bx, by] = NORMAL[toSide];
  const at = (value: number) => Math.round(value);
  return `M ${at(a.x)} ${at(a.y)} C ${at(a.x + ax * reach)} ${at(a.y + ay * reach)}, ${at(b.x + bx * reach)} ${at(b.y + by * reach)}, ${at(b.x)} ${at(b.y)}`;
}

export function EdgeLines({
  doc,
  near,
  selectedEdge,
  draftFrom,
  pointer,
}: {
  doc: CanvasDoc;
  /** Lines touching a selected card take the accent. */
  near: ReadonlySet<string>;
  selectedEdge: string | null;
  /** The card a line is being drawn from, and where the pointer is. */
  draftFrom: { x: number; y: number } | null;
  pointer: { x: number; y: number } | null;
}) {
  return (
    <svg className="jc-edges" aria-hidden="true">
      <defs>
        <marker
          id="jc-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" className="jc-arrowhead" />
        </marker>
      </defs>
      {doc.edges.map((edge) => {
        const path = edgePath(doc, edge);
        if (path === null) return null;
        const lit = edge.id === selectedEdge || near.has(edge.fromNode) || near.has(edge.toNode);
        return (
          <g key={edge.id} className={lit ? "jc-edge is-near" : "jc-edge"}>
            <path
              d={path}
              markerEnd={edge.toEnd === "none" ? undefined : "url(#jc-arrow)"}
              markerStart={edge.fromEnd === "arrow" ? "url(#jc-arrow)" : undefined}
            />
          </g>
        );
      })}
      {draftFrom && pointer && (
        <line className="jc-edge-draft" x1={draftFrom.x} y1={draftFrom.y} x2={pointer.x} y2={pointer.y} />
      )}
    </svg>
  );
}

export function EdgeHandles({
  doc,
  titleOf,
  selectedEdge,
  editingEdge,
  draft,
  onDraft,
  onCommit,
  onCancel,
  onSelect,
}: {
  doc: CanvasDoc;
  /** A card's spoken name, for the line's accessible label. */
  titleOf: (id: string) => string;
  selectedEdge: string | null;
  editingEdge: string | null;
  draft: string;
  onDraft: (text: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  onSelect: (id: string) => void;
}) {
  return doc.edges.map((edge) => {
    const at = edgeMidpoint(doc, edge);
    if (!at) return null;
    const style = { left: at.x, top: at.y };
    if (edge.id === editingEdge) {
      return (
        <span key={edge.id} className="jc-edge-handle is-editing" style={style}>
          <LabelField
            className="jc-label-edit"
            value={draft}
            onDraft={onDraft}
            onCommit={onCommit}
            onCancel={onCancel}
            label="Line name"
          />
        </span>
      );
    }
    const name = `Line from ${titleOf(edge.fromNode)} to ${titleOf(edge.toNode)}${edge.label ? `, ${edge.label}` : ""}`;
    return (
      <button
        key={edge.id}
        type="button"
        className={`jc-edge-handle${edge.label ? " has-label" : ""}${edge.id === selectedEdge ? " is-selected" : ""}`}
        style={style}
        data-edge-id={edge.id}
        aria-label={name}
        aria-pressed={edge.id === selectedEdge}
        onFocus={() => onSelect(edge.id)}
      >
        {edge.label ?? ""}
      </button>
    );
  });
}
