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

import { Facet, type Range, RangeSet } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";

import { type DragGhost, createImageDragGhost } from "../lib/dragGhost";
import { VIDEO_EXTS, extOf } from "../lib/fileKind";
import { openUrl, resolveImageSrc, rootIdOf } from "../lib/tauri";
import { locateLostImage } from "../services/imageRepair";
import { usePanesStore } from "../state/panes";
import { selectChoiceGroup } from "./choiceState";
import { scanFences } from "./fences";
import { imageSourceSpan, selectionCoversImage } from "./imageSelection";
import { type DropTarget, type LineSpan, planLineMove, snapOutOfBlocks } from "./imgMove";
import { CHECK_EM, CHOICE_EM, listStyle, MARKER_EM, RESULT_EM } from "./listGeometry";
import { parseBlock } from "./render";
import { resultTextParts } from "./resultState";
import { ChoiceControlWidget, ResultReasonWidget, ResultWidget, ToggleWidget } from "./resultWidget";
import { lineInTable, scanTables } from "./tables";
import { type TaskNode, type TaskProgress, taskProgress } from "./taskTree";
import { CheckboxWidget } from "./taskWidget";
import { editorLinkOpensOnClick, WIKILINK_RE } from "./wikilink";
import { resolveWikilinkTarget } from "./wikilinkIndex";

interface Sel {
  from: number;
  to: number;
}

// ——— inline marks (mirror render.tsx INLINE_RULES — same order, same regexes,
//     so the rendered result is identical to the old static renderer) ———

interface InlineRule {
  re: RegExp;
  cls: string;
  /** Extra DOM attributes on the content mark (the link's ⌘-click tooltip). */
  attrs?: Record<string, string>;
  /** Per-MATCH class/attrs override (the wikilink's resolved-vs-missing look). */
  clsFor?: (m: RegExpExecArray) => string;
  attrsFor?: (m: RegExpExecArray) => Record<string, string> | undefined;
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
  {
    re: /\[\[([^\]]+)\]\]/,
    cls: "rotli-wikilink",
    // a link that resolves to NOTHING must not look identical to a live one —
    // the silent dead click read as broken (the maintainer, 2026-07-28)
    clsFor: (m) =>
      resolveWikilinkTarget(m[1] ?? "") ? "rotli-wikilink" : "rotli-wikilink rotli-wikilink-missing",
    attrsFor: (m) =>
      resolveWikilinkTarget(m[1] ?? "")
        ? { title: "Click to open note" }
        : { title: "No note with this name — the link has nowhere to go" },
    // [[target|display]] hides "[[target|" and "]]", showing only the display
    // (an EMPTY display falls back to showing the whole inner text)
    parts: (m) => {
      const L = m[0].length;
      const pipe = (m[1] ?? "").indexOf("|");
      const open = pipe >= 0 && 2 + pipe + 1 < L - 2 ? 2 + pipe + 1 : 2;
      return {
        markers: [
          [0, open],
          [L - 2, L],
        ] as [number, number][],
        content: [open, L - 2] as [number, number],
      };
    },
  },
  { re: /\*\*((?:[^*]|\*(?!\*))+)\*\*/, cls: "rotli-strong", parts: fixed(2, 2) },
  { re: /==([^=]+)==/, cls: "rotli-hl", parts: fixed(2, 2) },
  { re: /~~([^~]+)~~/, cls: "rotli-strike", parts: fixed(2, 2) },
  { re: /<u>(.*?)<\/u>/, cls: "rotli-u", parts: fixed(3, 4) },
  {
    re: /\[([^\]]+)\]\(([^)]*)\)/,
    cls: "rotli-link",
    attrs: { title: "⌘-click to open" },
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
  // a BARE url typed as plain text is a link too (the maintainer, 2026-07-28: "we should
  // notice links") — no markers to hide, trailing punctuation stays prose.
  // Sits after the md-link rule: `[t](url)` starts earlier so it wins the scan.
  {
    re: /https?:\/\/[^\s<>()[\]]*[^\s<>()[\].,;:!?'"]/,
    cls: "rotli-link rotli-autolink",
    attrs: { title: "⌘-click to open" },
    parts: (m) => ({ markers: [], content: [0, m[0].length] as [number, number] }),
  },
];

// a line that is JUST an image — ![alt](url) or ![caption|width](url)
/** A list item whose CONTENT is exactly an image renders it inline after the
 * bullet/number/checkbox (the maintainer, 2026-07-09 — an image inside a bullet used to
 * stay raw markdown forever: only standalone images matched before). Returns
 * true when it decorated, so the caller skips the normal inline scan. */
function listItemImage(
  content: string,
  contentBase: number,
  lineEnd: number,
  lineTouched: boolean,
  sel: Sel,
  decos: Range<Decoration>[],
  atomics: Range<Decoration>[],
): boolean {
  const image = imageSourceSpan(content, contentBase);
  if (!image || lineEnd <= contentBase) return false;
  // an exact OR containing selection keeps the image visible and selected;
  // a caret/partial selection still reveals source for direct Markdown edits
  const selected = selectionCoversImage(sel, contentBase, lineEnd);
  if (lineTouched && !selected) return false;
  const d = Decoration.replace({ widget: new ImgWidget(image.alt, image.src, selected) });
  decos.push(d.range(contentBase, lineEnd));
  atomics.push(d.range(contentBase, lineEnd));
  return true;
}

// a thematic break — ---, ***, ___ (frontmatter never reaches here: the Rust
// corpus splits it off the body; table delimiter rows carry pipes so they miss)
const HR_LINE = /^ {0,3}(-{3,}|\*{3,}|_{3,})\s*$/;

// resolved image urls, keyed by root + raw markdown src (see ImgWidget.toDOM)
const IMG_SRC_CACHE = new Map<string, string>();

/** The OPEN NOTE's wire id, provided by cmEditor — widgets that need per-note
 * context read it here: images resolve relative srcs against the note's
 * corpus root (the maintainer, 2026-07-30: photos in non-default-root notes rendered as
 * broken boxes), and table widgets key their persisted column widths by it. */
export const noteIdFacet = Facet.define<string, string>({
  combine: (values) => values[0] ?? "",
});

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

/** A parent task's subtask progress, e.g. "2/4" (2026-08-04). COMPUTED and
 * appended at the line's end — it is never written into the markdown, exactly
 * like the checkbox glyph is a rendering of `- [ ]` rather than a replacement
 * for it. */
class ProgressWidget extends WidgetType {
  constructor(
    readonly done: number,
    readonly total: number,
  ) {
    super();
  }
  eq(o: ProgressWidget) {
    return o.done === this.done && o.total === this.total;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = this.done === this.total ? "rotli-progress all" : "rotli-progress";
    s.textContent = `${this.done}/${this.total}`;
    // spoken, not decorative — a screen reader should hear the progress
    s.setAttribute("aria-label", `${this.done} of ${this.total} subtasks done`);
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

/** One radio-style option backed by `( )` / `(x)`. Adjacent same-indent choice
 * rows are the group, so selecting one rewrites that group atomically. */
class ChoiceWidget extends WidgetType {
  constructor(
    readonly selected: boolean,
    readonly marker: string | null = null,
  ) {
    super();
  }
  eq(other: ChoiceWidget) {
    return other.selected === this.selected && other.marker === this.marker;
  }
  toDOM(view: EditorView) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `rotli-choice${this.selected ? " is-selected" : ""}`;
    btn.setAttribute("aria-pressed", String(this.selected));
    btn.setAttribute("aria-label", this.selected ? "Selected option" : "Select option");
    btn.title = this.selected ? "Selected option" : "Select option";

    const select = () => {
      const pos = view.posAtDOM(btn);
      const target = view.state.doc.lineAt(pos);
      const lines = view.state.doc.toString().split("\n");
      const planned = selectChoiceGroup(lines, target.number - 1);
      if (!planned || planned.length === 0) return;
      const changes = planned.map((edit) => {
        const line = view.state.doc.line(edit.index + 1);
        return { from: line.from, to: line.to, insert: edit.line };
      });
      view.dispatch({ changes, userEvent: "input" });
    };

    btn.addEventListener("keydown", (event) => {
      // A focused embedded choice stays in normal Tab order. A text caret on
      // the line still delegates Tab to Rotli's line-indent command.
      if (event.key === "Tab" || event.key === " " || event.key === "Enter") event.stopPropagation();
    });
    btn.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return; // a right/middle press must not select
      event.preventDefault();
      select();
    });
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      if (event.detail === 0) select();
    });

    if (!this.marker) return btn;
    const wrap = document.createElement("span");
    const num = document.createElement("span");
    num.className = "rotli-marker num";
    num.textContent = this.marker;
    num.setAttribute("aria-hidden", "true");
    wrap.append(num, btn);
    return wrap;
  }
  ignoreEvent() {
    return false;
  }
}

// An inline image: replaces a `![alt](src)` line with the rendered <img>. `storage:`
// srcs resolve through the asset protocol. The alt may carry an Obsidian-style
// width ("caption|420"); a corner grip resizes and rewrites that width into the
// markdown (the .md stays the source of truth). CLICK OR ARROW ENTRY selects
// the image as an object (outline; Backspace deletes it) — it never reveals the
// source. Dragging the body moves the line, with a live drop-indicator marking
// where it will land.
class ImgWidget extends WidgetType {
  constructor(
    readonly alt: string,
    readonly src: string,
    readonly selected: boolean,
  ) {
    super();
  }
  eq(o: ImgWidget) {
    return o.alt === this.alt && o.src === this.src && o.selected === this.selected;
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement("span");
    wrap.className = this.selected ? "rotli-img sel" : "rotli-img";
    const bar = this.alt.lastIndexOf("|");
    const caption = bar >= 0 ? this.alt.slice(0, bar) : this.alt;
    const w = bar >= 0 ? Number.parseInt(this.alt.slice(bar + 1), 10) : Number.NaN;
    // A video source keeps the whole image contract — storage: resolution,
    // rescue, the |width suffix, the resize grip, selection — and swaps only
    // the element: WKWebView plays it natively over the asset protocol, which
    // serves range requests so seeking works. No bytes ride IPC.
    const isVideo = VIDEO_EXTS.has(extOf(this.src));
    const img = isVideo ? document.createElement("video") : document.createElement("img");
    if (img instanceof HTMLVideoElement) {
      img.controls = true;
      img.preload = "metadata";
      img.playsInline = true;
      if (caption) img.setAttribute("aria-label", caption);
    } else {
      img.alt = caption;
    }
    img.draggable = false;
    if (Number.isFinite(w) && w > 0) img.style.width = `${w}px`;
    wrap.appendChild(img);
    // select/deselect recreates the widget DOM — cache resolved urls so the
    // image doesn't blank-flash through the async resolve on every click
    const rootId = rootIdOf(view.state.facet(noteIdFacet));
    const cacheKey = `${rootId}\0${this.src}`;
    const showState = (text: string) => {
      if (!wrap.isConnected) return;
      wrap.classList.add("missing");
      const label = document.createElement("span");
      label.className = "rotli-img-missing";
      label.textContent = text;
      wrap.appendChild(label);
    };
    // heal the markdown link in place — the moved file's new home replaces the
    // stale src (guarded: the line must still carry exactly this src)
    const healSrc = (newRel: string): boolean => {
      if (!wrap.isConnected) return false;
      const pos = view.posAtDOM(wrap);
      const line = view.state.doc.lineAt(pos);
      const text = view.state.doc.sliceString(line.from, line.to);
      const target = `](${this.src})`;
      const at = text.indexOf(target);
      if (at < 0) return false;
      const from = line.from + at + 2;
      view.dispatch({ changes: { from, to: from + this.src.length, insert: newRel } });
      return true;
    };
    // a src that no longer resolves is CLASSIFIED, not abandoned (the maintainer,
    // 2026-07-30): moved → heal the link; archived → still exists, render it;
    // trashed → "photo deleted"; only a truly gone file says "not found"
    const rescue = () =>
      locateLostImage(this.src, rootId).then((loc) => {
        if (loc.kind === "moved") {
          if (healSrc(loc.rel)) return; // the rebuilt widget renders the new src
          showState(`image moved — ${loc.rel}`);
          return;
        }
        if (loc.kind === "archived") {
          return resolveImageSrc(loc.rel, rootId).then((url) => {
            if (url && wrap.isConnected)
              img.src = url; // render from the Archive, link untouched
            else showState(`image in the Archive — ${this.src}`);
          });
        }
        if (loc.kind === "trashed") showState(`photo deleted — in the Trash (${this.src})`);
        else showState(`image not found — ${this.src}`);
      });
    const cached = IMG_SRC_CACHE.get(cacheKey);
    if (cached) img.src = cached;
    else {
      void resolveImageSrc(this.src, rootId)
        .then((url) => {
          if (url) {
            IMG_SRC_CACHE.set(cacheKey, url);
            img.src = url;
          } else {
            return rescue();
          }
        })
        .catch(() => showState(`image not found — ${this.src}`));
    }
    (img as HTMLElement).addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      // native transport controls own the pointer on a video — move it by
      // selecting its line (double-click) rather than dragging the player
      if (!(img instanceof HTMLImageElement)) return;
      e.preventDefault();
      // capture every doc position NOW — a mid-drag redraw detaches `wrap`, so
      // nothing may resolve through posAtDOM at mouse-up (the old glitch). The
      // doc itself is captured too: if anything rewrites it mid-gesture (another
      // pane pushing this note in), every captured offset is void — bail.
      const doc0 = view.state.doc;
      const widgetFrom = view.posAtDOM(wrap);
      const srcLine = view.state.doc.lineAt(widgetFrom);
      const srcFrom = srcLine.from;
      const srcTo = srcLine.to;
      const lineText = view.state.doc.sliceString(srcFrom, srcTo);
      const docLength = view.state.doc.length;
      const cutTo = Math.min(docLength, srcTo + 1);
      // tables + fenced code are opaque blocks a dropped line must not split
      const blocks: LineSpan[] = [...scanFences(view.state.doc), ...scanTables(view.state.doc)];
      const sx = e.clientX;
      const sy = e.clientY;
      let moving = false;
      let indicator: HTMLDivElement | null = null;
      let ghost: DragGhost | null = null;

      // where would this pointer drop the line? null = nowhere / a no-op spot
      const resolveDrop = (ev: MouseEvent): { target: DropTarget; y: number } | null => {
        if (view.state.doc !== doc0) return null; // doc changed mid-drag — void
        const pos = view.posAtCoords({ x: ev.clientX, y: ev.clientY });
        if (pos == null) {
          // the blank space below the document = drop at the end
          const endC = view.coordsAtPos(docLength);
          if (!endC || ev.clientY <= endC.bottom || cutTo === docLength) return null;
          return { target: "end", y: endC.bottom };
        }
        const line = view.state.doc.lineAt(pos);
        const topC = view.coordsAtPos(line.from);
        const botC = view.coordsAtPos(line.to);
        if (!topC || !botC) return null;
        // upper half → before this line; lower half → after it
        const below = ev.clientY > (topC.top + botC.bottom) / 2;
        let target: DropTarget = below ? (line.to + 1 > docLength ? "end" : line.to + 1) : line.from;
        let y = below ? botC.bottom : topC.top;
        if (target !== "end") {
          const snapped = snapOutOfBlocks(target, blocks, docLength);
          if (snapped !== target) {
            target = snapped;
            const yc = view.coordsAtPos(snapped === "end" ? docLength : snapped);
            if (!yc) return null;
            y = snapped === "end" ? yc.bottom : yc.top;
          }
        }
        if (target === "end" ? cutTo === docLength : target >= srcFrom && target <= cutTo) {
          return null; // dropping onto itself — hide the indicator, do nothing
        }
        return { target, y };
      };

      const clearIndicator = () => {
        indicator?.remove();
        indicator = null;
      };
      const drawIndicator = (y: number) => {
        if (!indicator) {
          indicator = document.createElement("div");
          indicator.className = "rotli-img-drop";
          document.body.appendChild(indicator);
        }
        const cr = view.contentDOM.getBoundingClientRect();
        indicator.style.left = `${cr.left}px`;
        indicator.style.width = `${cr.width}px`;
        indicator.style.top = `${y - 1}px`;
      };
      const finish = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        window.removeEventListener("keydown", onKey, true);
        wrap.classList.remove("rotli-img-moving");
        ghost?.destroy();
        ghost = null;
        clearIndicator();
      };
      const onKey = (ev: KeyboardEvent) => {
        if (ev.key === "Escape") {
          ev.preventDefault();
          ev.stopPropagation(); // the cancel is ours — overlays must not also close
          moving = false;
          finish(); // cancel the whole gesture — mouse-up now does nothing
        }
      };
      const onMove = (ev: MouseEvent) => {
        if (!moving && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 5) {
          moving = true;
          wrap.classList.add("rotli-img-moving");
          // the image comes WITH the pointer — a small lifted clone (the
          // original dims in place); shared ghost grammar with tabs/boards
          ghost = createImageDragGhost(img, ev.clientX, ev.clientY);
        }
        if (!moving) return;
        ghost?.move(ev.clientX, ev.clientY);
        // nudge the scroller near its edges so long notes are reachable mid-drag
        const sr = view.scrollDOM.getBoundingClientRect();
        if (ev.clientY < sr.top + 36) view.scrollDOM.scrollTop -= 14;
        else if (ev.clientY > sr.bottom - 36) view.scrollDOM.scrollTop += 14;
        const drop = resolveDrop(ev);
        if (drop) drawIndicator(drop.y);
        else clearIndicator();
      };
      const onUp = (ev: MouseEvent) => {
        if (ev.button !== 0) return; // a stray right-up mid-drag must not commit
        const wasMoving = moving;
        finish();
        if (view.state.doc !== doc0) return; // doc changed mid-gesture — offsets void
        if (!wasMoving) {
          // plain click = select the image as an object (widget stays rendered)
          view.dispatch({ selection: { anchor: widgetFrom, head: srcTo } });
          view.focus();
          return;
        }
        const drop = resolveDrop(ev);
        if (!drop) return;
        const plan = planLineMove({ from: srcFrom, to: srcTo }, drop.target, docLength, lineText);
        if (!plan) return;
        view.dispatch({
          changes: plan.changes,
          // keep the moved image selected so the landing spot is unmistakable
          selection: {
            anchor: plan.insertedAt + (widgetFrom - srcFrom),
            head: plan.insertedAt + lineText.length,
          },
        });
        view.focus();
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      window.addEventListener("keydown", onKey, true);
    });
    wrap.addEventListener("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!wrap.isConnected) return;
      const imageFrom = view.posAtDOM(wrap);
      const imageTo = view.state.doc.lineAt(imageFrom).to;
      view.dispatch({ selection: { anchor: imageFrom, head: imageTo } });
      view.focus();
    });
    const grip = document.createElement("span");
    grip.className = "rotli-img-resize";
    grip.setAttribute("aria-hidden", "true");
    grip.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      // capture at press (posAtDOM at mouse-up can see a detached node), and
      // rewrite ONLY the image span — a bulleted image keeps its "- " prefix
      const doc0 = view.state.doc;
      const imgFrom = view.posAtDOM(wrap);
      const lineTo = view.state.doc.lineAt(imgFrom).to;
      const startX = e.clientX;
      const startW = img.getBoundingClientRect().width;
      const onMove = (ev: MouseEvent) => {
        img.style.width = `${Math.max(60, Math.round(startW + (ev.clientX - startX)))}px`;
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        if (view.state.doc !== doc0) return; // doc changed mid-resize — offsets void
        const width = Math.round(img.getBoundingClientRect().width);
        const newAlt = caption ? `${caption}|${width}` : `|${width}`;
        view.dispatch({
          changes: { from: imgFrom, to: lineTo, insert: `![${newAlt}](${this.src})` },
        });
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
    wrap.appendChild(grip);
    return wrap;
  }
  ignoreEvent(event: Event) {
    // We own the press/drag/release cycle and its synthesized double-click —
    // CM must not race a caret or word selection into the hidden source.
    return event.type === "mousedown" || event.type === "dblclick";
  }
}

// A horizontal rule — replaces a `---` line with a thin themed rule; caret in
// the line reveals the raw dashes (the usual reveal-on-caret law).
class HrWidget extends WidgetType {
  eq(): boolean {
    return true;
  }
  toDOM(): HTMLElement {
    const s = document.createElement("span");
    s.className = "rotli-hr";
    s.setAttribute("aria-hidden", "true");
    return s;
  }
  ignoreEvent(): boolean {
    return false; // let CM place the caret on click → the dashes reveal
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
    if (ce > cs) {
      const cls = rule.clsFor?.(m) ?? rule.cls;
      const attrs = rule.attrsFor?.(m) ?? rule.attrs;
      decos.push(Decoration.mark(attrs ? { class: cls, attributes: attrs } : { class: cls }).range(cs, ce));
    }
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

/** Subtask progress for every parent task, keyed by 1-based line number.
 *
 * Scans the WHOLE document, not just the visible ranges: a parent on screen can
 * easily have its children scrolled below the fold, and a count that changed
 * with the scroll position would be a lie. Same full-document cost model as
 * scanFences / scanTables, which already run per build. */
function scanTaskProgress(doc: EditorView["state"]["doc"]): Map<number, TaskProgress> {
  const nodes: TaskNode[] = [];
  let fenced = false;
  for (let n = 1; n <= doc.lines; n++) {
    const text = doc.line(n).text;
    if (text.trimStart().startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue; // a checkbox inside a fence is code
    const block = parseBlock(text);
    if (block.kind === "task") {
      // `[/]` counts as NOT done — a parent's "2/4" must mean four finished
      // things, not four started ones
      nodes.push({ line: n, indent: block.indent ?? 0, done: block.state === "done" });
    }
  }
  return taskProgress(nodes);
}

function build(view: EditorView): { deco: DecorationSet; atomic: RangeSet<Decoration> } {
  const decos: Range<Decoration>[] = [];
  const atomics: Range<Decoration>[] = [];
  const sel = view.state.selection.main;
  const doc = view.state.doc;
  const progress = scanTaskProgress(doc);
  // blockRender owns the rendered fenced languages; livePreview must leave
  // every fenced line alone (raw code voice, never markdown-styled, and never a
  // decoration that collides with the block widget on the same range). Since
  // #13 (audit 2026-07) scanFences reports EVERY closed fence — generic ones
  // (```js, plain ```) get a mono-voice line class instead of markdown styling.
  const fences = scanFences(doc);
  // tableRender owns GFM tables (replaces the whole range with a <table> widget);
  // livePreview leaves every table line alone, just like fenced lines.
  const tables = scanTables(doc);
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = doc.lineAt(pos);
      const fence = fences.find((f) => line.from >= f.from && line.from <= f.to);
      if (fence || lineInTable(line.from, tables)) {
        // a NON-target fence is raw code the editor keeps verbatim — mono voice
        // only (a line class never collides with a replace decoration; target
        // fences stay untouched since blockRender swaps their whole range).
        if (fence && !fence.target) {
          decos.push(Decoration.line({ class: "rotli-fenceline" }).range(line.from));
        }
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

      // a line that is JUST an image renders inline; a caret in the line reveals
      // the source — EXCEPT an exact full-span selection, which is the
      // click- or arrow-selected image (stays rendered, outlined)
      const image = imageSourceSpan(text, ls);
      if (image && image.from === ls && line.to > ls) {
        const selected = selectionCoversImage(sel, ls, line.to);
        if (!lineTouched || selected) {
          const d = Decoration.replace({
            widget: new ImgWidget(image.alt, image.src, selected),
          });
          decos.push(d.range(ls, line.to));
          atomics.push(d.range(ls, line.to));
          pos = line.to + 1;
          continue;
        }
      }

      // a divider (--- / *** / ___) renders as a thin rule; caret reveals dashes
      if (HR_LINE.test(text) && !lineTouched && line.to > ls) {
        const d = Decoration.replace({ widget: new HrWidget() });
        decos.push(d.range(ls, line.to));
        atomics.push(d.range(ls, line.to));
        pos = line.to + 1;
        continue;
      }

      switch (block.kind) {
        case "h1":
        case "h2":
        case "h3":
        case "h4":
        case "h5":
        case "h6":
          decos.push(Decoration.line({ class: `rotli-${block.kind}` }).range(ls));
          revealablePrefix(ls, prefixEnd, lineTouched, decos, atomics);
          scanInline(content, contentBase, sel, decos, atomics);
          break;
        case "bullet":
          decos.push(
            Decoration.line({ class: "rotli-li", attributes: { style: listStyle(depth) } }).range(ls),
          );
          hidePrefix(ls, prefixEnd, new BulletWidget(depth), decos, atomics);
          if (listItemImage(content, contentBase, line.to, lineTouched, sel, decos, atomics)) break;
          scanInline(content, contentBase, sel, decos, atomics);
          break;
        case "numbered":
          decos.push(
            Decoration.line({ class: "rotli-li", attributes: { style: listStyle(depth) } }).range(ls),
          );
          hidePrefix(ls, prefixEnd, new NumberWidget(block.marker ?? "1."), decos, atomics);
          if (listItemImage(content, contentBase, line.to, lineTouched, sel, decos, atomics)) break;
          scanInline(content, contentBase, sel, decos, atomics);
          break;
        case "task":
          decos.push(
            Decoration.line({
              class: block.state === "done" ? "rotli-task done" : "rotli-task",
              // a checkbox hangs in a wider column than a glyph; an ordered
              // task ("1. [ ]") hangs by its number PLUS the checkbox
              attributes: { style: listStyle(depth, block.marker ? MARKER_EM + CHECK_EM : CHECK_EM) },
            }).range(ls),
          );
          hidePrefix(
            ls,
            prefixEnd,
            new CheckboxWidget(block.state ?? "open", block.marker ?? null),
            decos,
            atomics,
          );
          // only DONE strikes through: an in-progress task is still live work
          if (block.state === "done" && line.to > prefixEnd) {
            decos.push(Decoration.mark({ class: "rotli-done" }).range(prefixEnd, line.to));
          }
          {
            // the parent's subtask count, appended AFTER the text (side: 1) so
            // it never shifts a character of the line the user typed
            const p = progress.get(line.number);
            if (p) {
              decos.push(
                Decoration.widget({ widget: new ProgressWidget(p.done, p.total), side: 1 }).range(line.to),
              );
            }
          }
          if (listItemImage(content, contentBase, line.to, lineTouched, sel, decos, atomics)) break;
          scanInline(content, contentBase, sel, decos, atomics);
          break;
        case "result": {
          const state = block.resultState ?? "unanswered";
          const parts = resultTextParts(content);
          decos.push(
            Decoration.line({
              class: "rotli-result-line",
              attributes: { style: listStyle(depth, block.marker ? MARKER_EM + RESULT_EM : RESULT_EM) },
            }).range(ls),
          );
          hidePrefix(
            ls,
            prefixEnd,
            new ResultWidget(
              block.resultOptions ?? [
                { label: "Yes", selected: state === "yes", color: "green", source: "" },
                { label: "No", selected: state === "no", color: "red", source: "" },
              ],
              block.resultCompact ?? true,
              block.marker ?? null,
            ),
            decos,
            atomics,
          );
          if (state !== "unanswered" && parts.label.length > 0) {
            decos.push(
              Decoration.mark({ class: `rotli-result-text rotli-result-text--${state}` }).range(
                prefixEnd,
                prefixEnd + parts.label.length,
              ),
            );
          }
          if (state !== "unanswered" && parts.reason !== null) {
            const reasonFrom = prefixEnd + parts.label.length;
            if (line.to > reasonFrom) {
              decos.push(Decoration.mark({ class: "rotli-result-reason" }).range(reasonFrom, line.to));
            }
          } else if (state !== "unanswered" && parts.label.trim().length > 0) {
            decos.push(Decoration.widget({ widget: new ResultReasonWidget(), side: 1 }).range(line.to));
          }
          if (listItemImage(content, contentBase, line.to, lineTouched, sel, decos, atomics)) break;
          scanInline(content, contentBase, sel, decos, atomics);
          break;
        }
        case "choice":
          decos.push(
            Decoration.line({
              class: block.choiceSelected ? "rotli-choice-line is-selected" : "rotli-choice-line",
              attributes: { style: listStyle(depth, block.marker ? MARKER_EM + CHOICE_EM : CHOICE_EM) },
            }).range(ls),
          );
          hidePrefix(
            ls,
            prefixEnd,
            block.choiceVariant === "radio" || block.choiceVariant === "multi"
              ? new ChoiceControlWidget(
                  block.choiceVariant,
                  block.choiceSelected ?? false,
                  block.marker ?? null,
                )
              : new ChoiceWidget(block.choiceSelected ?? false, block.marker ?? null),
            decos,
            atomics,
          );
          if (block.choiceSelected && line.to > prefixEnd) {
            decos.push(Decoration.mark({ class: "rotli-choice-text--selected" }).range(prefixEnd, line.to));
          }
          if (listItemImage(content, contentBase, line.to, lineTouched, sel, decos, atomics)) break;
          scanInline(content, contentBase, sel, decos, atomics);
          break;
        case "toggle":
          decos.push(
            Decoration.line({
              class: "rotli-toggle-line",
              attributes: { style: listStyle(depth, block.marker ? MARKER_EM + RESULT_EM : RESULT_EM) },
            }).range(ls),
          );
          hidePrefix(
            ls,
            prefixEnd,
            new ToggleWidget(
              block.toggleOptions ?? [
                { label: "On", selected: block.toggleOn === true, color: "green", source: "" },
                { label: "Off", selected: block.toggleOn !== true, color: "red", source: "" },
              ],
              block.toggleCompact ?? true,
              block.toggleOn ?? false,
              block.marker ?? null,
            ),
            decos,
            atomics,
          );
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

// ─── ⌘-click opens a link (#14, audit 2026-07) ───────────────────────────────
// Plain click stays the edit path (caret in, markers reveal); holding ⌘ routes
// the link's url through the scheme-allowlisted Rust opener instead. Works in
// beautified AND raw mode — the match runs on the underlying markdown text, not
// the decoration, so it doesn't care whether the markers are hidden.

const MD_LINK = /\[([^\]]+)\]\(([^)]*)\)/g;

function tryOpenWikilinkAt(lineText: string, lineFrom: number, pos: number): boolean {
  WIKILINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKILINK_RE.exec(lineText)) !== null) {
    const from = lineFrom + m.index;
    const to = from + m[0].length;
    if (pos >= from && pos <= to) {
      const id = resolveWikilinkTarget(m[1] ?? "");
      if (id) {
        usePanesStore.getState().openNote(id);
        return true;
      }
      return false;
    }
    if (from > pos) break;
  }
  return false;
}

function tryOpenMarkdownLinkAt(lineText: string, lineFrom: number, pos: number): boolean {
  MD_LINK.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MD_LINK.exec(lineText)) !== null) {
    const from = lineFrom + m.index;
    const to = from + m[0].length;
    if (pos >= from && pos <= to) {
      const url = (m[2] ?? "").trim();
      if (url) void openUrl(url).catch(() => {});
      return true;
    }
    if (from > pos) break;
  }
  return false;
}

// mirrors the autolink INLINE rule — a bare url ⌘-clicks open like an md link
const BARE_URL = /https?:\/\/[^\s<>()[\]]*[^\s<>()[\].,;:!?'"]/g;

function tryOpenBareUrlAt(lineText: string, lineFrom: number, pos: number): boolean {
  BARE_URL.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BARE_URL.exec(lineText)) !== null) {
    const from = lineFrom + m.index;
    const to = from + m[0].length;
    if (pos >= from && pos <= to) {
      void openUrl(m[0]).catch(() => {});
      return true;
    }
    if (from > pos) break;
  }
  return false;
}

export const linkOpener = EditorView.domEventHandlers({
  click(e, view) {
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    if (pos == null) return false;
    const line = view.state.doc.lineAt(pos);
    // Note links are workspace navigation, so they behave like visible links.
    // Ordinary web URLs keep the deliberate ⌘-click editor gesture.
    if (
      (editorLinkOpensOnClick("note", e.button, e.metaKey) && tryOpenWikilinkAt(line.text, line.from, pos)) ||
      (editorLinkOpensOnClick("web", e.button, e.metaKey) &&
        (tryOpenMarkdownLinkAt(line.text, line.from, pos) || tryOpenBareUrlAt(line.text, line.from, pos)))
    ) {
      e.preventDefault();
      return true;
    }
    return false;
  },
});

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
    provide: (plugin) => EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomic ?? RangeSet.empty),
  },
);
