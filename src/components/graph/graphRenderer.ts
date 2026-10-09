// The Graph view's imperative renderer: a flat 2D canvas of dots and
// one-pixel lines, colored only from semantic tokens read off the container
// (no raw colors, no glow — DESIGN.md "Flat material"). Labels stay quiet:
// the most-linked notes at rest, everything else on hover, keyboard focus, a search match, or
// close zoom. Hovering a note brings its neighbors forward and dims the rest.
// Plain TS, no React: graphCanvas.tsx mounts it once and feeds it props.
//
// Pointer: click opens · ⌘-click opens in a new tab · ⇧-click centers the
// graph on that note · drag a dot to move it · drag empty space to pan ·
// pinch or ⌘-scroll to zoom. Keyboard: arrows travel between notes, Enter
// opens, ⇧Enter centers, + / − zoom, 0 fits, Esc clears.

import { canvasColors } from "../../brand/tokenColors";
import { type Layout, createLayout } from "../../graph/engine/forceLayout";
import {
  type Graph,
  type GraphNode,
  labelVisible,
  nodeRadius,
  restingLabels,
  restingLineAlpha,
} from "../../graph/model";
import {
  type Direction,
  type Point,
  type View,
  fitView,
  hitTest,
  nextInDirection,
  toGraph,
  toScreen,
  zoomAt,
} from "../../graph/viewport";

interface Palette {
  ground: string;
  line: string;
  accent: string;
  dot: string;
  strong: string;
  font: string;
}

export interface GraphInput {
  graph: Graph;
  /** The local graph's center, or null for the whole vault. */
  center: string | null;
  matched: ReadonlySet<string>;
}

export interface GraphCallbacks {
  onOpen: (id: string, newTab: boolean) => void;
  onCenter: (id: string) => void;
  /** Keyboard focus moved (null = cleared) — for the live region. */
  onFocus: (node: GraphNode | null) => void;
}

const KEY_DIRECTIONS: Record<string, Direction> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

function readPalette(element: HTMLElement): Palette {
  const { ground, accent, text, muted, line } = canvasColors(element);
  const font = getComputedStyle(element).getPropertyValue("--font-body").trim() || "system-ui";
  return { ground, line, accent, dot: muted, strong: text, font };
}

/** What the layout depends on — which notes (and their size) and which
 * written links — in an order-free form. Exported for tests. */
export const graphFingerprint = (graph: Graph): string =>
  [
    // a dot's size follows its degree; its title only relabels
    ...graph.nodes.map((node) => `${node.id}\u0000${node.degree}\u0000${node.secure ? 1 : 0}`).sort(),
    // the Librarian's lines don't pull on the layout, so switching them
    // on or off redraws without moving a dot
    ...graph.edges
      .filter((edge) => !edge.suggested)
      .map((edge) =>
        edge.source < edge.target
          ? `${edge.source}\u0001${edge.target}`
          : `${edge.target}\u0001${edge.source}`,
      )
      .sort(),
  ].join("\n");

const reducedMotion = (): boolean =>
  typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function createGraphRenderer(wrap: HTMLElement, canvas: HTMLCanvasElement, callbacks: GraphCallbacks) {
  let input: GraphInput = { graph: { nodes: [], edges: [] }, center: null, matched: new Set() };
  let byId = new Map<string, GraphNode>();
  let neighbors = new Map<string, Set<string>>();
  let resting: ReadonlySet<string> = new Set();
  let layout: Layout | null = null;
  let laidOut = "";
  let palette = readPalette(wrap);
  let view: View = { x: 0, y: 0, k: 1 };
  // until the person pans or zooms, the view keeps the whole graph framed
  let autoFit = true;
  let width = 0;
  let height = 0;
  let hovered: string | null = null;
  let focused: string | null = null;
  let frame = 0;
  let drag: { id: string | null; startX: number; startY: number; moved: boolean; view: View } | null = null;

  const points = (): Point[] =>
    (layout?.nodes ?? []).map((node) => ({ id: node.id, x: node.x ?? 0, y: node.y ?? 0, r: node.r }));

  function requestDraw() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      draw();
    });
  }

  function draw() {
    const context = canvas.getContext("2d");
    if (!context || !layout) return;
    const ratio = window.devicePixelRatio || 1;
    if (autoFit) view = fitView(points(), width, height);
    const active = hovered ?? focused;
    const near = active ? (neighbors.get(active) ?? new Set<string>()) : null;
    const searching = input.matched.size > 0;
    // written lines set the texture: the Librarian's switch never fades them
    const lineAlpha = restingLineAlpha(input.graph.edges.filter((edge) => !edge.suggested).length);
    const position = new Map(layout.nodes.map((node) => [node.id, node] as const));
    const screen = (x: number | undefined, y: number | undefined) =>
      toScreen(view, width, height, x ?? 0, y ?? 0);

    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    // lines: one pixel, quiet; the active note's own lines take the accent.
    // A Librarian link is dashed and fainter — a suggestion, not a link
    // anyone wrote.
    context.lineWidth = 1;
    for (const { source, target, suggested } of input.graph.edges) {
      const a = position.get(source);
      const b = position.get(target);
      if (!a || !b) continue;
      const touches = active !== null && (source === active || target === active);
      const alpha = near === null && !searching ? lineAlpha : touches ? 1 : 0.2;
      context.globalAlpha = suggested ? alpha * 0.6 : alpha;
      context.strokeStyle = touches ? palette.accent : palette.line;
      context.setLineDash(suggested ? [4, 4] : []);
      const [ax, ay] = screen(a.x, a.y);
      const [bx, by] = screen(b.x, b.y);
      context.beginPath();
      context.moveTo(ax, ay);
      context.lineTo(bx, by);
      context.stroke();
    }
    context.setLineDash([]);

    const emphasized = new Set<string>(near ?? []);
    if (input.center) emphasized.add(input.center);
    if (active) emphasized.add(active);
    // `gap`: how far above `y` the label sits when it moves over its dot
    type Label = {
      x: number;
      y: number;
      gap: number;
      text: string;
      strong: boolean;
      alpha: number;
      degree: number;
    };
    const labels: Label[] = [];
    for (const node of layout.nodes) {
      const meta = byId.get(node.id);
      if (!meta) continue;
      const [sx, sy] = screen(node.x, node.y);
      const r = Math.max(2, node.r * Math.min(1.6, Math.max(0.6, view.k)));
      const isMatch = input.matched.has(node.id);
      const strong = node.id === input.center || node.id === active || isMatch;
      const lit = near === null || node.id === active || near.has(node.id);
      const alpha = (searching && !isMatch) || !lit ? 0.3 : 1;
      const fill = isMatch || node.id === active ? palette.accent : strong ? palette.strong : palette.dot;
      context.globalAlpha = alpha;
      context.beginPath();
      context.arc(sx, sy, r, 0, Math.PI * 2);
      // secure notes are hollow rings: the state is never color-only
      context.fillStyle = meta.secure ? palette.ground : fill;
      context.fill();
      if (meta.secure) {
        context.lineWidth = 1.5;
        context.strokeStyle = fill;
        context.stroke();
      }
      if (node.id === focused) {
        // the keyboard focus ring: an outline, offset like every focus ring
        context.globalAlpha = 1;
        context.lineWidth = 2;
        context.strokeStyle = palette.accent;
        context.beginPath();
        context.arc(sx, sy, r + 4, 0, Math.PI * 2);
        context.stroke();
      }
      context.lineWidth = 1;
      // a label off screen is never measured or placed (zoomed in on a big vault)
      const onScreen = sx > -240 && sx < width + 240 && sy > -40 && sy < height + 40;
      if (onScreen && labelVisible(meta, { zoom: view.k, resting, emphasized, matched: input.matched })) {
        labels.push({
          x: sx,
          y: sy + r + 4,
          gap: 2 * r + 8,
          text: meta.title,
          strong,
          alpha,
          degree: meta.degree,
        });
      }
    }

    // labels last, so no line crosses a word; emphasized labels claim their
    // space first and a quieter label that would overlap one is skipped
    context.textAlign = "center";
    context.textBaseline = "top";
    labels.sort((a, b) => Number(b.strong) - Number(a.strong) || b.degree - a.degree);
    const placed: { left: number; right: number; top: number; bottom: number }[] = [];
    for (const label of labels) {
      context.font = `${label.strong ? 600 : 400} 12px ${palette.font}`;
      const text = label.text.length > 42 ? `${label.text.slice(0, 41)}…` : label.text;
      const half = context.measureText(text).width / 2 + 3;
      const boxAt = (top: number) => ({ left: label.x - half, right: label.x + half, top, bottom: top + 15 });
      const free = (box: { left: number; right: number; top: number; bottom: number }) =>
        !placed.some(
          (other) =>
            box.left < other.right &&
            box.right > other.left &&
            box.top < other.bottom &&
            box.bottom > other.top,
        );
      // below the dot first, then above it; a quieter label with no room is skipped
      const below = boxAt(label.y);
      const above = boxAt(label.y - label.gap - 15);
      const box = free(below) ? below : free(above) ? above : label.strong ? below : null;
      if (!box) continue;
      placed.push(box);
      context.globalAlpha = label.alpha;
      context.fillStyle = label.strong ? palette.strong : palette.dot;
      context.fillText(text, label.x, box.top);
    }
    context.globalAlpha = 1;
  }

  function setFocused(id: string | null) {
    focused = id;
    // keyboard travel keeps the focused note on screen
    const node = id ? layout?.nodes.find((each) => each.id === id) : undefined;
    if (node) {
      const [sx, sy] = toScreen(view, width, height, node.x ?? 0, node.y ?? 0);
      const margin = 48;
      if (sx < margin || sx > width - margin || sy < margin || sy > height - margin) {
        autoFit = false;
        view = { ...view, x: view.x + width / 2 - sx, y: view.y + height / 2 - sy };
      }
    }
    callbacks.onFocus(id ? (byId.get(id) ?? null) : null);
    requestDraw();
  }

  function local(event: { clientX: number; clientY: number }): [number, number] {
    const rect = canvas.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  }

  function nodeAt(sx: number, sy: number): string | null {
    const [gx, gy] = toGraph(view, width, height, sx, sy);
    return hitTest(points(), gx, gy, 6 / view.k);
  }

  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0) return;
    const [sx, sy] = local(event);
    canvas.setPointerCapture(event.pointerId);
    drag = { id: nodeAt(sx, sy), startX: sx, startY: sy, moved: false, view };
  }

  function onPointerMove(event: PointerEvent) {
    // the button came up somewhere this canvas never heard about
    if (drag && event.buttons === 0) endDrag();
    const [sx, sy] = local(event);
    if (!drag) {
      const id = nodeAt(sx, sy);
      if (id !== hovered) {
        hovered = id;
        canvas.classList.toggle("is-pointing", id !== null);
        requestDraw();
      }
      return;
    }
    if (!drag.moved && Math.hypot(sx - drag.startX, sy - drag.startY) < 4) return;
    drag.moved = true;
    autoFit = false;
    if (drag.id) {
      const [gx, gy] = toGraph(view, width, height, sx, sy);
      layout?.hold(drag.id, gx, gy);
    } else {
      view = { ...drag.view, x: drag.view.x + sx - drag.startX, y: drag.view.y + sy - drag.startY };
      requestDraw();
    }
  }

  /** End a drag however it ends — a release, a cancelled pointer, a lost
   * capture — so nothing is left following a pointer no one is pressing. */
  function endDrag(): typeof drag {
    const current = drag;
    drag = null;
    if (current?.id && current.moved) layout?.rest();
    return current;
  }

  function onPointerUp(event: PointerEvent) {
    const current = endDrag();
    if (!current?.id) return;
    // a dragged dot stays where it was put (until the layout is rebuilt)
    if (current.moved) return;
    if (event.shiftKey) callbacks.onCenter(current.id);
    else callbacks.onOpen(current.id, event.metaKey || event.ctrlKey);
  }

  function onPointerLeave() {
    if (drag || hovered === null) return;
    hovered = null;
    canvas.classList.remove("is-pointing");
    requestDraw();
  }

  // pinch (ctrlKey) or ⌘-scroll zooms at the pointer; a plain two-finger
  // scroll pans — the Mac trackpad's own grammar
  function onWheel(event: WheelEvent) {
    event.preventDefault();
    autoFit = false;
    if (event.ctrlKey || event.metaKey) {
      const [sx, sy] = local(event);
      view = zoomAt(view, width, height, sx, sy, Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.002)));
    } else {
      view = { ...view, x: view.x - event.deltaX, y: view.y - event.deltaY };
    }
    requestDraw();
  }

  function startNode(): string | null {
    if (input.center && byId.has(input.center)) return input.center;
    let best: GraphNode | null = null;
    for (const node of input.graph.nodes) if (!best || node.degree > best.degree) best = node;
    return best?.id ?? null;
  }

  function onKeyDown(event: KeyboardEvent) {
    // app shortcuts (⌘0, ⌘=, ⌘←, ⌘⌥ arrows…) pass through; only ⌘↩ is ours
    if ((event.metaKey || event.ctrlKey || event.altKey) && event.key !== "Enter") return;
    const direction = KEY_DIRECTIONS[event.key];
    if (direction) {
      event.preventDefault();
      const next = focused && byId.has(focused) ? nextInDirection(points(), focused, direction) : startNode();
      if (next) setFocused(next);
    } else if (event.key === "Enter" && focused) {
      event.preventDefault();
      if (event.shiftKey) callbacks.onCenter(focused);
      else callbacks.onOpen(focused, event.metaKey || event.ctrlKey);
    } else if (event.key === "Escape" && focused) {
      event.preventDefault();
      event.stopPropagation();
      setFocused(null);
    } else if (event.key === "+" || event.key === "=" || event.key === "-") {
      event.preventDefault();
      autoFit = false;
      view = zoomAt(view, width, height, width / 2, height / 2, event.key === "-" ? 0.8 : 1.25);
      requestDraw();
    } else if (event.key === "0") {
      event.preventDefault();
      autoFit = true;
      requestDraw();
    }
  }

  const onBlur = () => {
    if (focused) setFocused(null);
  };

  // size the backing store to the pane (crisp on Retina)
  const resize = new ResizeObserver(() => {
    const rect = wrap.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    width = rect.width;
    height = rect.height;
    // the element fills the pane by CSS; only the backing store is sized here
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    draw();
  });
  resize.observe(wrap);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", endDrag);
  canvas.addEventListener("lostpointercapture", endDrag);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("keydown", onKeyDown);
  canvas.addEventListener("blur", onBlur);

  return {
    /** New data or scope. A changed graph re-lays out, keeping known positions. */
    update(next: GraphInput) {
      // the note list's identity churns on every refetch, and its order on
      // every edit or pin; only a real change in which notes and links there
      // are re-lays the graph out (titles only relabel)
      const fingerprint = graphFingerprint(next.graph);
      const graphChanged = fingerprint !== laidOut;
      laidOut = fingerprint;
      const centerChanged = next.center !== input.center;
      input = next;
      // hover lights every line drawn, Librarian links included
      neighbors = new Map();
      for (const { source, target } of next.graph.edges) {
        neighbors.set(source, (neighbors.get(source) ?? new Set()).add(target));
        neighbors.set(target, (neighbors.get(target) ?? new Set()).add(source));
      }
      byId = new Map(next.graph.nodes.map((node) => [node.id, node] as const));
      resting = restingLabels(next.graph);
      if (graphChanged) {
        const previous = new Map(
          (layout?.nodes ?? []).map((node) => [node.id, { x: node.x ?? 0, y: node.y ?? 0 }] as const),
        );
        layout?.stop();
        layout = createLayout(
          next.graph.nodes.map((node) => ({ id: node.id, r: nodeRadius(node) })),
          next.graph.edges.filter((edge) => !edge.suggested),
          { animate: !reducedMotion(), onTick: requestDraw, previous },
        );
        if (focused && !byId.has(focused)) setFocused(null);
      }
      // a new scope reframes
      if (centerChanged) autoFit = true;
      requestDraw();
    },
    /** The theme changed: re-read the tokens. */
    repaint() {
      palette = readPalette(wrap);
      requestDraw();
    },
    destroy() {
      layout?.stop();
      cancelAnimationFrame(frame);
      resize.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", endDrag);
      canvas.removeEventListener("lostpointercapture", endDrag);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("keydown", onKeyDown);
      canvas.removeEventListener("blur", onBlur);
    },
  };
}

export type GraphRenderer = ReturnType<typeof createGraphRenderer>;
