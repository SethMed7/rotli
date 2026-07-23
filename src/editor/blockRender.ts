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
import { useUiStore } from "../state/ui";
import { usePanesStore } from "../state/panes";
import { type FenceBlock, type LangKey, innerCode, scanFences } from "./fences";
import { mountBoardEmbed, mountDocumentEmbed, mountSheetEmbed } from "./embedHosts";
import { installEmbedControls } from "./embedControls";
import { mermaidErrorMessage, renderMermaidElement } from "./mermaidRender";
import { mountMermaidWorkspace } from "./mermaidWorkspace";
import { sanitizeSvg } from "./svgSanitizer";

// Heavy fence libs (katex / mermaid / jsxgraph) load on first use — they used to
// ride every note-editor open via a static import. CSS follows the same gate.

// ——— theme resolution ———————————————————————————————————————————————

/** Root-theme "is dark?" — for the Expand overlay, which lives on document.body. */
function isDarkRoot(): boolean {
  const t = document.documentElement.dataset.theme ?? "";
  return t === "dark" || t === "charcoal";
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
      const open = (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
        openMermaidWorkspace(this.code, container, this.sourceFrom, this.sourceTo);
      };
      body.addEventListener("mousedown", open);
      body.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") open(event);
      });
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

    if (this.lang !== "jsxgraph") {
      const cached = cacheGet(key);
      if (cached) {
        body.appendChild(cached);
        return container;
      }
    }

    const out = RENDERERS[this.lang](this.code, ctx);
    if (out instanceof Promise) {
      out
        .then((el) => {
          if (this.destroyed) return; // widget gone — never touch its DOM
          body.replaceChildren(el);
          if (this.lang !== "jsxgraph") cacheSet(key, el);
        })
        .catch(() => {});
    } else {
      body.appendChild(out);
      if (this.lang !== "jsxgraph") cacheSet(key, out);
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
    if (this.dom) {
      this.dom.querySelectorAll<HTMLElement>(".rotli-render-jsxgraph").forEach(freeIfBoard);
    }
    this.dom = null;
  }
}

function cryptoId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ——— the expand overlay (transient, on-brand) ————————————————————————
//
// Overlays live on document.body, so they MUST be torn down when the editor view
// goes away (a note/pane switch destroys the view but never routes through the
// transient stack). Every open overlay registers its close here; the theme-watch
// plugin's destroy() sweeps them.

const OPEN_OVERLAYS = new Set<() => void>();

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

function openMermaidWorkspace(code: string, anchor: HTMLElement, sourceFrom: number, sourceTo: number): void {
  const view = EditorView.findFromDOM(anchor);
  if (!view) return;
  closeAllOverlays();

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
      view.dispatch({
        changes: { from: range.from, to: range.to, insert: nextCode },
        selection: { anchor: range.from + nextCode.length },
        scrollIntoView: true,
      });
      view.focus();
      return null;
    },
    onConvertToExcalidraw: async (nextCode) => {
      await createEditableBoardFromMermaid(nextCode);
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
