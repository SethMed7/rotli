// The Canvas editor (spike, 2026-10-05): cards on an open plane, the JSON
// Canvas file as its only truth. Calm by construction — no toolbar, no zoom
// widget, no minimap. A card's connect dots show only on hover or focus; a
// selected card shows nothing more than an outline.
//
// Pointer: double-click empty space writes a card · drag a card to move it ·
// drag its corner to resize · drag a side dot onto another card to connect ·
// drag empty space to pan · pinch or ⌘-scroll to zoom. A card holding just
// [[a note]] becomes that note's card when you finish typing.
// Keyboard: Tab reaches each card · Enter edits a text card or opens a note ·
// arrows nudge (⇧ for more) · Delete removes · Esc deselects · 0 fits.

import { useEffect, useMemo, useRef, useState } from "react";

import { type View, fitView, toGraph, zoomAt } from "../../graph/viewport";
import {
  type CanvasDoc,
  type CanvasEdge,
  type CanvasNode,
  type CanvasSide,
  colorName,
  fileTitle,
} from "../../jsonCanvas/model";
import { lonelyWikilink } from "../../jsonCanvas/notePaths";
import {
  NOTE_CARD,
  addText,
  anchor,
  bringToFront,
  connect,
  moveNodes,
  removeItems,
  resizeNode,
  setText,
} from "../../jsonCanvas/workflow";
import { MarkdownPeek } from "../markdownPeek";

export interface CanvasNoteView {
  title: string;
  /** null while the body loads. */
  body: string | null;
  /** Title shows, text never does — a screen may be shared. */
  secure: boolean;
}

export interface CanvasEditorProps {
  doc: CanvasDoc;
  onChange: (doc: CanvasDoc) => void;
  /** The note a card's path names, or null when none answers. */
  noteFor: (path: string) => CanvasNoteView | null;
  /** The path `[[target]]` resolves to, or null. */
  resolveLink: (target: string) => string | null;
  onOpenNote: (path: string) => void;
}

type Drag =
  | { kind: "pan"; sx: number; sy: number; view: View }
  | { kind: "move"; sx: number; sy: number; ids: string[]; origin: CanvasDoc; moved: boolean }
  | { kind: "resize"; sx: number; sy: number; id: string; width: number; height: number; origin: CanvasDoc }
  | { kind: "connect"; from: string };

const SIDES: readonly CanvasSide[] = ["top", "right", "bottom", "left"];
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

function cardLabel(node: CanvasNode, note: CanvasNoteView | null): string {
  const color = colorName(node.color);
  const tint = color ? `, ${color}` : "";
  switch (node.type) {
    case "text":
      return `Text card${tint}: ${node.text.split("\n")[0]?.replace(/^#+\s*/, "") || "empty"}`;
    case "file":
      return `Note card${tint}: ${note?.title ?? `${fileTitle(node.file)} (missing)`}`;
    case "link":
      return `Link card${tint}: ${node.url}`;
    case "group":
      return `Group${tint}: ${node.label ?? "untitled"}`;
    case "unknown":
      return `Card from another app (${node.rawType})`;
  }
}

export function CanvasEditor({ doc, onChange, noteFor, resolveLink, onOpenNote }: CanvasEditorProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  // the card a line is being drawn from (state, so the draft line renders)
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const drag = useRef<Drag | null>(null);
  const fitted = useRef(false);

  // size + first fit
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const rect = element.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (fitted.current || size.width === 0) return;
    fitted.current = true;
    setView(fitDoc(doc, size.width, size.height));
  }, [doc, size]);

  // wheel: pinch / ⌘-scroll zooms at the pointer, two-finger scroll pans
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if ((event.target as HTMLElement).closest("textarea")) return;
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      setView((current) =>
        event.ctrlKey || event.metaKey
          ? zoomAt(
              current,
              rect.width,
              rect.height,
              event.clientX - rect.left,
              event.clientY - rect.top,
              Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.002)),
            )
          : { ...current, x: current.x - event.deltaX, y: current.y - event.deltaY },
      );
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  const world = (clientX: number, clientY: number): [number, number] => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return [0, 0];
    return toGraph(view, rect.width, rect.height, clientX - rect.left, clientY - rect.top);
  };

  const commitEdit = () => {
    if (editing === null) return;
    const id = editing;
    setEditing(null);
    const node = doc.nodes.find((each) => each.id === id);
    if (!node || node.type !== "text") return;
    const target = lonelyWikilink(draft);
    const path = target ? resolveLink(target) : null;
    if (path) {
      // the card becomes the note's card, same place, note-card size
      const index = doc.nodes.indexOf(node);
      const card: CanvasNode = { id: node.id, type: "file", file: path, x: node.x, y: node.y, ...NOTE_CARD };
      onChange({ ...doc, nodes: doc.nodes.map((each, at) => (at === index ? card : each)) });
    } else if (draft.trim() === "") {
      onChange(removeItems(doc, [id]));
    } else if (draft !== node.text) {
      onChange(setText(doc, id, draft));
    }
  };

  const startEdit = (node: CanvasNode) => {
    if (node.type !== "text") return;
    setSelected(new Set([node.id]));
    setDraft(node.text);
    setEditing(node.id);
  };

  // ——— pointer on the plane
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("textarea")) return;
    const handle = target.closest<HTMLElement>("[data-handle]");
    const cardElement = target.closest<HTMLElement>("[data-card-id]");
    const id = cardElement?.dataset.cardId;
    viewportRef.current?.setPointerCapture(event.pointerId);
    if (editing !== null && id !== editing) commitEdit();
    if (handle && id) {
      if (handle.dataset.handle === "resize") {
        const node = doc.nodes.find((each) => each.id === id);
        if (node) {
          drag.current = {
            kind: "resize",
            sx: event.clientX,
            sy: event.clientY,
            id,
            width: node.width,
            height: node.height,
            origin: doc,
          };
        }
      } else {
        drag.current = { kind: "connect", from: id };
        setConnectFrom(id);
        setPointer(null);
      }
      return;
    }
    if (id) {
      const next = event.shiftKey ? toggled(selected, id) : selected.has(id) ? selected : new Set([id]);
      setSelected(next);
      drag.current = {
        kind: "move",
        sx: event.clientX,
        sy: event.clientY,
        ids: [...next],
        origin: doc,
        moved: false,
      };
      return;
    }
    if (!event.shiftKey) setSelected(new Set());
    drag.current = { kind: "pan", sx: event.clientX, sy: event.clientY, view };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    if (current.kind === "pan") {
      setView({
        ...current.view,
        x: current.view.x + event.clientX - current.sx,
        y: current.view.y + event.clientY - current.sy,
      });
    } else if (current.kind === "move") {
      const dx = (event.clientX - current.sx) / view.k;
      const dy = (event.clientY - current.sy) / view.k;
      if (!current.moved && Math.hypot(dx, dy) * view.k < 3) return;
      // lift what you carry the moment it moves (not on a plain click, which would rewrite the file)
      const base = current.moved ? current.origin : bringToFront(current.origin, current.ids);
      if (!current.moved) drag.current = { ...current, origin: base, moved: true };
      onChange(moveNodes(base, current.ids, dx, dy));
    } else if (current.kind === "resize") {
      onChange(
        resizeNode(
          current.origin,
          current.id,
          current.width + (event.clientX - current.sx) / view.k,
          current.height + (event.clientY - current.sy) / view.k,
        ),
      );
    } else {
      const [x, y] = world(event.clientX, event.clientY);
      setPointer({ x, y });
    }
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    drag.current = null;
    if (current?.kind !== "connect") return;
    setPointer(null);
    setConnectFrom(null);
    const under = document
      .elementsFromPoint(event.clientX, event.clientY)
      .map((element) => (element as HTMLElement).closest<HTMLElement>("[data-card-id]")?.dataset.cardId)
      .find((id) => id !== undefined && id !== current.from);
    if (under) onChange(connect(doc, current.from, under).doc);
  };

  const onDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const cardElement = target.closest<HTMLElement>("[data-card-id]");
    if (cardElement) {
      const node = doc.nodes.find((each) => each.id === cardElement.dataset.cardId);
      if (node?.type === "text") startEdit(node);
      else if (node?.type === "file") onOpenNote(node.file);
      return;
    }
    const [x, y] = world(event.clientX, event.clientY);
    const added = addText(doc, x, y, "");
    onChange(added.doc);
    setSelected(new Set([added.id]));
    setDraft("");
    setEditing(added.id);
  };

  // ——— keyboard
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("textarea")) {
      if (event.key === "Escape" || (event.key === "Enter" && (event.metaKey || event.ctrlKey))) {
        event.preventDefault();
        event.stopPropagation();
        commitEdit();
        (event.target as HTMLElement).closest<HTMLElement>("[data-card-id]")?.focus();
      }
      return;
    }
    const ids = [...selected];
    const step = event.shiftKey ? 50 : 10;
    const nudge: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = nudge[event.key];
    if (delta && ids.length > 0) {
      event.preventDefault();
      onChange(moveNodes(doc, ids, delta[0], delta[1]));
    } else if ((event.key === "Delete" || event.key === "Backspace") && ids.length > 0) {
      event.preventDefault();
      onChange(removeItems(doc, ids));
      setSelected(new Set());
    } else if (event.key === "Enter" && ids.length === 1) {
      const node = doc.nodes.find((each) => each.id === ids[0]);
      if (node?.type === "text") {
        event.preventDefault();
        startEdit(node);
      } else if (node?.type === "file") {
        event.preventDefault();
        onOpenNote(node.file);
      }
    } else if (event.key === "Escape" && ids.length > 0) {
      event.preventDefault();
      setSelected(new Set());
    } else if (event.key === "0" && event.target === viewportRef.current) {
      event.preventDefault();
      setView(fitDoc(doc, size.width, size.height));
    }
  };

  const transform = `translate(${size.width / 2 + view.x}px, ${size.height / 2 + view.y}px) scale(${view.k})`;
  const connecting = connectFrom ? doc.nodes.find((node) => node.id === connectFrom) : undefined;
  const edges = useMemo(() => doc.edges.map((edge) => ({ edge, path: edgePath(doc, edge) })), [doc]);

  return (
    <div
      ref={viewportRef}
      className="jc-plane"
      tabIndex={0}
      role="application"
      aria-roledescription="canvas"
      aria-label={`Canvas with ${doc.nodes.length} cards and ${doc.edges.length} lines. Double-click to write a card; Tab moves between cards.`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
    >
      <div className="jc-world" style={{ transform }}>
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
          {edges.map(({ edge, path }) =>
            path === null ? null : (
              <g
                key={edge.id}
                className={
                  selected.has(edge.fromNode) || selected.has(edge.toNode) ? "jc-edge is-near" : "jc-edge"
                }
              >
                <path
                  d={path}
                  markerEnd={edge.toEnd === "none" ? undefined : "url(#jc-arrow)"}
                  markerStart={edge.fromEnd === "arrow" ? "url(#jc-arrow)" : undefined}
                />
              </g>
            ),
          )}
          {connecting && pointer && (
            <line
              className="jc-edge-draft"
              x1={connecting.x + connecting.width / 2}
              y1={connecting.y + connecting.height / 2}
              x2={pointer.x}
              y2={pointer.y}
            />
          )}
        </svg>
        {doc.nodes.map((node) => (
          <Card
            key={node.id}
            node={node}
            note={node.type === "file" ? noteFor(node.file) : null}
            selected={selected.has(node.id)}
            editing={editing === node.id}
            draft={draft}
            onDraft={setDraft}
            onCommit={commitEdit}
            onFocus={() => setSelected((current) => (current.has(node.id) ? current : new Set([node.id])))}
          />
        ))}
        {doc.edges.map((edge) => {
          if (!edge.label) return null;
          const from = doc.nodes.find((node) => node.id === edge.fromNode);
          const to = doc.nodes.find((node) => node.id === edge.toNode);
          if (!from || !to) return null;
          const a = anchor(from, edge.fromSide ?? "right");
          const b = anchor(to, edge.toSide ?? "left");
          return (
            <span
              key={`${edge.id}-label`}
              className="jc-edge-label"
              style={{ left: (a.x + b.x) / 2, top: (a.y + b.y) / 2 }}
            >
              {edge.label}
            </span>
          );
        })}
      </div>
      {doc.nodes.length === 0 && (
        <p className="jc-empty">
          Double-click anywhere to write a card. A card holding just <code>[[a note]]</code> becomes that
          note.
        </p>
      )}
    </div>
  );
}

function toggled(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

function fitDoc(doc: CanvasDoc, width: number, height: number): View {
  return fitView(
    doc.nodes.flatMap((node) => [
      { id: `${node.id}-a`, x: node.x, y: node.y, r: 0 },
      { id: `${node.id}-b`, x: node.x + node.width, y: node.y + node.height, r: 0 },
    ]),
    width,
    height,
    64,
  );
}

function Card({
  node,
  note,
  selected,
  editing,
  draft,
  onDraft,
  onCommit,
  onFocus,
}: {
  node: CanvasNode;
  note: CanvasNoteView | null;
  selected: boolean;
  editing: boolean;
  draft: string;
  onDraft: (text: string) => void;
  onCommit: () => void;
  onFocus: () => void;
}) {
  const style = { left: node.x, top: node.y, width: node.width, height: node.height };
  const className = `jc-card jc-${node.type}${selected ? " is-selected" : ""}${node.color ? " has-color" : ""}`;
  return (
    <div
      className={className}
      style={style}
      data-card-id={node.id}
      tabIndex={0}
      role="group"
      aria-roledescription="card"
      aria-label={cardLabel(node, note)}
      onFocus={(event) => event.target === event.currentTarget && onFocus()}
    >
      {node.type === "group" && <span className="jc-group-label">{node.label ?? ""}</span>}
      {node.type === "text" &&
        (editing ? (
          <textarea
            className="jc-text-edit"
            value={draft}
            autoFocus
            aria-label="Card text"
            onChange={(event) => onDraft(event.target.value)}
            onBlur={onCommit}
          />
        ) : (
          <div className="jc-body">
            <MarkdownPeek body={node.text} className="pv-note jc-md" />
          </div>
        ))}
      {node.type === "file" && (
        <div className="jc-body">
          <p className="jc-note-title">{note?.title ?? fileTitle(node.file)}</p>
          {note === null ? (
            <p className="jc-quiet">This note isn’t in the vault anymore. The card keeps its place.</p>
          ) : note.secure ? (
            <p className="jc-quiet">Secure note. Open it to read.</p>
          ) : note.body === null ? (
            <p className="jc-quiet">Loading…</p>
          ) : (
            <MarkdownPeek body={note.body.replace(/^#\s.*\n+/, "")} className="pv-note jc-md" />
          )}
        </div>
      )}
      {node.type === "link" && (
        <div className="jc-body">
          <p className="jc-note-title">{node.url}</p>
        </div>
      )}
      {node.type === "unknown" && (
        <div className="jc-body">
          <p className="jc-quiet">Made in another app. Rotli keeps it as it is.</p>
        </div>
      )}
      {node.type !== "group" &&
        SIDES.map((side) => (
          <span key={side} className={`jc-dot jc-dot-${side}`} data-handle="connect" aria-hidden="true" />
        ))}
      <span className="jc-resize" data-handle="resize" aria-hidden="true" />
    </div>
  );
}
