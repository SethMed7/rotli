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
import { useUiStore } from "../state/ui";
import { usePanesStore } from "../state/panes";
import { type FenceBlock, type LangKey, innerCode, scanFences } from "./fences";
import { mountBoardEmbed, mountSheetEmbed } from "./embedHosts";

// Heavy fence libs (katex / mermaid / jsxgraph) load on first use — they used to
// ride every note-editor open via a static import. CSS follows the same gate.

// ——— theme resolution ———————————————————————————————————————————————

/** Root-theme "is dark?" — for the Expand overlay, which lives on document.body
 * (outside the editor canvas) so it follows the root theme, not the glass canvas. */
function isDarkRoot(): boolean {
  const t = document.documentElement.dataset.theme ?? "";
  return t === "dark" || t === "charcoal" || t === "glass-dark";
}

/** "Is dark?" for an IN-EDITOR node — resolved from the node's own computed text
 * color (light text ⇒ dark surface). This honors the glass paper-canvas override
 * (.ed-scroll can force e.g. a dark cocoa canvas even under a light root theme),
 * which a dataset.theme read would miss. */
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

type StaticLangKey = Exclude<LangKey, "board" | "sheet">;

function errorBox(message: string): HTMLElement {
  const box = document.createElement("div");
  box.className = "rotli-render-error";
  box.textContent = message;
  return box;
}

let mermaidThemeFor: "dark" | "default" | null = null;
let katexCssReady: Promise<void> | null = null;
let jsxgraphCssReady: Promise<void> | null = null;

async function loadKatex() {
  katexCssReady ??= import("katex/dist/katex.min.css").then(() => undefined);
  const [{ default: katex }] = await Promise.all([import("katex"), katexCssReady]);
  return katex;
}

async function loadMermaid() {
  const { default: mermaid } = await import("mermaid");
  return mermaid;
}

async function loadJsxgraph() {
  // jsxgraph's package "exports" map hides ./distrib/* — import the stylesheet by
  // a filesystem-relative path so Vite resolves it directly (bypassing exports).
  jsxgraphCssReady ??= import("../../node_modules/jsxgraph/distrib/jsxgraph.css").then(
    () => undefined,
  );
  const [{ default: JXG }] = await Promise.all([import("jsxgraph"), jsxgraphCssReady]);
  return JXG;
}

/** mermaid throws "detailed errors" ({ str, hash }) for parse failures and plain
 * Errors otherwise — pull a human message from either shape. */
function mermaidMessage(e: unknown): string {
  if (e && typeof e === "object") {
    const d = e as { str?: unknown; message?: unknown };
    if (typeof d.str === "string" && d.str) return d.str;
    if (typeof d.message === "string" && d.message) return d.message;
  }
  return String(e);
}

/** Remove the temp render nodes mermaid leaves in document.body when render()
 * throws (it skips its own removeTempElements() on the error path). */
function cleanupMermaidOrphans(id: string): void {
  for (const candidate of [id, `d${id}`, `i${id}`]) {
    document.getElementById(candidate)?.remove();
  }
}

// ——— the renderer registry — one function per language, shared infra ————

const RENDERERS: Record<StaticLangKey, (code: string, ctx: RenderCtx) => HTMLElement | Promise<HTMLElement>> = {
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
    const mermaid = await loadMermaid();
    const theme = ctx.dark ? "dark" : "default";
    if (mermaidThemeFor !== theme) {
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme });
      mermaidThemeFor = theme;
    }
    if (!code.trim()) {
      const el = document.createElement("div");
      el.className = "rotli-render-mermaid";
      return el;
    }
    try {
      const { svg } = await mermaid.render(ctx.id, code);
      const el = document.createElement("div");
      el.className = "rotli-render-mermaid";
      el.innerHTML = svg;
      return el;
    } catch (e) {
      return errorBox(`mermaid: ${mermaidMessage(e)}`);
    } finally {
      cleanupMermaidOrphans(ctx.id);
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

  // a ```svg fence renders the vector inline; click-to-edit reveals the source
  // (the code ⇄ preview toggle). User content, so strip <script> before injecting
  // (the CSP blocks it too).
  svg: (code) => {
    const el = document.createElement("div");
    el.className = "rotli-render-svg";
    const src = code.trim();
    if (!src) return el; // empty fence while live-typing — quiet placeholder
    el.innerHTML = src.replace(/<script[\s\S]*?<\/script>/gi, "");
    return el;
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

  constructor(
    readonly kind: "board" | "sheet",
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
    container.appendChild(body);

    const expand = document.createElement("button");
    expand.type = "button";
    expand.className = "rotli-render-expand";
    expand.textContent = "Expand";
    expand.setAttribute("aria-label", "Expand to pane");
    expand.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const panes = usePanesStore.getState();
      if (this.kind === "board") panes.openCanvas(this.fileId, { newTab: true });
      else panes.openFile(this.fileId, { newTab: true });
    });
    container.appendChild(expand);

    const id = this.fileId.trim();
    if (id) {
      let cancelled = false;
      const mount = this.kind === "board" ? mountBoardEmbed(body, id) : mountSheetEmbed(body, id);
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
  ) {
    super();
  }

  eq(o: RenderBlockWidget): boolean {
    return o.lang === this.lang && o.code === this.code && o.themeSig === this.themeSig;
  }

  toDOM(): HTMLElement {
    const container = document.createElement("div");
    container.className = "rotli-render-block";
    container.dataset.lang = this.lang;
    // math/mermaid/svg/html are click-to-edit: clicking the rendered block lands
    // the caret in the source — the toggle to see/edit the code. (For html the
    // iframe swallows clicks on its own area; the block's padding still works.)
    if (this.lang !== "jsxgraph") container.title = "Click to edit the source";
    this.dom = container;

    const body = document.createElement("div");
    body.className = "rotli-render-body";
    container.appendChild(body);

    const expand = document.createElement("button");
    expand.type = "button";
    expand.className = "rotli-render-expand";
    expand.textContent = "Expand";
    expand.setAttribute("aria-label", "Expand");
    expand.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openExpandOverlay(this.lang, this.code, container);
    });
    container.appendChild(expand);

    // resolve dark + tokens off the live (in-editor) node so the glass canvas
    // override is honored
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
      out.then((el) => {
        if (this.destroyed) return; // widget gone — never touch its DOM
        body.replaceChildren(el);
        if (this.lang !== "jsxgraph") cacheSet(key, el);
      });
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
    return this.lang === "jsxgraph";
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
    out.then((el) => {
      if (!card.isConnected) {
        freeIfBoard(el.querySelector<HTMLElement>(".rotli-render-jsxgraph"));
        return;
      }
      card.appendChild(el);
    });
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

/** The resolved-theme signature: dataset.theme + the glass canvas + the glass
 * tint (under glass themes --accent is var(--glass-hue), set by data-glass-tint,
 * so a tint flip really does change baked diagram colors). */
function themeSignature(): string {
  const d = document.documentElement.dataset;
  return `${d.theme ?? ""}|${d.glassCanvas ?? ""}|${d.glassTint ?? ""}`;
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
    if (block.lang === "board" || block.lang === "sheet") {
      const fileId = code.trim();
      if (!fileId) continue;
      const widget = new EmbedBlockWidget(block.lang, fileId, sig);
      decos.push(Decoration.replace({ widget, block: true }).range(block.from, block.to));
      continue;
    }
    const widget = new RenderBlockWidget(block.lang as StaticLangKey, code, sig);
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
        mermaidThemeFor = null;
        view.dispatch({ effects: bumpTheme.of(++themeVersion) });
      });
      this.obs.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme", "data-glass-canvas", "data-glass-tint"],
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
