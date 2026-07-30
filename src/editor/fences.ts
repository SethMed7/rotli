// Shared fenced-code-block scanner — used by blockRender (renders the target
// math / mermaid / jsxgraph / svg / html languages as widgets) AND by livePreview (which
// skips fenced lines so code is never markdown-styled and never collides with a
// block widget). Pure + dependency-light on purpose: livePreview must NOT pull
// katex/mermaid/jsxgraph into its module graph, so the scanner lives here.

import type { Text } from "@codemirror/state";

export type LangKey = "math" | "mermaid" | "jsxgraph" | "svg" | "html" | "board" | "sheet" | "document";

export const TARGET_LANGS = new Set<string>([
  "math",
  "mermaid",
  "jsxgraph",
  "svg",
  "html",
  "board",
  "sheet",
  "document",
]);

export interface FenceBlock {
  /** The fence's info-string ("js", "python", "" …) — a LangKey when `target`. */
  lang: string;
  /** True when blockRender owns this fence (lang ∈ TARGET_LANGS → a widget).
   * A non-target fence renders as plain code (mono voice, never markdown-styled,
   * never table-widgetized) — #13, audit 2026-07. */
  target: boolean;
  /** Doc position: start of the ```lang opening line. */
  from: number;
  /** Doc position: end of the closing ``` line. */
  to: number;
}

// `+` joined the class for ```c++ (PR #10 review: the c++ alias was dead —
// the scanner rejected the line entirely, leaving the block markdown-styled)
const FENCE_OPEN = /^```([A-Za-z0-9+_-]*)\s*$/;
const FENCE_CLOSE = /^```\s*$/;

/** Collect EVERY fully-closed fence — target langs flagged for blockRender, and
 * generic/unknown fences (```js, plain ```) so livePreview/tableRender can leave
 * their code alone (they used to markdown-style it and rewrite pipe-table
 * examples inside it — #13, audit 2026-07). An unterminated fence is skipped
 * (treated as plain text) so a half-typed block never blanks the editor. Cheap
 * line-regex walk; callers cache by doc. */
export function scanFences(doc: Text): FenceBlock[] {
  const blocks: FenceBlock[] = [];
  const lines = doc.lines;
  let n = 1;
  while (n <= lines) {
    const line = doc.line(n);
    const open = FENCE_OPEN.exec(line.text);
    if (open) {
      const lang = open[1] ?? "";
      let close = -1;
      for (let m = n + 1; m <= lines; m++) {
        if (FENCE_CLOSE.test(doc.line(m).text)) {
          close = m;
          break;
        }
      }
      if (close === -1) break; // unterminated — leave the rest as plain text
      blocks.push({
        lang,
        target: TARGET_LANGS.has(lang),
        from: line.from,
        to: doc.line(close).to,
      });
      n = close + 1;
      continue;
    }
    n++;
  }
  return blocks;
}

/** True when a line (by its start pos) sits inside any of the fenced ranges —
 * the open ```lang line, the inner body, or the closing ``` line. */
export function lineInFence(lineFrom: number, fences: FenceBlock[]): boolean {
  return fences.some((f) => lineFrom >= f.from && lineFrom <= f.to);
}

/** The inner body of a fence (between the ``` lines), verbatim. */
export function innerCode(doc: Text, from: number, to: number): string {
  const openLine = doc.lineAt(from);
  const closeLine = doc.lineAt(to);
  if (closeLine.from <= openLine.to + 1) return ""; // no inner lines
  return doc.sliceString(openLine.to + 1, closeLine.from - 1);
}
