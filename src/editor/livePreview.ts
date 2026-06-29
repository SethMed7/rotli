// The WYSIWYG layer (Phase 1d — the CodeMirror rewrite). A decoration plugin
// that renders the markdown the editor is editing: it HIDES the syntax markers
// (**, _, ~~, ==, `, #, -, >, 1., - [ ]) and styles the content, so you see
// bold/headings/bullets/tasks while you type — never the literal characters.
//
// The raw markers are REVEALED only for the span your caret is touching (the
// Typora / Obsidian "Live Preview" model): move into a bold word and its **
// reappear so you can edit them; move out and they vanish again. Typing the
// markers always works because the document IS the markdown — CM edits the text
// directly, the .md never round-trips a rich model (the rotli source-of-truth
// law). One grammar: block detection reuses parseBlock (render.ts).
//
// List/quote/task/heading markers are atomic (CM skips the caret over the
// hidden chars; Backspace at the content start deletes the whole marker, so a
// bullet line cleanly becomes a paragraph). Bullets/numbers/checkboxes render
// as widgets ALWAYS (a list always looks like a list — never a stray dash).

import { type Range, RangeSet } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { parseBlock } from "./render";
import { lineInFence, scanFences } from "./fences";
import { lineInTable, scanTables } from "./tables";
import { resolveImageSrc } from "../lib/tauri";

interface Sel {
  from: number;
  to: number;
}

// ——— inline marks (mirror render.tsx INLINE_RULES — same order, same regexes,
//     so the rendered result is identical to the old static renderer) ———

interface InlineRule {
  re: RegExp;
  cls: string;
  /** Marker + content ranges RELATIVE to the match start. */
  parts: (m: RegExpExecArray) => { markers: [number, number][]; content: [number, number] };
}

/** Fixed open/close lengths: markers wrap the content symmetrically. */
function fixed(open: number, close: number) {
  return (m: RegExpExecArray) => {
    const L = m[0].length;
    return {
      markers: [
        [0, open],
        [L - close, L],
      ] as [number, number][],
      content: [open, L - close] as [number, number],
    };
  };
}

const INLINE: InlineRule[] = [
  { re: /`([^`]+)`/, cls: "rotli-code", parts: fixed(1, 1) },
  { re: /\*\*((?:[^*]|\*(?!\*))+)\*\*/, cls: "rotli-strong", parts: fixed(2, 2) },
  { re: /==([^=]+)==/, cls: "rotli-hl", parts: fixed(2, 2) },
  { re: /~~([^~]+)~~/, cls: "rotli-strike", parts: fixed(2, 2) },
  { re: /<u>(.*?)<\/u>/, cls: "rotli-u", parts: fixed(3, 4) },
  {
    re: /\[([^\]]+)\]\(([^)]*)\)/,
    cls: "rotli-link",
    // [text](url): hide "[" and "](url)", style the text
    parts: (m) => {
      const L = m[0].length;
      const textLen = (m[1] ?? "").length;
      return {
        markers: [
          [0, 1],
          [1 + textLen, L],
        ] as [number, number][],
        content: [1, 1 + textLen] as [number, number],
      };
    },
  },
  { re: /\*([^*\s](?:[^*]*[^*\s])?)\*/, cls: "rotli-em", parts: fixed(1, 1) },
];

// a line that is JUST an image — ![alt](url) or ![caption|width](url)
const IMG_LINE = /^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/;

// ——— widgets ———

const BULLET_GLYPHS = ["•", "◦", "▪"];

class BulletWidget extends WidgetType {
  constructor(readonly depth: number) {
    super();
  }
  eq(o: BulletWidget) {
    return o.depth === this.depth;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = "rotli-marker";
    s.textContent = BULLET_GLYPHS[this.depth % 3] ?? "•";
    s.setAttribute("aria-hidden", "true");
    return s;
  }
}

class NumberWidget extends WidgetType {
  constructor(readonly marker: string) {
    super();
  }
  eq(o: NumberWidget) {
    return o.marker === this.marker;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = "rotli-marker num";
    s.textContent = this.marker;
    s.setAttribute("aria-hidden", "true");
    return s;
  }
}

class CheckboxWidget extends WidgetType {
  constructor(readonly done: boolean) {
    super();
  }
  eq(o: CheckboxWidget) {
    return o.done === this.done;
  }
  toDOM(view: EditorView) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = this.done ? "rotli-check done" : "rotli-check";
    btn.setAttribute("role", "checkbox");
    btn.setAttribute("aria-checked", String(this.done));
    btn.setAttribute("aria-label", this.done ? "Mark not done" : "Mark done");
    // toggle on mousedown without moving the caret — resolve the line at click
    // time via posAtDOM so renumbered/edited lines still hit the right one
    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const pos = view.posAtDOM(btn);
      const line = view.state.doc.lineAt(pos);
      const m = /^(\s*)- \[([ xX])\] /.exec(line.text);
      if (!m) return;
      const next = m[2] === " " ? `${m[1]}- [x] ` : `${m[1]}- [ ] `;
      view.dispatch({ changes: { from: line.from, to: line.from + m[0].length, insert: next } });
    });
    return btn;
  }
  ignoreEvent() {
    return false;
  }
}

// An inline image: replaces a `![alt](src)` line with the rendered <img>. `storage:`
// srcs resolve through the asset protocol. The alt may carry an Obsidian-style
// width ("caption|420"); a corner grip resizes and rewrites that width into the
// markdown (the .md stays the source of truth). Click the image → caret lands →
// source reveals (click-to-edit), like the fenced render blocks.
class ImgWidget extends WidgetType {
  constructor(
    readonly alt: string,
    readonly src: string,
  ) {
    super();
  }
  eq(o: ImgWidget) {
    return o.alt === this.alt && o.src === this.src;
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement("span");
    wrap.className = "rotli-img";
    const bar = this.alt.lastIndexOf("|");
    const caption = bar >= 0 ? this.alt.slice(0, bar) : this.alt;
    const w = bar >= 0 ? Number.parseInt(this.alt.slice(bar + 1), 10) : Number.NaN;
    const img = document.createElement("img");
    img.alt = caption;
    img.draggable = false;
    if (Number.isFinite(w) && w > 0) img.style.width = `${w}px`;
    wrap.appendChild(img);
    void resolveImageSrc(this.src).then((url) => {
      if (url) img.src = url;
    });
    const grip = document.createElement("span");
    grip.className = "rotli-img-resize";
    grip.setAttribute("aria-hidden", "true");
    grip.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startW = img.getBoundingClientRect().width;
      const onMove = (ev: MouseEvent) => {
        img.style.width = `${Math.max(60, Math.round(startW + (ev.clientX - startX)))}px`;
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        const width = Math.round(img.getBoundingClientRect().width);
        const pos = view.posAtDOM(wrap);
        const line = view.state.doc.lineAt(pos);
        const newAlt = caption ? `${caption}|${width}` : `|${width}`;
        view.dispatch({
          changes: { from: line.from, to: line.to, insert: `![${newAlt}](${this.src})` },
        });
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
    wrap.appendChild(grip);
    return wrap;
  }
  ignoreEvent() {
    return false;
  }
}

// ——— builder ———

function scanInline(
  content: string,
  base: number,
  sel: Sel,
  decos: Range<Decoration>[],
  atomics: Range<Decoration>[],
): void {
  let rest = content;
  let offset = 0;
  // mirror renderInline: earliest match wins; ties go to the first rule (the
  // priority order in INLINE), so ** beats * and code is opaque
  while (rest.length > 0) {
    let best: { rule: InlineRule; m: RegExpExecArray } | null = null;
    for (const rule of INLINE) {
      const m = rule.re.exec(rest);
      if (m && (best === null || m.index < best.m.index)) best = { rule, m };
    }
    if (!best) break;
    const { rule, m } = best;
    const matchStart = base + offset + m.index;
    const { markers, content: cr } = rule.parts(m);
    const spanStart = matchStart;
    const spanEnd = matchStart + m[0].length;
    const cs = matchStart + cr[0];
    const ce = matchStart + cr[1];
    if (ce > cs) decos.push(Decoration.mark({ class: rule.cls }).range(cs, ce));
    const touched = sel.from <= spanEnd && sel.to >= spanStart;
    for (const [s, e] of markers) {
      const a = matchStart + s;
      const b = matchStart + e;
      if (b <= a) continue;
      if (touched) {
        decos.push(Decoration.mark({ class: "rotli-syntax" }).range(a, b));
      } else {
        const d = Decoration.replace({});
        decos.push(d.range(a, b));
        atomics.push(d.range(a, b));
      }
    }
    const consumed = m.index + m[0].length;
    rest = rest.slice(consumed);
    offset += consumed;
  }
}

const HANG_EM = 1.3;

function listStyle(depth: number, extra = 0): string {
  const hang = HANG_EM + extra;
  return `padding-left:${depth * HANG_EM + hang}em;text-indent:-${hang}em`;
}

function hidePrefix(
  from: number,
  to: number,
  widget: WidgetType | null,
  decos: Range<Decoration>[],
  atomics: Range<Decoration>[],
): void {
  if (to <= from) return;
  const d = widget ? Decoration.replace({ widget }) : Decoration.replace({});
  decos.push(d.range(from, to));
  atomics.push(d.range(from, to));
}

function revealablePrefix(
  from: number,
  to: number,
  touched: boolean,
  decos: Range<Decoration>[],
  atomics: Range<Decoration>[],
): void {
  if (to <= from) return;
  if (touched) {
    decos.push(Decoration.mark({ class: "rotli-syntax" }).range(from, to));
  } else {
    const d = Decoration.replace({});
    decos.push(d.range(from, to));
    atomics.push(d.range(from, to));
  }
}

function build(view: EditorView): { deco: DecorationSet; atomic: RangeSet<Decoration> } {
  const decos: Range<Decoration>[] = [];
  const atomics: Range<Decoration>[] = [];
  const sel = view.state.selection.main;
  const doc = view.state.doc;
  // blockRender owns the three rendered fenced languages; livePreview must leave
  // every fenced line alone (raw code voice, never markdown-styled, and never a
  // decoration that collides with the block widget on the same range).
  const fences = scanFences(doc);
  // tableRender owns GFM tables (replaces the whole range with a <table> widget);
  // livePreview leaves every table line alone, just like fenced lines.
  const tables = scanTables(doc);
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = doc.lineAt(pos);
      if (lineInFence(line.from, fences) || lineInTable(line.from, tables)) {
        pos = line.to + 1;
        continue;
      }
      const text = line.text;
      const ls = line.from;
      const block = parseBlock(text);
      const prefixEnd = ls + block.prefixLen;
      const depth = Math.floor((block.indent ?? 0) / 2);
      const lineTouched = sel.from <= line.to && sel.to >= ls;
      const contentBase = prefixEnd;
      const content = text.slice(block.prefixLen);

      // a line that is JUST an image renders inline; caret in the line reveals source
      const imgM = IMG_LINE.exec(text);
      if (imgM && !lineTouched && line.to > ls) {
        const d = Decoration.replace({ widget: new ImgWidget(imgM[1] ?? "", imgM[2] ?? "") });
        decos.push(d.range(ls, line.to));
        atomics.push(d.range(ls, line.to));
        pos = line.to + 1;
        continue;
      }

      switch (block.kind) {
        case "h1":
        case "h2":
        case "h3":
          decos.push(Decoration.line({ class: `rotli-${block.kind}` }).range(ls));
          revealablePrefix(ls, prefixEnd, lineTouched, decos, atomics);
          scanInline(content, contentBase, sel, decos, atomics);
          break;
        case "bullet":
          decos.push(
            Decoration.line({ class: "rotli-li", attributes: { style: listStyle(depth) } }).range(ls),
          );
          hidePrefix(ls, prefixEnd, new BulletWidget(depth), decos, atomics);
          scanInline(content, contentBase, sel, decos, atomics);
          break;
        case "numbered":
          decos.push(
            Decoration.line({ class: "rotli-li", attributes: { style: listStyle(depth) } }).range(ls),
          );
          hidePrefix(ls, prefixEnd, new NumberWidget(block.marker ?? "1."), decos, atomics);
          scanInline(content, contentBase, sel, decos, atomics);
          break;
        case "task":
          decos.push(
            Decoration.line({
              class: block.done ? "rotli-task done" : "rotli-task",
              attributes: { style: listStyle(depth) },
            }).range(ls),
          );
          hidePrefix(ls, prefixEnd, new CheckboxWidget(!!block.done), decos, atomics);
          if (block.done && line.to > prefixEnd) {
            decos.push(Decoration.mark({ class: "rotli-done" }).range(prefixEnd, line.to));
          }
          scanInline(content, contentBase, sel, decos, atomics);
          break;
        case "quote":
          decos.push(Decoration.line({ class: "rotli-quote" }).range(ls));
          hidePrefix(ls, prefixEnd, null, decos, atomics);
          scanInline(content, contentBase, sel, decos, atomics);
          break;
        case "para":
          scanInline(text, ls, sel, decos, atomics);
          break;
        case "blank":
          break;
      }
      pos = line.to + 1;
    }
  }
  return { deco: Decoration.set(decos, true), atomic: RangeSet.of(atomics, true) };
}

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    atomic: RangeSet<Decoration>;
    constructor(view: EditorView) {
      const r = build(view);
      this.decorations = r.deco;
      this.atomic = r.atomic;
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.viewportChanged) {
        const r = build(u.view);
        this.decorations = r.deco;
        this.atomic = r.atomic;
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    provide: (plugin) =>
      EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomic ?? RangeSet.empty),
  },
);
