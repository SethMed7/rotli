// The tiny line renderer — a pure function of the line text (r1 frame A is
// the pixel truth for rendered output). Blocks: # ## ### headings, - bullets,
// 1. numbered, - [ ]/- [x] and 1. [ ] (ordered) tasks, > quotes. Inline marks: **bold**, *italic*,
// ~~strike~~, `code`, ==highlight== (always peach tint), <u>underline</u>
// (the r3 marks law), [text](url) links. No raw HTML passthrough beyond <u>.

import type { MouseEvent, ReactNode } from "react";

import { openUrl } from "../lib/tauri";
import { ORDERED_TASK_RE, TASK_RE, type TaskState, taskStateOf } from "./taskState";

export type HeadingKind = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

export type BlockKind = HeadingKind | "bullet" | "numbered" | "task" | "quote" | "para" | "blank";

export interface Block {
  kind: BlockKind;
  /** Source chars before the visible text (the markdown prefix, incl. any
   * leading indent for a nested list). */
  prefixLen: number;
  text: string;
  /** A task's checkbox state — open, doing (`[/]`), or done. Undefined for
   * every other kind. It replaced a plain boolean on 2026-08-04: a boolean had
   * nowhere to put "in progress", and made a typed `[/]` render as CHECKED. */
  state?: TaskState;
  /** The `1.` glyph of a numbered item — also set on an ORDERED task
   * (`1. [ ] x`), which parses as kind "task" with a marker. */
  marker?: string;
  /** Leading-space count for a nested list item (0 = top level). 2 spaces/level. */
  indent?: number;
}

const NUMBERED_RE = /^(\d+)\. /;
// H1–H6 (widened 2026-08-04 for heading folding). `#### x` used to fall through
// as a plain paragraph — standard Markdown says it's a heading, and folding
// needs the level to know where a section ends.
const HEADING_RE = /^(#{1,6}) /;

export function parseBlock(line: string): Block {
  if (line.trim() === "") return { kind: "blank", prefixLen: 0, text: "" };
  // headings are never indented (markdown nests lists, not headings)
  const h = HEADING_RE.exec(line);
  if (h?.[1]) {
    const kind = `h${h[1].length}` as HeadingKind;
    return { kind, prefixLen: h[0].length, text: line.slice(h[0].length) };
  }
  // list kinds may carry a leading indent → nesting depth (2 columns per
  // level). TAB-tolerant (the maintainer, 2026-07-28): foreign notes indent with tabs —
  // a tab counts one level; prefixLen stays CHARACTER-based for offsets while
  // `indent` carries columns for depth.
  const indentChars = /^[ \t]+/.exec(line)?.[0] ?? "";
  const indent = indentChars.replace(/\t/g, "  ").length;
  const body = indentChars ? line.slice(indentChars.length) : line;
  const t = TASK_RE.exec(body);
  if (t)
    return {
      kind: "task",
      prefixLen: indentChars.length + t[0].length,
      text: body.slice(t[0].length),
      state: taskStateOf(t[1] ?? " "),
      indent,
    };
  if (body.startsWith("- "))
    return { kind: "bullet", prefixLen: indentChars.length + 2, text: body.slice(2), indent };
  // GFM's ordered task ("1. [ ] x") — a task that keeps its number as marker;
  // must win over the plain numbered rule below
  const ot = ORDERED_TASK_RE.exec(body);
  if (ot)
    return {
      kind: "task",
      prefixLen: indentChars.length + ot[0].length,
      text: body.slice(ot[0].length),
      state: taskStateOf(ot[2] ?? " "),
      marker: `${ot[1]}.`,
      indent,
    };
  const n = NUMBERED_RE.exec(body);
  if (n)
    return {
      kind: "numbered",
      prefixLen: indentChars.length + n[0].length,
      text: body.slice(n[0].length),
      marker: `${n[1]}.`,
      indent,
    };
  // quotes de-indent like the other list kinds so a Tab-nested quote ("  > x")
  // stays a quote (and nests) instead of falling through to a literal paragraph
  if (body.startsWith("> "))
    return { kind: "quote", prefixLen: indentChars.length + 2, text: body.slice(2), indent };
  return { kind: "para", prefixLen: 0, text: line };
}

// ——— inline marks ———

interface InlineRule {
  re: RegExp;
  render: (m: RegExpExecArray, key: number) => ReactNode;
}

/** Rendered links OPEN now (#14, audit 2026-07): clicking routes the href
 * through the scheme-allowlisted Rust opener — the webview itself never
 * navigates (that part of the Stage-1 rule stands). */
function openLink(event: MouseEvent<HTMLAnchorElement>): void {
  event.preventDefault();
  const href = event.currentTarget.getAttribute("href") ?? "";
  // a non-openable scheme simply doesn't open — the allowlist lives in Rust
  if (href && href !== "#") void openUrl(href).catch(() => {});
}

/** Order matters: code is opaque, ** wins over *. */
const INLINE_RULES: InlineRule[] = [
  {
    re: /`([^`]+)`/,
    render: (m, key) => (
      <code className="md-code" key={key}>
        {m[1]}
      </code>
    ),
  },
  {
    re: /\*\*((?:[^*]|\*(?!\*))+)\*\*/,
    render: (m, key) => <strong key={key}>{renderInline(m[1] ?? "")}</strong>,
  },
  {
    re: /==([^=]+)==/,
    render: (m, key) => (
      <mark className="md-hl" key={key}>
        {renderInline(m[1] ?? "")}
      </mark>
    ),
  },
  {
    re: /~~([^~]+)~~/,
    render: (m, key) => <s key={key}>{renderInline(m[1] ?? "")}</s>,
  },
  {
    re: /<u>(.*?)<\/u>/,
    render: (m, key) => <u key={key}>{renderInline(m[1] ?? "")}</u>,
  },
  {
    re: /\[([^\]]+)\]\(([^)]*)\)/,
    render: (m, key) => (
      <a className="md-link" href={m[2] || "#"} title={m[2] || undefined} key={key} onClick={openLink}>
        {renderInline(m[1] ?? "")}
      </a>
    ),
  },
  {
    re: /\*([^*\s](?:[^*]*[^*\s])?)\*/,
    render: (m, key) => <em key={key}>{renderInline(m[1] ?? "")}</em>,
  },
  // a BARE url is a link too (mirrors livePreview's autolink rule) — the
  // md-link rule sits earlier so `[t](url)` keeps winning the scan
  {
    re: /https?:\/\/[^\s<>()[\]]*[^\s<>()[\].,;:!?'"]/,
    render: (m, key) => (
      <a className="md-link" href={m[0]} title={m[0]} key={key} onClick={openLink}>
        {m[0]}
      </a>
    ),
  },
];

export function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let key = 0;
  while (rest.length > 0) {
    let best: { index: number; match: RegExpExecArray; rule: InlineRule } | null = null;
    for (const rule of INLINE_RULES) {
      const match = rule.re.exec(rest);
      if (match && (best === null || match.index < best.index)) {
        best = { index: match.index, match, rule };
      }
    }
    if (!best) {
      out.push(rest);
      break;
    }
    if (best.index > 0) out.push(rest.slice(0, best.index));
    out.push(best.rule.render(best.match, key++));
    rest = rest.slice(best.index + best.match[0].length);
  }
  return out;
}
