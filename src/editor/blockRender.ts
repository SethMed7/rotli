// The fenced-block render layer (Phase 1e). Renders the target languages
// (```math · ```mermaid · ```jsxgraph · ```svg · ```html) inline in the editor, composed ALONGSIDE
// livePreview. livePreview SKIPS fenced lines (see fences.ts), so the two never
// collide; blockRender owns the whole multi-line fenced range.
//
// rotli law: the .md is the source of truth. This is a RENDER layer — it never
// rewrites the user's text. The reveal-on-caret model mirrors livePreview at
// BLOCK granularity: when the selection touches the fenced range, render NOTHING
// (the raw source shows, editable); otherwise replace the range with a block
// widget + mark it atomic so the caret skips it. Raw-markdown mode turns this off
// (CmEditor's viewModeComp).
//
// ARCHITECTURE: the decorations come from a StateField, NOT a ViewPlugin —
// CodeMirror forbids block (line-break-crossing) decorations from plugins
// ("Block decorations may not be specified via plugins"). A second, decoration-
// free ViewPlugin watches the theme (a DOM MutationObserver, since the theme is
// applied to documentElement AFTER the store updates) and bumps a rebuild so
// mermaid/jsxgraph re-bake their colors on a theme flip.

import { type EditorState, type Range, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, WidgetType } from "@codemirror/view";

import { createEditableBoardFromMermaid } from "../boards/composition";
import { isTauri } from "../lib/tauri";
import { findLeaf, leaves, usePanesStore } from "../state/panes";
import { isDarkDataTheme } from "../state/theme";
import { useUiStore } from "../state/ui";
import { installEmbedControls } from "./embedControls";
import { mountBoardEmbed, mountDocumentEmbed, mountSheetEmbed } from "./embedHosts";
import { type FenceBlock, type LangKey, innerCode, scanFences } from "./fences";
import { mermaidErrorMessage, renderMermaidElement } from "./mermaidRender";
import {
  type MermaidViewport,
  fitMermaidViewport,
  panMermaidViewport,
  zoomMermaidViewportAt,
} from "./mermaidViewport";
import { mountMermaidWorkspace } from "./mermaidWorkspace";
import { sanitizeSvg } from "./svgSanitizer";

// Heavy fence libs (katex / mermaid / jsxgraph) load on first use — they used to
// ride every note-editor open via a static import. CSS follows the same gate.

// ——— theme resolution ———————————————————————————————————————————————

/** Root-theme "is dark?" — for the Expand overlay, which lives on document.body. */
function isDarkRoot(): boolean {
  return isDarkDataTheme(document.documentElement.dataset.theme);
}

/** "Is dark?" for an IN-EDITOR node — resolved from the node's computed text
 * color (light text ⇒ dark surface). */
function isDarkNode(node: HTMLElement): boolean {
  const m = /rgba?\(([^)]+)\)/.exec(getComputedStyle(node).color);
  if (!m?.[1]) return isDarkRoot();
  const [r, g, b] = m[1].split(",").map((x) => Number.parseFloat(x));
  const lum = (0.299 * (r ?? 0) + 0.587 * (g ?? 0) + 0.114 * (b ?? 0)) / 255;
  return lum > 0.6;
}

/** Read a kit token off a live node (falls back to documentElement). Trimmed —
 * getComputedStyle returns values with leading whitespace (Icon.tsx pattern). */
function tokenReader(node: HTMLElement): (name: string) => string {
  const cs = getComputedStyle(node);
  const root = getComputedStyle(document.documentElement);
  return (name) => {
    const v = cs.getPropertyValue(name).trim();
    return v || root.getPropertyValue(name).trim();
  };
}

interface RenderCtx {
  dark: boolean;
  tokens: (name: string) => string;
  id: string;
}

type StaticLangKey = Exclude<LangKey, "board" | "sheet" | "document">;

function errorBox(message: string): HTMLElement {
  const box = document.createElement("div");
  box.className = "rotli-render-error";
  box.textContent = message;
  return box;
}

let katexCssReady: Promise<void> | null = null;
let jsxgraphCssReady: Promise<void> | null = null;

async function loadKatex() {
  katexCssReady ??= import("katex/dist/katex.min.css").then(() => undefined);
  const [{ default: katex }] = await Promise.all([import("katex"), katexCssReady]);
  return katex;
}

async function loadJsxgraph() {
  // jsxgraph's package "exports" map hides ./distrib/* — import the stylesheet by
  // a filesystem-relative path so Vite resolves it directly (bypassing exports).
  jsxgraphCssReady ??= import("../../node_modules/jsxgraph/distrib/jsxgraph.css").then(() => undefined);
  const [{ default: JXG }] = await Promise.all([import("jsxgraph"), jsxgraphCssReady]);
  return JXG;
}

// ——— the renderer registry — one function per language, shared infra ————

const RENDERERS: Record<StaticLangKey, (code: string, ctx: RenderCtx) => HTMLElement | Promise<HTMLElement>> =
  {
    // KaTeX inherits text color via currentColor — no theme injection needed.
    math: async (code) => {
      const katex = await loadKatex();
      const el = document.createElement("div");
      el.className = "rotli-render-math";
      try {
        el.innerHTML = katex.renderToString(code, {
          displayMode: true,
          throwOnError: false,
          errorColor: "currentColor",
        });
      } catch (e) {
        return errorBox(`math: ${(e as Error).message}`);
      }
      return el;
    },

    mermaid: async (code, ctx) => {
      try {
        return await renderMermaidElement(code, { dark: ctx.dark, id: ctx.id });
      } catch (e) {
        return errorBox(`mermaid: ${mermaidErrorMessage(e)}`);
      }
    },

    jsxgraph: async (code, ctx) => {
      const el = document.createElement("div");
      el.className = "rotli-render-jsxgraph";
      const src = code.trim();
      if (!src) return el; // empty fence while live-typing — quiet placeholder
      const JXG = await loadJsxgraph();
      try {
        const attrs: Record<string, unknown> = {
          boundingbox: [-8, 8, 8, -8],
          axis: true,
          // JSXGraph defaults JessieCode to an eval-based compiler. Production's
          // CSP deliberately omits unsafe-eval, so use its interpreter path in
          // every build; dev and release must execute the same grammar.
          jc: { compile: false },
          showCopyright: false,
          showNavigation: false,
          keepAspectRatio: false,
          defaultAxes: {
            x: { strokeColor: ctx.tokens("--text-muted"), ticks: { strokeColor: ctx.tokens("--border") } },
            y: { strokeColor: ctx.tokens("--text-muted"), ticks: { strokeColor: ctx.tokens("--border") } },
          },
          grid: { strokeColor: ctx.tokens("--border") },
        };
        const board = JXG.JSXGraph.initBoard(el, attrs);
        (el as RenderEl).__freeBoard = () => {
          try {
            JXG.JSXGraph.freeBoard(board);
          } catch {
            /* ignore */
          }
        };

        // Theme the DEFAULT element colors so JessieCode-created objects read on
        // both light + dark. board.options is a per-board deepCopy, so this is local.
        const accent = ctx.tokens("--accent");
        const text = ctx.tokens("--text");
        const opt = board.options as unknown as Record<string, Record<string, unknown>>;
        for (const kind of ["point", "line", "curve", "functiongraph", "circle", "polygon", "arc"]) {
          const o = opt[kind];
          if (o) {
            o.strokeColor = accent;
            o.highlightStrokeColor = accent;
            if (kind === "point" || kind === "circle" || kind === "polygon") o.fillColor = accent;
          }
        }
        if (opt.text) opt.text.strokeColor = text;

        board.jc.parse(src);
      } catch (e) {
        (el as RenderEl).__freeBoard?.();
        delete (el as RenderEl).__freeBoard;
        return errorBox(`jsxgraph: ${(e as Error).message}`);
      }
      return el;
    },

    // A ```svg fence renders a fresh allowlisted SVG tree. Note content is
    // untrusted: scripts, events, foreignObject, resource links, unsafe URLs,
    // styles, and unexpected namespaces never enter the live document.
    svg: (code) => {
      const el = document.createElement("div");
      el.className = "rotli-render-svg";
      const src = code.trim();
      if (!src) return el; // empty fence while live-typing — quiet placeholder
      try {
        el.appendChild(sanitizeSvg(src));
        return el;
      } catch (error) {
        return errorBox(`svg: ${(error as Error).message}`);
      }
    },

    // a ```html fence renders the markup in a SANDBOXED srcdoc iframe (same
    // code ⇄ preview model as svg: click the block to reveal/edit the source).
    // Verified against the shipped CSP in WebKit: frame-src doesn't block
    // about:srcdoc, and `sandbox` WITHOUT allow-scripts refuses to run any
    // <script> in the fence ("Blocked script execution … 'allow-scripts'
    // permission is not set"). The srcdoc document also inherits the app CSP
    // (script-src 'self'), so scripts are doubly off. Never loosen the sandbox
    // for note content — fences are untrusted the moment a note is shared.
    html: (code) => {
      const el = document.createElement("div");
      el.className = "rotli-render-html";
      const src = code.trim();
      if (!src) return el; // empty fence while live-typing — quiet placeholder
      const frame = document.createElement("iframe");
      frame.setAttribute("sandbox", ""); // opaque origin, no scripts
      frame.title = "html preview";
      frame.srcdoc = src;
      el.appendChild(frame);
      return el;
    },
  };

type RenderEl = HTMLElement & { __freeBoard?: () => void };

function freeIfBoard(node: HTMLElement | null): void {
  const el = node as RenderEl | null;
  if (!el?.__freeBoard) return;
  el.__freeBoard();
  delete el.__freeBoard;
}

// ——— render cache (LRU, capped) — keyed by lang + resolved colors + code ————

const CACHE = new Map<string, HTMLElement>();
const CACHE_CAP = 50;

function cacheGet(key: string): HTMLElement | undefined {
  const hit = CACHE.get(key);
  if (hit) {
    CACHE.delete(key);
    CACHE.set(key, hit); // LRU touch
    return hit.cloneNode(true) as HTMLElement;
  }
  return undefined;
}

function cacheSet(key: string, el: HTMLElement): void {
  CACHE.set(key, el.cloneNode(true) as HTMLElement);
  while (CACHE.size > CACHE_CAP) {
    const oldest = CACHE.keys().next().value;
    if (oldest === undefined) break;
    CACHE.delete(oldest);
  }
}

// ——— live embed widgets (board / sheet) ————————————————————————————————

class EmbedBlockWidget extends WidgetType {
  private cleanup: (() => void) | null = null;
  private interactionCleanup: (() => void) | null = null;

  constructor(
    readonly kind: "board" | "sheet" | "document",
    readonly fileId: string,
    readonly themeSig: string,
  ) {
    super();
  }

  eq(o: EmbedBlockWidget): boolean {
    return o.kind === this.kind && o.fileId === this.fileId && o.themeSig === this.themeSig;
  }

  toDOM(): HTMLElement {
    const container = document.createElement("div");
    container.className = "rotli-render-block rotli-render-embed";
    container.dataset.lang = this.kind;

    const body = document.createElement("div");
    body.className = "rotli-render-body";
    body.id = `rotli-embed-${cryptoId()}`;
    container.appendChild(body);

    this.interactionCleanup = installEmbedControls({
      container,
      body,
      kind: this.kind,
      // resized heights survive rebuilds + restarts, per embedded file
      persistKey: this.fileId.trim(),
      onOpen: () => {
        if (this.kind === "board") usePanesStore.getState().openCanvas(this.fileId, { newTab: true });
        else usePanesStore.getState().openFile(this.fileId, { newTab: true });
      },
    });

    const id = this.fileId.trim();
    if (id) {
      let cancelled = false;
      const mount =
        this.kind === "board"
          ? mountBoardEmbed(body, id)
          : this.kind === "sheet"
            ? mountSheetEmbed(body, id)
            : mountDocumentEmbed(body, id);
      void mount.then((cleanup) => {
        if (cancelled) {
          cleanup();
          return;
        }
        this.cleanup = cleanup;
      });
      this.cleanup = () => {
        cancelled = true;
      };
    } else {
      body.textContent = "Pick a file path for this embed";
    }
    return container;
  }

  ignoreEvent(): boolean {
    return true;
  }

  destroy(): void {
    this.cleanup?.();
    this.cleanup = null;
    this.interactionCleanup?.();
    this.interactionCleanup = null;
  }
}

// ——— the block widget ————————————————————————————————————————————————

class RenderBlockWidget extends WidgetType {
  private destroyed = false;
  private dom: HTMLElement | null = null;
  private camera: InlineMermaidCamera | null = null;

  constructor(
    readonly lang: StaticLangKey,
    readonly code: string,
    /** The resolved-theme signature — part of identity so a theme/canvas/tint
     * flip makes eq() differ and CM re-renders the diagram with fresh colors. */
    readonly themeSig: string,
    readonly sourceFrom: number,
    readonly sourceTo: number,
  ) {
    super();
  }

  eq(o: RenderBlockWidget): boolean {
    return (
      o.lang === this.lang &&
      o.code === this.code &&
      o.themeSig === this.themeSig &&
      o.sourceFrom === this.sourceFrom &&
      o.sourceTo === this.sourceTo
    );
  }

  toDOM(): HTMLElement {
    const container = document.createElement("div");
    container.className = "rotli-render-block";
    container.dataset.lang = this.lang;
    // Mermaid opens an interactive view/code workspace. Other static blocks
    // retain the hybrid editor's click-to-reveal-source behavior.
    if (this.lang === "mermaid") container.title = "Open Mermaid diagram";
    else if (this.lang !== "jsxgraph") container.title = "Click to edit the source";
    this.dom = container;

    const body = document.createElement("div");
    body.className = "rotli-render-body";
    container.appendChild(body);

    if (this.lang === "mermaid") {
      body.classList.add("rotli-render-mermaid-trigger");
      body.tabIndex = 0;
      body.setAttribute("role", "button");
      body.setAttribute("aria-label", "Open Mermaid diagram viewer");
      // click still opens the workspace — but a DRAG pans and a scroll zooms
      // in place (the maintainer, 2026-07-29: "usable without clicking in"), so the
      // open gesture moved from mousedown to the camera's no-travel pointerup
      body.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          openMermaidWorkspace(this.code, container, this.sourceFrom, this.sourceTo);
        }
      });
      this.camera?.cleanup();
      this.camera = createInlineMermaidCamera(body, this.code, () =>
        openMermaidWorkspace(this.code, container, this.sourceFrom, this.sourceTo),
      );
    }

    const expand = document.createElement("button");
    expand.type = "button";
    expand.className = "rotli-render-expand";
    expand.textContent = this.lang === "mermaid" ? "Open" : "Expand";
    expand.setAttribute("aria-label", this.lang === "mermaid" ? "Open Mermaid diagram" : "Expand");
    expand.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.lang === "mermaid") {
        openMermaidWorkspace(this.code, container, this.sourceFrom, this.sourceTo);
      } else {
        openExpandOverlay(this.lang, this.code, container);
      }
    });
    container.appendChild(expand);

    // Resolve dark + tokens off the live in-editor node.
    const tokens = tokenReader(container);
    const ctx: RenderCtx = {
      dark: isDarkNode(container),
      tokens,
      id: `rotli-blk-${this.lang}-${cryptoId()}`,
    };
    const key = `${this.lang}|${ctx.dark ? "d" : "l"}|${tokens("--text")}|${tokens("--accent")}|${this.code}`;

    const mountRendered = (el: HTMLElement) => {
      if (this.lang === "mermaid" && this.camera) {
        this.camera.mount(el);
      } else {
        body.replaceChildren(el);
      }
    };

    if (this.lang !== "jsxgraph") {
      const cached = cacheGet(key);
      if (cached) {
        mountRendered(cached);
        return container;
      }
    }

    const out = RENDERERS[this.lang](this.code, ctx);
    if (out instanceof Promise) {
      out
        .then((el) => {
          if (this.destroyed) return; // widget gone — never touch its DOM
          if (this.lang !== "jsxgraph") cacheSet(key, el);
          mountRendered(el);
        })
        .catch(() => {});
    } else {
      if (this.lang !== "jsxgraph") cacheSet(key, out);
      mountRendered(out);
    }
    return container;
  }

  ignoreEvent(): boolean {
    // math/mermaid are static — let clicks through so CM lands the caret at the
    // block edge and reveals the raw source (click-to-edit). jsxgraph keeps its
    // own events (draggable points), so it ignores them; edit it by arrowing in.
    return this.lang === "jsxgraph" || this.lang === "mermaid";
  }

  destroy(): void {
    this.destroyed = true;
    this.camera?.cleanup();
    this.camera = null;
    if (this.dom) {
      this.dom.querySelectorAll<HTMLElement>(".rotli-render-jsxgraph").forEach(freeIfBoard);
    }
    this.dom = null;
  }
}

function cryptoId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ——— the inline mermaid camera (the maintainer, 2026-07-29): scroll zooms, drag pans,
//     a no-travel click still opens the workspace. Viewports persist per
//     source across the rebuilds that reveal-on-caret causes. ———

const INLINE_VIEWPORTS = new Map<string, MermaidViewport>();
const INLINE_VIEWPORT_CAP = 100; // LRU, like embedSizeMemory — long sessions must not hoard
const INLINE_MAX_HEIGHT = 460;
const INLINE_MIN_HEIGHT = 160;

function rememberInlineViewport(code: string, viewport: MermaidViewport): void {
  INLINE_VIEWPORTS.delete(code); // re-insert = LRU touch
  INLINE_VIEWPORTS.set(code, viewport);
  while (INLINE_VIEWPORTS.size > INLINE_VIEWPORT_CAP) {
    const oldest = INLINE_VIEWPORTS.keys().next().value;
    if (oldest === undefined) break;
    INLINE_VIEWPORTS.delete(oldest);
  }
}

interface InlineMermaidCamera {
  /** The rendered diagram landed — stage it and fit/restore the viewport. */
  mount(rendered: HTMLElement): void;
  cleanup(): void;
}

/** Gesture installation is SYNCHRONOUS (toDOM time) so click-to-open works
 * the instant the widget exists — the async mermaid render mounts into the
 * already-armed camera when it lands (a slow import must not eat clicks). */
function createInlineMermaidCamera(
  body: HTMLElement,
  code: string,
  openWorkspace: () => void,
): InlineMermaidCamera {
  body.classList.add("rotli-mermaid-inline");
  const stage = document.createElement("div");
  stage.className = "rotli-mermaid-inline-stage";

  let rendered: HTMLElement | null = null;
  const contentSize = () => {
    const svg = rendered?.querySelector("svg");
    const box = svg?.viewBox?.baseVal;
    if (box && box.width > 0 && box.height > 0) return { x: box.width, y: box.height };
    const rect = rendered?.getBoundingClientRect();
    return { x: rect?.width || 1, y: rect?.height || 1 };
  };

  let viewport = INLINE_VIEWPORTS.get(code) ?? null;
  const apply = () => {
    if (!viewport) return;
    stage.style.transform = `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.scale})`;
    rememberInlineViewport(code, viewport);
  };
  const fitInline = () => {
    if (!rendered) return;
    viewport = fitMermaidViewport({ x: body.clientWidth, y: body.clientHeight }, contentSize());
    apply();
  };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!viewport) return;
    const rect = body.getBoundingClientRect();
    const anchor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const factor = Math.exp(-event.deltaY * 0.0015);
    viewport = zoomMermaidViewportAt(viewport, viewport.scale * factor, anchor);
    apply();
  };
  // NON-passive on purpose: the editor scroller must not also scroll
  body.addEventListener("wheel", onWheel, { passive: false });

  let pan: { pointerId: number; x: number; y: number; moved: boolean } | null = null;
  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    pan = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    body.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!pan || pan.pointerId !== event.pointerId || !viewport) return;
    const dx = event.clientX - pan.x;
    const dy = event.clientY - pan.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) pan.moved = true;
    pan.x = event.clientX;
    pan.y = event.clientY;
    if (pan.moved) {
      viewport = panMermaidViewport(viewport, { x: dx, y: dy });
      apply();
    }
  };
  const endPan = (event: PointerEvent) => {
    if (!pan || pan.pointerId !== event.pointerId) return;
    const wasClick = !pan.moved;
    pan = null;
    if (body.hasPointerCapture(event.pointerId)) body.releasePointerCapture(event.pointerId);
    // the promised click-to-open, only when the pointer never traveled
    if (wasClick) openWorkspace();
  };
  const onPointerCancel = (event: PointerEvent) => {
    if (pan?.pointerId === event.pointerId) pan = null;
  };
  const onDblClick = (event: MouseEvent) => {
    event.preventDefault();
    fitInline();
  };
  body.addEventListener("pointerdown", onPointerDown);
  body.addEventListener("pointermove", onPointerMove);
  body.addEventListener("pointerup", endPan);
  body.addEventListener("pointercancel", onPointerCancel);
  body.addEventListener("dblclick", onDblClick);

  return {
    mount(el) {
      rendered = el;
      stage.replaceChildren(el);
      body.replaceChildren(stage);
      // size the viewport box to the diagram (capped), then fit or restore —
      // after layout so clientWidth is real
      requestAnimationFrame(() => {
        const size = contentSize();
        body.style.height = `${Math.max(INLINE_MIN_HEIGHT, Math.min(INLINE_MAX_HEIGHT, size.y + 24))}px`;
        if (viewport) apply();
        else fitInline();
      });
    },
    cleanup() {
      // the FULL teardown the contract promises (Greptile P2, PR #3)
      body.removeEventListener("wheel", onWheel);
      body.removeEventListener("pointerdown", onPointerDown);
      body.removeEventListener("pointermove", onPointerMove);
      body.removeEventListener("pointerup", endPan);
      body.removeEventListener("pointercancel", onPointerCancel);
      body.removeEventListener("dblclick", onDblClick);
    },
  };
}

// ——— the expand overlay (transient, on-brand) ————————————————————————
//
// Overlays live on document.body, so they MUST be torn down when the editor view
// goes away (a note/pane switch destroys the view but never routes through the
// transient stack). Every open overlay registers its close here; the theme-watch
// plugin's destroy() sweeps them.

const OPEN_OVERLAYS = new Set<() => void>();

/** Unapplied Mermaid workspace drafts, keyed by the fence source they opened
 * on. Closing the note (⌘W, a tab switch) unmounts the editor and force-closes
 * the workspace; the draft survives HERE so reopening the same diagram restores
 * it instead of silently discarding the work (system audit 2026-07-29, #8).
 * Apply and an explicit Discard clear the entry. Keyed by source, so two
 * notes holding byte-identical fences share one draft — accepted. */
const MERMAID_DRAFTS = new Map<string, string>();
const MERMAID_DRAFT_CAP = 20;
function rememberMermaidDraft(code: string, draft: string): void {
  MERMAID_DRAFTS.delete(code);
  if (draft === code) return;
  MERMAID_DRAFTS.set(code, draft);
  while (MERMAID_DRAFTS.size > MERMAID_DRAFT_CAP) {
    const oldest = MERMAID_DRAFTS.keys().next().value;
    if (oldest === undefined) break;
    MERMAID_DRAFTS.delete(oldest);
  }
}

function closeAllOverlays(): void {
  for (const close of [...OPEN_OVERLAYS]) close();
}

function mermaidCodeRange(
  view: EditorView,
  sourceFrom: number,
  sourceTo: number,
): { from: number; to: number } | null {
  if (sourceFrom < 0 || sourceTo > view.state.doc.length || sourceFrom > sourceTo) {
    return null;
  }
  const openLine = view.state.doc.lineAt(sourceFrom);
  const closeLine = view.state.doc.lineAt(sourceTo);
  const from = openLine.to + 1;
  const to = Math.max(from, closeLine.from - 1);
  return { from, to };
}

/** The note hosting the workspace — the focused pane's active note tab (the
 * click that opened the fence focused its pane first). Null on non-note tabs. */
function focusedNoteId(): string | null {
  const { root, focusedPaneId } = usePanesStore.getState();
  const leaf = findLeaf(root, focusedPaneId) ?? leaves(root)[0];
  const tab = leaf?.tabs.find((t) => t.id === leaf.activeTabId) ?? leaf?.tabs[0];
  return tab && tab.surfaceKind === "note" ? tab.noteId : null;
}

function openMermaidWorkspace(code: string, anchor: HTMLElement, sourceFrom: number, sourceTo: number): void {
  const view = EditorView.findFromDOM(anchor);
  if (!view) return;
  closeAllOverlays();
  const sourceNoteId = focusedNoteId();

  let unmount = () => {};
  let off: (() => void) | null = null;
  let requestClose: () => void;
  const close = () => {
    if (!OPEN_OVERLAYS.has(close)) return;
    OPEN_OVERLAYS.delete(close);
    off?.();
    off = null;
    unmount();
    if (anchor.isConnected) anchor.querySelector<HTMLElement>(".rotli-render-body")?.focus();
  };
  requestClose = close;

  OPEN_OVERLAYS.add(close);
  off = useUiStore.getState().registerTransient(() => requestClose());
  unmount = mountMermaidWorkspace({
    code,
    draft: MERMAID_DRAFTS.get(code),
    onDraftChange: (draft) => rememberMermaidDraft(code, draft),
    onDiscard: () => MERMAID_DRAFTS.delete(code),
    dark: isDarkNode(anchor),
    conversionAvailable: isTauri(),
    onRequestCloseReady: (next) => {
      requestClose = next;
    },
    onClose: close,
    onApply: (nextCode) => {
      const range = mermaidCodeRange(view, sourceFrom, sourceTo);
      if (!range) {
        return "The diagram moved in the note. Close and reopen it before applying.";
      }
      if (view.state.doc.sliceString(range.from, range.to) !== code) {
        return "The diagram changed outside this workspace. Close and reopen it before applying.";
      }
      close();
      MERMAID_DRAFTS.delete(code);
      view.dispatch({
        changes: { from: range.from, to: range.to, insert: nextCode },
        selection: { anchor: range.from + nextCode.length },
        scrollIntoView: true,
      });
      view.focus();
      return null;
    },
    onConvertToExcalidraw: async (nextCode) => {
      // the copy files beside the SOURCE note — same Main folder, same view
      await createEditableBoardFromMermaid(nextCode, sourceNoteId ? { besideNoteId: sourceNoteId } : {});
    },
    onConvertAndEmbed: async (nextCode) => {
      // the fence must still be what this workspace opened on — same stale
      // guard as Apply, checked BEFORE the board file is created
      const range = mermaidCodeRange(view, sourceFrom, sourceTo);
      if (!range || view.state.doc.sliceString(range.from, range.to) !== code) {
        return "The diagram changed in the note. Close and reopen it before replacing.";
      }
      const boardId = await createEditableBoardFromMermaid(nextCode, {
        ...(sourceNoteId ? { besideNoteId: sourceNoteId } : {}),
        open: false,
      });
      // RE-run the guard after the await (Greptile P1, PR #3): the board
      // write takes real time and the note may have changed under us — the
      // offsets must be validated against the FRESH document before dispatch
      const fresh = mermaidCodeRange(view, sourceFrom, sourceTo);
      if (!fresh || view.state.doc.sliceString(fresh.from, fresh.to) !== code) {
        return "The note changed while converting — the board was created but not embedded.";
      }
      const openLine = view.state.doc.lineAt(sourceFrom);
      const closeLine = view.state.doc.lineAt(sourceTo);
      view.dispatch({
        changes: {
          from: openLine.from,
          to: closeLine.to,
          insert: `\`\`\`board\n${boardId}\n\`\`\``,
        },
        scrollIntoView: true,
      });
      MERMAID_DRAFTS.delete(code);
      return null;
    },
  });
}

function openExpandOverlay(lang: StaticLangKey, code: string, anchor: HTMLElement): void {
  const overlay = document.createElement("div");
  overlay.className = "rotli-render-overlay";
  const card = document.createElement("div");
  card.className = "rotli-render-overlay-card";
  card.dataset.lang = lang;
  overlay.appendChild(card);

  const ctx: RenderCtx = {
    dark: isDarkNode(anchor),
    tokens: tokenReader(anchor),
    id: `rotli-ovl-${lang}-${cryptoId()}`,
  };
  const out = RENDERERS[lang](code, ctx);
  if (out instanceof Promise) {
    out
      .then((el) => {
        if (!card.isConnected) {
          freeIfBoard(el.querySelector<HTMLElement>(".rotli-render-jsxgraph"));
          return;
        }
        card.appendChild(el);
      })
      .catch(() => {});
  } else {
    card.appendChild(out);
  }

  let off: (() => void) | null = null;
  const close = () => {
    if (!OPEN_OVERLAYS.has(close)) return; // already closed
    OPEN_OVERLAYS.delete(close);
    document.removeEventListener("mousedown", onDown, true);
    document.removeEventListener("keydown", onKey, true);
    off?.();
    off = null;
    card.querySelectorAll<HTMLElement>(".rotli-render-jsxgraph").forEach(freeIfBoard);
    overlay.remove();
  };
  const onDown = (e: MouseEvent) => {
    if (!card.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  document.body.appendChild(overlay);
  OPEN_OVERLAYS.add(close);
  // register with the app's transient stack so the global Esc dispatcher closes
  // this first (the quokka rule); the local Esc listener is the fallback
  off = useUiStore.getState().registerTransient(close);
  document.addEventListener("mousedown", onDown, true);
  document.addEventListener("keydown", onKey, true);
}

// ——— theme signature ——————————————————————————————————————————————————

const bumpTheme = StateEffect.define<number>();
let themeVersion = 0;

/** The resolved-theme signature used to rebake diagram colors on a theme flip. */
function themeSignature(): string {
  return document.documentElement.dataset.theme ?? "";
}

// ——— decoration build (mirror livePreview's reveal-on-caret) ——————————

interface BlockState {
  deco: DecorationSet;
  /** Cached fence scan — recomputed only when the doc changes (a selection or a
   * theme flip reuses it, so caret moves don't re-walk the whole doc). */
  fences: FenceBlock[];
}

function buildFrom(state: EditorState, fences: FenceBlock[]): BlockState {
  const decos: Range<Decoration>[] = [];
  const sel = state.selection.main;
  const sig = themeSignature();

  for (const block of fences) {
    // scanFences now reports EVERY closed fence (#13) — only the target langs
    // become render widgets; a generic ```js fence stays raw code, styled by
    // livePreview's mono voice.
    if (!block.target) continue;
    // reveal-on-caret at block granularity — same intersection test livePreview
    // uses, widened to the whole fenced range. NOT atomic: arrowing to the
    // block's edge lands the caret as "touching" and reveals the raw source so
    // it stays editable (the Typora/Obsidian live-preview model).
    const touched = sel.from <= block.to && sel.to >= block.from;
    if (touched) continue; // raw source shows (livePreview skips these lines too)

    const code = innerCode(state.doc, block.from, block.to);
    if (block.lang === "board" || block.lang === "sheet" || block.lang === "document") {
      const fileId = code.trim();
      if (!fileId) continue;
      const widget = new EmbedBlockWidget(block.lang, fileId, sig);
      decos.push(Decoration.replace({ widget, block: true }).range(block.from, block.to));
      continue;
    }
    const widget = new RenderBlockWidget(block.lang as StaticLangKey, code, sig, block.from, block.to);
    decos.push(Decoration.replace({ widget, block: true }).range(block.from, block.to));
  }

  return { deco: Decoration.set(decos, true), fences };
}

// ——— the StateField (block decorations MUST come from state, not a plugin) ——

const blockField = StateField.define<BlockState>({
  create(state) {
    return buildFrom(state, scanFences(state.doc));
  },
  update(value, tr) {
    const themed = tr.effects.some((e) => e.is(bumpTheme));
    if (tr.docChanged) return buildFrom(tr.state, scanFences(tr.state.doc));
    if (tr.selection || themed) return buildFrom(tr.state, value.fences);
    return value;
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

// ——— theme-watch plugin (no decorations) ——————————————————————————————
//
// The theme is applied to document.documentElement AFTER the store updates (a
// React effect), so a store subscription sees the OLD attributes. Watch the DOM
// directly: when the resolved signature changes, drop the baked-color cache and
// bump a rebuild. On destroy, also sweep any open Expand overlay.

const themeWatcher = ViewPlugin.fromClass(
  class {
    private obs: MutationObserver;
    private lastSig: string;
    constructor(view: EditorView) {
      this.lastSig = themeSignature();
      this.obs = new MutationObserver(() => {
        const sig = themeSignature();
        if (sig === this.lastSig) return;
        this.lastSig = sig;
        CACHE.clear();
        view.dispatch({ effects: bumpTheme.of(++themeVersion) });
      });
      this.obs.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"],
      });
    }
    destroy() {
      this.obs.disconnect();
      closeAllOverlays();
    }
  },
);

/** The composed extension: the block-decoration field + the theme watcher. */
export const blockRender = [blockField, themeWatcher];
