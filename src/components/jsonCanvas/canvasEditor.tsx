// The Canvas editor (2026-10-05): cards on an open plane, the JSON Canvas
// file as its only truth. Calm by construction — no toolbar, no zoom widget,
// no minimap. A card's connect dots show only on hover or focus; a selected
// card shows nothing more than an outline; a line's handle is a quiet dot
// until you point at it.
//
// Pointer: double-click empty space writes a card (inside a group, too) ·
// drag a card to move it · drag its corner to resize · drag a side dot onto
// another card to connect · click a line's middle to pick the line · drag
// empty space to pan · pinch or ⌘-scroll to zoom. A card holding just
// [[a note]] becomes that note's card when you finish typing.
// Keyboard: Tab reaches each card and each line · Enter edits a text card,
// opens a note, or names a group or line · G gathers the selected cards into
// a group · arrows nudge (⇧ for more) · Delete removes · Esc deselects · 0 fits.

import { useEffect, useRef, useState } from "react";

import { type Direction, type View, fitView, nextInDirection, toGraph, zoomAt } from "../../graph/viewport";
import type { CanvasNoteView } from "../../jsonCanvas/canvasNotes";
import { type CanvasDoc, type CanvasNode, fileTitle } from "../../jsonCanvas/model";
import {
  addFile,
  addText,
  applyEdit,
  bringToFront,
  connect,
  groupAround,
  growGroupAround,
  moveNodes,
  nudgeFor,
  removeItems,
  resizeNode,
} from "../../jsonCanvas/workflow";
import { setActiveCanvas } from "../../lib/canvasCommands";
import { registerCanvasDrop } from "../../lib/canvasDrop";
import { Card, type CanvasEditing } from "./canvasCard";
import { EdgeHandles, EdgeLines } from "./canvasEdges";

export type { CanvasNoteView } from "../../jsonCanvas/canvasNotes";
export { edgePath } from "./canvasEdges";

export interface CanvasEditorProps {
  doc: CanvasDoc;
  onChange: (doc: CanvasDoc) => void;
  /** The note a card's path names, or null when none answers. */
  noteFor: (path: string) => CanvasNoteView | null;
  /** The path `[[target]]` resolves to, or null. */
  resolveLink: (target: string) => string | null;
  onOpenNote: (path: string) => void;
  /** The vault path a dragged note's card names, or null for anything that
   * isn't a note (a folder, a board, a file). */
  notePathFor?: (noteId: string) => string | null;
  /** Look, pan, zoom, and open notes; change nothing (a read-only place, or
   * a canvas whose file changed on disk). */
  readOnly?: boolean;
}

type Drag =
  | { kind: "pan"; sx: number; sy: number; view: View }
  | { kind: "move"; sx: number; sy: number; ids: string[]; origin: CanvasDoc; moved: boolean }
  | { kind: "resize"; sx: number; sy: number; id: string; width: number; height: number; origin: CanvasDoc }
  | { kind: "connect"; from: string; origin: CanvasDoc };

export function CanvasEditor({
  doc,
  onChange,
  noteFor,
  resolveLink,
  onOpenNote,
  notePathFor,
  readOnly = false,
}: CanvasEditorProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [editing, setEditing] = useState<CanvasEditing>(null);
  const [draft, setDraft] = useState("");
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  // the card a line is being drawn from (state, so the draft line renders)
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const drag = useRef<Drag | null>(null);
  // the plane (or a card in it) has focus: its keyboard commands are live
  const [hasFocus, setHasFocus] = useState(false);
  // "connect by keyboard": the card a line will start from, waiting for an arrow
  const [keyConnectFrom, setKeyConnectFrom] = useState<string | null>(null);
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
      if ((event.target as HTMLElement).closest("textarea, input")) return;
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

  // a note dragged in from the sidebar lands as its card where it's dropped;
  // several fan out a step apart
  useEffect(() => {
    const plane = viewportRef.current;
    if (!plane || !notePathFor || readOnly) return;
    return registerCanvasDrop(plane, (noteIds, clientX, clientY) => {
      const rect = plane.getBoundingClientRect();
      const [x, y] = toGraph(view, rect.width, rect.height, clientX - rect.left, clientY - rect.top);
      let next = doc;
      const added: string[] = [];
      for (const path of noteIds.map(notePathFor).filter((each) => each !== null)) {
        const card = addFile(next, x + added.length * 32, y + added.length * 32, path);
        next = card.doc;
        added.push(card.id);
      }
      if (added.length === 0) return;
      onChange(next);
      setSelected(new Set(added));
      setSelectedEdge(null);
    });
  }, [doc, view, notePathFor, onChange, readOnly]);

  // the remappable keys (keys/canvasActions.ts) act on the focused canvas
  useEffect(() => {
    if (!hasFocus) return;
    const only = () => (selected.size === 1 ? doc.nodes.find((node) => selected.has(node.id)) : undefined);
    return setActiveCanvas({
      newCard: () => {
        if (readOnly || selected.size > 0 || editing !== null) return;
        const [x, y] = toGraph(view, size.width, size.height, size.width / 2, size.height / 2);
        const added = addText(doc, x, y, "");
        onChange(added.doc);
        setSelected(new Set([added.id]));
        setDraft("");
        setEditing({ id: added.id, field: "text" });
      },
      startConnect: () => {
        const from = only();
        if (!readOnly && from && from.type !== "group") setKeyConnectFrom(from.id);
      },
      group: () => {
        if (readOnly || selected.size === 0) return;
        const grouped = groupAround(doc, [...selected]);
        if (grouped.id === null) return;
        onChange(grouped.doc);
        setSelected(new Set([grouped.id]));
        setDraft("");
        setEditing({ id: grouped.id, field: "label" });
      },
      resize: (dw, dh) => {
        const card = only();
        if (!readOnly && card) onChange(resizeNode(doc, card.id, card.width + dw, card.height + dh));
      },
    });
  }, [hasFocus, doc, view, size, selected, editing, readOnly, onChange]);

  const world = (clientX: number, clientY: number): [number, number] => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return [0, 0];
    return toGraph(view, rect.width, rect.height, clientX - rect.left, clientY - rect.top);
  };

  const pickCards = (ids: ReadonlySet<string>) => {
    setSelected(ids);
    if (ids.size > 0) setSelectedEdge(null);
  };
  const pickEdge = (id: string | null) => {
    setSelectedEdge(id);
    if (id) setSelected(new Set());
  };

  /** Save the open edit, and answer the doc it produced — a gesture that
   * starts in the same breath (a drag) must build on THAT doc, not the one
   * this render saw, or the typed text is written back over (audit P0). */
  const commitEdit = (): CanvasDoc => {
    if (editing === null) return doc;
    const { id, field } = editing;
    setEditing(null);
    const next = applyEdit(doc, id, field, draft, resolveLink);
    if (next !== doc) onChange(next);
    return next;
  };
  const cancelEdit = () => setEditing(null);

  const startEdit = (node: CanvasNode) => {
    if (readOnly) return;
    if (node.type === "text") {
      pickCards(new Set([node.id]));
      setDraft(node.text);
      setEditing({ id: node.id, field: "text" });
    } else if (node.type === "group") {
      pickCards(new Set([node.id]));
      setDraft(node.label ?? "");
      setEditing({ id: node.id, field: "label" });
    }
  };
  const startEdgeEdit = (id: string) => {
    if (readOnly) return;
    pickEdge(id);
    setDraft(doc.edges.find((edge) => edge.id === id)?.label ?? "");
    setEditing({ id, field: "label" });
  };

  const writeCardAt = (clientX: number, clientY: number, groupId?: string) => {
    if (readOnly) return;
    const [x, y] = world(clientX, clientY);
    const added = addText(doc, x, y, "");
    // a card written on a group's floor stays inside it
    onChange(groupId ? growGroupAround(added.doc, groupId, added.id) : added.doc);
    pickCards(new Set([added.id]));
    setDraft("");
    setEditing({ id: added.id, field: "text" });
  };

  // ——— pointer on the plane
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("textarea, input")) return;
    const edgeId = target.closest<HTMLElement>("[data-edge-id]")?.dataset.edgeId;
    const base = commitEdit();
    if (edgeId) {
      pickEdge(edgeId);
      return;
    }
    const handle = target.closest<HTMLElement>("[data-handle]");
    const id = target.closest<HTMLElement>("[data-card-id]")?.dataset.cardId;
    viewportRef.current?.setPointerCapture(event.pointerId);
    if (handle && id && !readOnly) {
      if (handle.dataset.handle === "resize") {
        const node = base.nodes.find((each) => each.id === id);
        if (node) {
          drag.current = {
            kind: "resize",
            sx: event.clientX,
            sy: event.clientY,
            id,
            width: node.width,
            height: node.height,
            origin: base,
          };
        }
      } else {
        drag.current = { kind: "connect", from: id, origin: base };
        setConnectFrom(id);
        setPointer(null);
      }
      return;
    }
    if (id) {
      const next = event.shiftKey ? toggled(selected, id) : selected.has(id) ? selected : new Set([id]);
      pickCards(next);
      // looking at a read-only canvas still selects; it never moves
      if (readOnly) return;
      drag.current = {
        kind: "move",
        sx: event.clientX,
        sy: event.clientY,
        ids: [...next],
        origin: base,
        moved: false,
      };
      return;
    }
    if (!event.shiftKey) {
      setSelected(new Set());
      setSelectedEdge(null);
    }
    drag.current = { kind: "pan", sx: event.clientX, sy: event.clientY, view };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    // the button came up somewhere this plane never heard about
    if (event.buttons === 0) return cancelGesture();
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

  /** A gesture that ends any way but a release (a cancelled pointer, a lost
   * capture) leaves nothing following a pointer no one is pressing. */
  const cancelGesture = () => {
    drag.current = null;
    setConnectFrom(null);
    setPointer(null);
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
    if (under) onChange(connect(current.origin, current.from, under).doc);
  };

  const onDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    // the first click's drag captured the pointer on the plane, so ask what is
    // really under it rather than trusting the event's target
    const target = (document.elementFromPoint(event.clientX, event.clientY) ?? event.target) as HTMLElement;
    if (target.closest("textarea, input")) return;
    const edgeId = target.closest<HTMLElement>("[data-edge-id]")?.dataset.edgeId;
    if (edgeId) return startEdgeEdit(edgeId);
    const cardElement = target.closest<HTMLElement>("[data-card-id]");
    const node = cardElement ? doc.nodes.find((each) => each.id === cardElement.dataset.cardId) : undefined;
    if (node?.type === "text") return startEdit(node);
    if (node?.type === "file") return onOpenNote(node.file);
    if (readOnly) return;
    if (node?.type === "group" && target.closest("[data-group-label]")) return startEdit(node);
    // empty space, or the open floor of a group: write a card there
    if (!node || node.type === "group") writeCardAt(event.clientX, event.clientY, node?.id);
  };

  // ——— keyboard
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("input")) return; // the name field keeps its own keys
    if (target.closest("textarea")) {
      if (event.key === "Escape" || (event.key === "Enter" && (event.metaKey || event.ctrlKey))) {
        event.preventDefault();
        event.stopPropagation();
        commitEdit();
        target.closest<HTMLElement>("[data-card-id]")?.focus();
      }
      return;
    }
    if (readOnly) {
      // looking only: open a note, deselect, fit — nothing that edits
      const only = selected.size === 1 ? doc.nodes.find((each) => selected.has(each.id)) : undefined;
      if (event.key === "Enter" && only?.type === "file") {
        event.preventDefault();
        onOpenNote(only.file);
      } else if (event.key === "Escape") {
        setSelected(new Set());
        setSelectedEdge(null);
      } else if (event.key === "0" && event.target === viewportRef.current) {
        event.preventDefault();
        setView(fitDoc(doc, size.width, size.height));
      }
      return;
    }
    if (keyConnectFrom !== null) {
      // C was pressed: an arrow picks the nearest card that way; anything
      // else stands the connection down
      const direction = ARROW_DIRECTIONS[event.key];
      event.preventDefault();
      setKeyConnectFrom(null);
      if (!direction) return;
      const centers = doc.nodes
        .filter((node) => node.type !== "group")
        .map((node) => ({ id: node.id, x: node.x + node.width / 2, y: node.y + node.height / 2, r: 0 }));
      const target = nextInDirection(centers, keyConnectFrom, direction);
      if (target) onChange(connect(doc, keyConnectFrom, target).doc);
      return;
    }
    if (selectedEdge) {
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        onChange(removeItems(doc, [selectedEdge]));
        setSelectedEdge(null);
        viewportRef.current?.focus();
      } else if (event.key === "Enter") {
        event.preventDefault();
        startEdgeEdit(selectedEdge);
      } else if (event.key === "Escape") {
        event.preventDefault();
        setSelectedEdge(null);
        viewportRef.current?.focus();
      }
      return;
    }
    const ids = [...selected];
    const delta = nudgeFor(event);
    if (delta && ids.length > 0) {
      event.preventDefault();
      onChange(moveNodes(doc, ids, delta[0], delta[1]));
    } else if ((event.key === "Delete" || event.key === "Backspace") && ids.length > 0) {
      event.preventDefault();
      onChange(removeItems(doc, ids));
      setSelected(new Set());
    } else if (event.key === "Enter" && ids.length === 1) {
      const node = doc.nodes.find((each) => each.id === ids[0]);
      if (node?.type === "file") {
        event.preventDefault();
        onOpenNote(node.file);
      } else if (node) {
        event.preventDefault();
        startEdit(node);
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
  const titleOf = (id: string) => {
    const node = doc.nodes.find((each) => each.id === id);
    if (!node) return "a missing card";
    if (node.type === "file") return noteFor(node.file)?.title ?? fileTitle(node.file);
    if (node.type === "text") return node.text.split("\n")[0]?.replace(/^#+\s*/, "") || "an empty card";
    if (node.type === "group") return node.label ?? "a group";
    return "a card";
  };

  return (
    <div
      ref={viewportRef}
      className="jc-plane"
      data-canvas-drop="true"
      tabIndex={0}
      role="application"
      aria-roledescription="canvas"
      aria-label={`Canvas with ${doc.nodes.length} cards and ${doc.edges.length} lines. Double-click or press Enter to write a card; Tab moves between cards and lines; C then an arrow connects; G groups; Shift-Option-arrows resize.`}
      onFocus={() => setHasFocus(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setHasFocus(false);
          setKeyConnectFrom(null);
        }
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={cancelGesture}
      onLostPointerCapture={(event) => {
        // the release itself loses capture too; only an orphaned gesture is cancelled
        if (event.buttons !== 0) cancelGesture();
      }}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
    >
      <div className="jc-world" style={{ transform }}>
        <EdgeLines
          doc={doc}
          near={selected}
          selectedEdge={selectedEdge}
          draftFrom={
            connecting
              ? { x: connecting.x + connecting.width / 2, y: connecting.y + connecting.height / 2 }
              : null
          }
          pointer={pointer}
        />
        {doc.nodes.map((node) => (
          <Card
            key={node.id}
            node={node}
            note={node.type === "file" ? noteFor(node.file) : null}
            selected={selected.has(node.id)}
            editing={editing?.id === node.id ? editing.field : null}
            draft={draft}
            onDraft={setDraft}
            onCommit={commitEdit}
            onCancel={cancelEdit}
            onFocus={() => pickCards(selected.has(node.id) ? selected : new Set([node.id]))}
          />
        ))}
        <EdgeHandles
          doc={doc}
          titleOf={titleOf}
          selectedEdge={selectedEdge}
          editingEdge={
            editing?.field === "label" && !doc.nodes.some((n) => n.id === editing.id) ? editing.id : null
          }
          draft={draft}
          onDraft={setDraft}
          onCommit={commitEdit}
          onCancel={cancelEdit}
          onSelect={pickEdge}
        />
      </div>
      {keyConnectFrom !== null && (
        <p className="jc-key-hint" role="status">
          Press an arrow to connect to the nearest card that way. Esc stops.
        </p>
      )}
      {doc.nodes.length === 0 && (
        <p className="jc-empty">
          Double-click anywhere to write a card. A card holding just <code>[[a note]]</code> becomes that
          note.
        </p>
      )}
    </div>
  );
}

const ARROW_DIRECTIONS: Record<string, Direction> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

function toggled(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** The whole canvas in view, never zoomed past its own size: a canvas of
 * one small card opens at 100%, not blown up. */
function fitDoc(doc: CanvasDoc, width: number, height: number): View {
  const fitted = fitView(
    doc.nodes.flatMap((node) => [
      { id: `${node.id}-a`, x: node.x, y: node.y, r: 0 },
      { id: `${node.id}-b`, x: node.x + node.width, y: node.y + node.height, r: 0 },
    ]),
    width,
    height,
    64,
  );
  return fitted.k > 1 ? { k: 1, x: fitted.x / fitted.k, y: fitted.y / fitted.k } : fitted;
}
