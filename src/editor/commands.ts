// Markdown command grammar — pure line-edit helpers (toggle semantics:
// wrap/unwrap, prefix/unprefix) + the active-editor handle the key registry
// dispatches to. The marks law (r3, approved): underline = <u>…</u>,
// highlight = ==…== (always peach); bold/italic/strike native syntax.

import { usePanesStore } from "../state/panes";
import { CHOICE_MARK } from "./choiceState";
import { parseChoiceControlLine, parseToggleLine } from "./controlState";
import { ORDERED_MARKER_SOURCE } from "./listMarkers";
import { parseResultLine, RESULT_MARK } from "./resultState";
import { MARK } from "./taskState";

export type InlineMark = "bold" | "italic" | "underline" | "strike" | "code" | "highlight" | "link";
export type BlockToggle = "quote" | "bullet" | "numbered" | "checklist";
export type HeadingLevel = 1 | 2 | 3;

export interface EditorHandle {
  /** Open the active document's find bar. Optional on non-document editors. */
  find?(): void;
  toggleMark(mark: InlineMark): void;
  setHeading(level: HeadingLevel): void;
  toggleBlock(kind: BlockToggle): void;
  /** Fold/unfold the section the caret sits in (2026-08-04). Optional so a
   * surface without folding (the Quick Note window) simply doesn't offer it. */
  toggleFold?(): void;
}

// Every mounted editor surface registers its handle under its pane id; the
// registry's editor.* actions resolve through the panes store's focusedPaneId,
// so keyboard pane focus (⌘⌥arrows), palette activation, and pane closing all
// keep the seam pointed at the right editor — no last-clicked pointer.
const handles = new Map<string, EditorHandle>();

export function registerEditor(paneId: string, handle: EditorHandle): void {
  handles.set(paneId, handle);
}

export function unregisterEditor(paneId: string, handle: EditorHandle): void {
  if (handles.get(paneId) === handle) handles.delete(paneId);
}

export function activeEditor(): EditorHandle | null {
  return handles.get(usePanesStore.getState().focusedPaneId) ?? null;
}

// ——— inline marks ———

const MARKS: Record<Exclude<InlineMark, "link">, { open: string; close: string }> = {
  bold: { open: "**", close: "**" },
  italic: { open: "*", close: "*" },
  underline: { open: "<u>", close: "</u>" },
  strike: { open: "~~", close: "~~" },
  code: { open: "`", close: "`" },
  highlight: { open: "==", close: "==" },
};

export interface LineEdit {
  line: string;
  selStart: number;
  selEnd: number;
}

/** Consecutive `*` touching `at`, walking left (dir -1) or right (dir 1). */
function starRun(line: string, at: number, dir: -1 | 1): number {
  let n = 0;
  for (let i = dir < 0 ? at - 1 : at; i >= 0 && i < line.length && line[i] === "*"; i += dir) n++;
  return n;
}

/** Whether `open`/`close` sit right around [a, b). Stars are counted as runs so
 * italic inside bold (`***x***`) reads as both marks, and `**x**` is not italic. */
function markAround(line: string, a: number, b: number, mark: Exclude<InlineMark, "link">): boolean {
  const { open, close } = MARKS[mark];
  if (mark === "italic" || mark === "bold") {
    const left = starRun(line, a, -1);
    const right = starRun(line, b, 1);
    return mark === "italic" ? left % 2 === 1 && right % 2 === 1 : left >= 2 && right >= 2;
  }
  return (
    a >= open.length && line.slice(a - open.length, a) === open && line.slice(b, b + close.length) === close
  );
}

/** Walk outward over other marks' delimiters until `mark` wraps [a, b), so one
 * mark comes off a stack like `***<u>x</u>***` without disturbing the rest. */
function enclosingLayer(
  line: string,
  a: number,
  b: number,
  mark: Exclude<InlineMark, "link">,
): { a: number; b: number } | null {
  for (;;) {
    if (markAround(line, a, b, mark)) return { a, b };
    const other = (Object.keys(MARKS) as Exclude<InlineMark, "link">[]).find(
      (m) => m !== mark && m !== "bold" && m !== "italic" && markAround(line, a, b, m),
    );
    const stars = Math.min(starRun(line, a, -1), starRun(line, b, 1));
    if (other) {
      a -= MARKS[other].open.length;
      b += MARKS[other].close.length;
    } else if (mark !== "bold" && mark !== "italic" && stars > 0) {
      a -= stars;
      b += stars;
    } else {
      return null;
    }
  }
}

export function toggleInlineMark(line: string, selStart: number, selEnd: number, mark: InlineMark): LineEdit {
  if (mark === "link") return toggleLink(line, selStart, selEnd);
  const { open, close } = MARKS[mark];
  const sel = line.slice(selStart, selEnd);
  // inline code is opaque: any other mark wraps OUTSIDE its backticks
  const inCode =
    mark !== "code" &&
    line[selStart - 1] === "`" &&
    line[selEnd] === "`" &&
    !sel.includes("`") &&
    selEnd > selStart;
  const a = inCode ? selStart - 1 : selStart;
  const b = inCode ? selEnd + 1 : selEnd;
  // unwrap: the mark sits around the selection, possibly outside other marks
  const layer = enclosingLayer(line, a, b, mark);
  if (layer) {
    return {
      line:
        line.slice(0, layer.a - open.length) +
        line.slice(layer.a, layer.b) +
        line.slice(layer.b + close.length),
      selStart: selStart - open.length,
      selEnd: selEnd - open.length,
    };
  }
  // unwrap: the selection includes the marks
  const inner = sel.slice(open.length, sel.length - close.length);
  if (
    !inCode &&
    sel.length >= open.length + close.length &&
    sel.startsWith(open) &&
    sel.endsWith(close) &&
    markAround(sel, open.length, sel.length - close.length, mark)
  ) {
    return {
      line: line.slice(0, selStart) + inner + line.slice(selEnd),
      selStart,
      selEnd: selStart + inner.length,
    };
  }
  // wrap (empty selection leaves the caret inside the new pair)
  return {
    line: line.slice(0, a) + open + line.slice(a, b) + close + line.slice(b),
    selStart: selStart + open.length,
    selEnd: selEnd + open.length,
  };
}

function toggleLink(line: string, selStart: number, selEnd: number): LineEdit {
  const sel = line.slice(selStart, selEnd);
  const next = `${line.slice(0, selStart)}[${sel}]()${line.slice(selEnd)}`;
  const caret = selEnd + 3; // inside the (), ready for the url
  return { line: next, selStart: caret, selEnd: caret };
}

/** Caret-context active state: is `pos` inside a CLOSED marked span on this line? */
export function isMarkActive(line: string, pos: number, mark: InlineMark): boolean {
  if (mark === "link") return false;
  const { open, close } = MARKS[mark];
  // italic must not count the bold pairs
  const scan = mark === "italic" ? line.replace(/\*\*/g, "¤¤") : line;
  if (open === close) {
    let count = 0;
    let i = scan.indexOf(open);
    while (i !== -1 && i < pos) {
      count++;
      i = scan.indexOf(open, i + open.length);
    }
    // an odd opener count is only a span once its closer exists — a lone
    // `**Testing` renders plain, so the bar must not light B for it
    return count % 2 === 1 && scan.indexOf(close, pos) !== -1;
  }
  return countBefore(scan, open, pos) > countBefore(scan, close, pos) && scan.indexOf(close, pos) !== -1;
}

function countBefore(text: string, token: string, pos: number): number {
  let count = 0;
  let i = text.indexOf(token);
  while (i !== -1 && i < pos) {
    count++;
    i = text.indexOf(token, i + token.length);
  }
  return count;
}

// ——— headings ———

const ANY_HEADING_RE = /^#{1,6} /;

export function headingLevelOf(line: string): number {
  const m = /^(#{1,3}) /.exec(line);
  return m?.[1] ? m[1].length : 0;
}

export interface PrefixEdit {
  line: string;
  /** Caret shift (prefix chars added or removed). */
  delta: number;
}

/** Toggle semantics: same level again returns the line to body. */
export function applyHeading(line: string, level: HeadingLevel): PrefixEdit {
  const m = ANY_HEADING_RE.exec(line);
  const stripped = m ? line.slice(m[0].length) : line;
  if (headingLevelOf(line) === level) return { line: stripped, delta: stripped.length - line.length };
  const next = `${"#".repeat(level)} ${stripped}`;
  return { line: next, delta: next.length - line.length };
}

// ——— block prefixes ———

const RESULT_PAIR = `\\[${RESULT_MARK}\\]\\[${RESULT_MARK}\\] `;
const CHOICE_PREFIX = `\\(${CHOICE_MARK}\\) `;
const ANY_BLOCK_PREFIX = new RegExp(
  `^(\\d+\\. ${RESULT_PAIR}|- ${RESULT_PAIR}|\\d+\\. ${CHOICE_PREFIX}|- ${CHOICE_PREFIX}|\\d+\\. \\[${MARK}\\] |- \\[${MARK}\\] |- |${ORDERED_MARKER_SOURCE} |> )`,
);

const BLOCK_RULES: Record<BlockToggle, { add: string; test: RegExp }> = {
  quote: { add: "> ", test: /^> / },
  bullet: { add: "- ", test: new RegExp(`^- (?!${RESULT_PAIR}|${CHOICE_PREFIX}|\\[${MARK}\\] )`) },
  numbered: {
    add: "1. ",
    test: new RegExp(`^${ORDERED_MARKER_SOURCE} (?!${RESULT_PAIR}|${CHOICE_PREFIX}|\\[${MARK}\\] )`),
  },
  checklist: { add: "- [ ] ", test: new RegExp(`^- \\[${MARK}\\] `) },
};

export function blockToggleActive(line: string, kind: BlockToggle): boolean {
  const rest = line.replace(/^\s*/, "");
  if (parseResultLine(rest) || parseChoiceControlLine(rest) || parseToggleLine(rest)) return false;
  return BLOCK_RULES[kind].test.test(rest);
}

/** Toggle a block prefix AFTER any leading indent — a Tab-nested "  - child"
 * toggles its own marker in place; the indent always survives. */
export function applyBlockToggle(line: string, kind: BlockToggle): PrefixEdit {
  const indent = /^\s*/.exec(line)?.[0] ?? "";
  const rest = line.slice(indent.length);
  const rule = BLOCK_RULES[kind];
  const result = parseResultLine(rest);
  const choiceControl = parseChoiceControlLine(rest);
  const toggle = parseToggleLine(rest);
  const on = result || choiceControl || toggle ? null : rule.test.exec(rest);
  if (on) {
    const next = indent + rest.slice(on[0].length);
    return { line: next, delta: -on[0].length };
  }
  const stripped = result?.text ?? choiceControl?.text ?? toggle?.text ?? rest.replace(ANY_BLOCK_PREFIX, "");
  const next = indent + rule.add + stripped;
  return { line: next, delta: next.length - line.length };
}

/** The multi-line selection policy (the format bar over N lines): if every
 * non-blank line already carries the marker, toggle them all OFF; otherwise
 * turn the missing ones ON and leave marked lines untouched. Blank lines never
 * gain a marker. Returns one replacement per input line — null = untouched. */
export function applyBlockToggleAll(lines: string[], kind: BlockToggle): (string | null)[] {
  const targets = lines.filter((t) => t.trim() !== "");
  const allOn = targets.length > 0 && targets.every((t) => blockToggleActive(t, kind));
  return lines.map((t) => {
    if (t.trim() === "") return null;
    if (!allOn && blockToggleActive(t, kind)) return null;
    return applyBlockToggle(t, kind).line;
  });
}
