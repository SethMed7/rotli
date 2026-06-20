// The tiny line renderer — a pure function of the line text (r1 frame A is
// the pixel truth for rendered output). Blocks: # ## ### headings, - bullets,
// 1. numbered, - [ ]/- [x] tasks, > quotes. Inline marks: **bold**, *italic*,
// ~~strike~~, `code`, ==highlight== (always peach tint), <u>underline</u>
// (the r3 marks law), [text](url) links. No raw HTML passthrough beyond <u>.

import type { MouseEvent, ReactNode } from "react";

export type BlockKind =
  | "h1"
  | "h2"
  | "h3"
  | "bullet"
  | "numbered"
  | "task"
  | "quote"
  | "para"
  | "blank";

export interface Block {
  kind: BlockKind;
  /** Source chars before the visible text (the markdown prefix, incl. any
   * leading indent for a nested list). */
  prefixLen: number;
  text: string;
  done?: boolean;
  marker?: string;
  /** Leading-space count for a nested list item (0 = top level). 2 spaces/level. */
  indent?: number;
}

const TASK_RE = /^- \[([ xX])\] /;
const NUMBERED_RE = /^(\d+)\. /;
const HEADING_RE = /^(#{1,3}) /;

export function parseBlock(line: string): Block {
  if (line.trim() === "") return { kind: "blank", prefixLen: 0, text: "" };
  // headings are never indented (markdown nests lists, not headings)
  const h = HEADING_RE.exec(line);
  if (h?.[1]) {
    const kind = (`h${h[1].length}`) as "h1" | "h2" | "h3";
    return { kind, prefixLen: h[0].length, text: line.slice(h[0].length) };
  }
  // list kinds may carry a leading indent → nesting depth (2 spaces per level)
  const indent = /^( +)/.exec(line)?.[1]?.length ?? 0;
  const body = indent > 0 ? line.slice(indent) : line;
  const t = TASK_RE.exec(body);
  if (t) return { kind: "task", prefixLen: indent + t[0].length, text: body.slice(t[0].length), done: t[1] !== " ", indent };
  if (body.startsWith("- ")) return { kind: "bullet", prefixLen: indent + 2, text: body.slice(2), indent };
  const n = NUMBERED_RE.exec(body);
  if (n) return { kind: "numbered", prefixLen: indent + n[0].length, text: body.slice(n[0].length), marker: `${n[1]}.`, indent };
  // quotes de-indent like the other list kinds so a Tab-nested quote ("  > x")
  // stays a quote (and nests) instead of falling through to a literal paragraph
  if (body.startsWith("> ")) return { kind: "quote", prefixLen: indent + 2, text: body.slice(2), indent };
  return { kind: "para", prefixLen: 0, text: line };
}

// ——— inline marks ———

interface InlineRule {
  re: RegExp;
  render: (m: RegExpExecArray, key: number) => ReactNode;
}

function stopLink(event: MouseEvent): void {
  event.preventDefault(); // Stage 1: links render, never navigate the webview
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
      <a className="md-link" href={m[2] || "#"} key={key} onClick={stopLink}>
        {renderInline(m[1] ?? "")}
      </a>
    ),
  },
  {
    re: /\*([^*\s](?:[^*]*[^*\s])?)\*/,
    render: (m, key) => <em key={key}>{renderInline(m[1] ?? "")}</em>,
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

// ——— the rendered line ———

function CheckGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m4 12.5 5 5L20 6.5" />
    </svg>
  );
}

export function RenderedLine({
  line,
  onToggleTask,
}: {
  line: string;
  onToggleTask?: (() => void) | undefined;
}): ReactNode {
  const block = parseBlock(line);
  // nested-list depth → a left inset (2 source spaces per level)
  const depth = Math.floor((block.indent ?? 0) / 2);
  const nest = depth > 0 ? { marginLeft: depth * 22 } : undefined;
  switch (block.kind) {
    case "h1":
      return <h1 className="md-h1">{renderInline(block.text)}</h1>;
    case "h2":
      return <h2 className="md-h2">{renderInline(block.text)}</h2>;
    case "h3":
      return <h3 className="md-h3">{renderInline(block.text)}</h3>;
    case "task":
      return (
        <div className={block.done ? "task done" : "task"} style={nest}>
          <button
            type="button"
            className="box"
            role="checkbox"
            aria-checked={block.done}
            aria-label={block.done ? "Mark not done" : "Mark done"}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={onToggleTask}
          >
            {block.done && <CheckGlyph />}
          </button>
          <span className="task-text">{renderInline(block.text)}</span>
        </div>
      );
    case "bullet": {
      // bullets cycle glyph by depth so nested levels read distinctly
      const glyph = depth % 3 === 1 ? "◦" : depth % 3 === 2 ? "▪" : "•";
      return (
        <div className="md-li" style={nest}>
          <span className="li-marker" aria-hidden="true">
            {glyph}
          </span>
          <span>{renderInline(block.text)}</span>
        </div>
      );
    }
    case "numbered":
      return (
        <div className="md-li" style={nest}>
          <span className="li-marker num">{block.marker}</span>
          <span>{renderInline(block.text)}</span>
        </div>
      );
    case "quote":
      return (
        <blockquote className="md-quote" style={nest}>
          {renderInline(block.text)}
        </blockquote>
      );
    case "blank":
      return <div className="md-blank" />;
    case "para":
      return <p className="md-p">{renderInline(block.text)}</p>;
  }
}

// ——— the raw active line's tinted twin (r4/r5: syntax chars in clay-deep) ———

const RAW_TOKEN = /(\*\*|==|~~|`|<\/?u>|\]\([^)]*\)|\[|\*)/g;

/** True when the source line carries markdown syntax to reveal. The mono raw
 *  voice is reserved for these lines (r1/r4/r5 rawline); a plain paragraph
 *  keeps the body voice even with the caret inside it (r3 frame E). */
export function hasSyntax(line: string): boolean {
  if (parseBlock(line).prefixLen > 0) return true;
  RAW_TOKEN.lastIndex = 0;
  return RAW_TOKEN.test(line);
}

export function rawSegments(line: string): ReactNode[] {
  const out: ReactNode[] = [];
  let key = 0;
  const block = parseBlock(line);
  let rest = line;
  if (block.prefixLen > 0) {
    out.push(
      <span className="mdsyn" key={key++}>
        {line.slice(0, block.prefixLen)}
      </span>,
    );
    rest = line.slice(block.prefixLen);
  }
  RAW_TOKEN.lastIndex = 0;
  let last = 0;
  let m = RAW_TOKEN.exec(rest);
  while (m) {
    if (m.index > last) out.push(rest.slice(last, m.index));
    out.push(
      <span className="mdsyn" key={key++}>
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
    m = RAW_TOKEN.exec(rest);
  }
  if (last < rest.length) out.push(rest.slice(last));
  return out;
}
