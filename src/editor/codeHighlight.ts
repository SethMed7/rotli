// IDE-grade syntax colors for fenced code (the maintainer, 2026-07-30: "when code is
// put it renders nice including colors like it would in an IDE"). A StateField
// of mark decorations over NON-target fences whose info-string names a known
// language. Parsing rides the Lezer parsers CodeMirror ships (exact offsets,
// public API); each language loads lazily on first use — the mermaid/katex
// pattern — so the editor chunk stays lean. Between async rebuilds the
// existing marks map through edits, so colors never flicker while typing.
// Unknown languages stay PLAIN on purpose: wrong colors are worse than none.

import { type Extension, type Range, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { Parser } from "@lezer/common";
import { highlightTree, tagHighlighter, tags } from "@lezer/highlight";

import { normalizeFenceLang } from "./codeLangs";
import { scanFences } from "./fences";

// ── language registry (lazy) ──────────────────────────────────────────────────

type ParserLoader = () => Promise<Parser>;

/** Stream-mode helper: wrap a legacy mode in a Lezer-compatible parser. */
function legacy(load: () => Promise<{ mode: unknown }>): ParserLoader {
  return async () => {
    const [{ StreamLanguage }, { mode }] = await Promise.all([import("@codemirror/language"), load()]);
    return StreamLanguage.define(mode as never).parser;
  };
}

const LOADERS: Record<string, ParserLoader> = {
  typescript: async () => (await import("@codemirror/lang-javascript")).typescriptLanguage.parser,
  javascript: async () => (await import("@codemirror/lang-javascript")).javascriptLanguage.parser,
  json: async () => (await import("@codemirror/lang-json")).jsonLanguage.parser,
  python: async () => (await import("@codemirror/lang-python")).pythonLanguage.parser,
  rust: async () => (await import("@codemirror/lang-rust")).rustLanguage.parser,
  html: async () => (await import("@codemirror/lang-html")).htmlLanguage.parser,
  css: async () => (await import("@codemirror/lang-css")).cssLanguage.parser,
  sql: async () => (await import("@codemirror/lang-sql")).StandardSQL.language.parser,
  yaml: async () => (await import("@codemirror/lang-yaml")).yamlLanguage.parser,
  java: async () => (await import("@codemirror/lang-java")).javaLanguage.parser,
  cpp: async () => (await import("@codemirror/lang-cpp")).cppLanguage.parser,
  // top: "Program" — doc snippets rarely open with <?php, and the default
  // Template top emits ZERO tokens for tag-less code (PR #10 review)
  php: async () => (await import("@codemirror/lang-php")).phpLanguage.parser.configure({ top: "Program" }),
  go: async () => (await import("@codemirror/lang-go")).goLanguage.parser,
  bash: legacy(async () => ({ mode: (await import("@codemirror/legacy-modes/mode/shell")).shell })),
  swift: legacy(async () => ({ mode: (await import("@codemirror/legacy-modes/mode/swift")).swift })),
  ruby: legacy(async () => ({ mode: (await import("@codemirror/legacy-modes/mode/ruby")).ruby })),
  kotlin: legacy(async () => ({ mode: (await import("@codemirror/legacy-modes/mode/clike")).kotlin })),
  c: legacy(async () => ({ mode: (await import("@codemirror/legacy-modes/mode/clike")).c })),
  toml: legacy(async () => ({ mode: (await import("@codemirror/legacy-modes/mode/toml")).toml })),
  ini: legacy(async () => ({ mode: (await import("@codemirror/legacy-modes/mode/properties")).properties })),
  dockerfile: legacy(async () => ({
    mode: (await import("@codemirror/legacy-modes/mode/dockerfile")).dockerFile,
  })),
};

const parserCache = new Map<string, Promise<Parser | null>>();

function parserFor(lang: string): Promise<Parser | null> {
  let cached = parserCache.get(lang);
  if (!cached) {
    const loader = LOADERS[lang];
    cached = loader ? loader().catch(() => null) : Promise.resolve(null);
    parserCache.set(lang, cached);
  }
  return cached;
}

// ── tokens → classes (colors ride the accent swatch tokens; editor.css) ──────

const rotliHighlighter = tagHighlighter([
  { tag: tags.keyword, class: "rotli-tok-kw" },
  { tag: tags.moduleKeyword, class: "rotli-tok-kw" },
  { tag: [tags.string, tags.special(tags.string), tags.regexp, tags.escape], class: "rotli-tok-str" },
  { tag: [tags.comment, tags.blockComment, tags.lineComment, tags.docComment], class: "rotli-tok-cmt" },
  { tag: [tags.number, tags.integer, tags.float, tags.bool, tags.null, tags.atom], class: "rotli-tok-num" },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.macroName],
    class: "rotli-tok-fn",
  },
  { tag: [tags.typeName, tags.className, tags.namespace, tags.tagName], class: "rotli-tok-type" },
  { tag: [tags.propertyName, tags.attributeName, tags.labelName], class: "rotli-tok-attr" },
  { tag: [tags.meta, tags.processingInstruction, tags.annotation], class: "rotli-tok-cmt" },
]);

// ── the field + async rebuild plugin ─────────────────────────────────────────

const setHighlights = StateEffect.define<DecorationSet>();

const codeHighlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    if (tr.docChanged) deco = deco.map(tr.changes);
    for (const e of tr.effects) if (e.is(setHighlights)) deco = e.value;
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const REBUILD_DEBOUNCE_MS = 120;

const rebuildPlugin = ViewPlugin.fromClass(
  class {
    private timer: ReturnType<typeof setTimeout> | null = null;
    private generation = 0;
    constructor(readonly view: EditorView) {
      this.schedule();
    }
    update(u: ViewUpdate) {
      if (u.docChanged) this.schedule();
    }
    destroy() {
      if (this.timer !== null) clearTimeout(this.timer);
      this.generation += 1; // any in-flight rebuild becomes stale
    }
    private schedule() {
      if (this.timer !== null) clearTimeout(this.timer);
      this.timer = setTimeout(() => void this.rebuild(), REBUILD_DEBOUNCE_MS);
    }
    private async rebuild() {
      const generation = ++this.generation;
      const doc = this.view.state.doc;
      const fences = scanFences(doc)
        .filter((fence) => !fence.target)
        .map((fence) => ({ fence, lang: normalizeFenceLang(fence.lang) }))
        .filter((entry): entry is { fence: (typeof entry)["fence"]; lang: string } => entry.lang !== null);
      // load every needed parser in PARALLEL — distinct languages used to
      // chain their module imports serially (PR #10 review)
      const parsers = new Map(
        await Promise.all(
          [...new Set(fences.map((entry) => entry.lang))].map(
            async (lang) => [lang, await parserFor(lang)] as const,
          ),
        ),
      );
      if (generation !== this.generation) return; // superseded while loading
      const ranges: Range<Decoration>[] = [];
      for (const { fence, lang } of fences) {
        const openLine = doc.lineAt(fence.from);
        const closeLine = doc.lineAt(fence.to);
        if (closeLine.number - openLine.number < 2) continue; // no content lines
        const from = doc.line(openLine.number + 1).from;
        const to = doc.line(closeLine.number - 1).to;
        const parser = parsers.get(lang);
        if (!parser) continue;
        const code = doc.sliceString(from, to);
        try {
          highlightTree(parser.parse(code), rotliHighlighter, (a, b, cls) => {
            if (cls) ranges.push(Decoration.mark({ class: cls }).range(from + a, from + b));
          });
        } catch {
          // a parser crash on odd input leaves the fence plain — never the note broken
        }
      }
      if (generation !== this.generation) return; // superseded by a newer edit
      if (this.view.state.doc !== doc) return; // doc moved while parsing — the newer schedule owns it
      this.view.dispatch({ effects: setHighlights.of(Decoration.set(ranges, true)) });
    }
  },
);

export const codeHighlight: Extension = [codeHighlightField, rebuildPlugin];
