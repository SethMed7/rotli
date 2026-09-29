// Bold (and strike, highlight, underline) over a selection that is only partly
// marked (a reader's report, 2026-09-28): bold "hello", type " okay world"
// after it, select the whole line, ⌘B → `****hello** okay world**`. The old
// toggle saw a selection that started with `**` but did not end with it and
// wrapped it again.
//
// Here a line is read as characters that are marked or not, the way a word
// processor sees it: a selection that is all marked loses the mark (only that
// part — a bold span is split around it); anything else becomes marked as one
// span, absorbing the marks inside and beside it. Then the delimiters are
// written back, so an empty `****` left in the line is cleaned up too. Pure.

export interface RunMark {
  open: string;
  close: string;
}

interface Parsed {
  /** The line's characters without this mark's delimiters. */
  text: string;
  marked: boolean[];
  /** For each original column, the text index it lands on. */
  toText: number[];
}

/** Where the mark's delimiters are. Bold reads runs of `*`: a run of two or
 * three holds one `**` (a third star is italic, kept as text); a run of four
 * or more is `**` twice — a close and an open, or an empty pair. */
function parse(line: string, mark: RunMark): Parsed {
  const isDelimiter: boolean[] = Array.from({ length: line.length }, () => false);
  const inside: boolean[] = Array.from({ length: line.length }, () => false);
  const stars = mark.open === "**";
  let opener: [number, number] | null = null; // [delimiter start, content start]
  const close = (at: number, len: number) => {
    const [from, content] = opener!;
    for (let i = from; i < content; i++) isDelimiter[i] = true;
    for (let i = at; i < at + len; i++) isDelimiter[i] = true;
    for (let i = content; i < at; i++) inside[i] = true;
    opener = null;
  };
  for (let i = 0; i < line.length;) {
    if (stars) {
      if (line[i] !== "*") {
        i++;
        continue;
      }
      let n = 0;
      while (line[i + n] === "*") n++;
      if (n >= 4 && opener) {
        close(i, 2); // `a****b`: a closes, b opens
        opener = [i + n - 2, i + n];
      } else if (n >= 4) {
        // an empty pair (the `****` an old toggle left): both halves go
        for (const k of [i, i + 1, i + n - 2, i + n - 1]) isDelimiter[k] = true;
      } else if (n >= 2) {
        if (opener) close(i + n - 2, 2);
        else opener = [i, i + 2];
      }
      i += n;
      continue;
    }
    if (!opener && line.startsWith(mark.open, i)) {
      opener = [i, i + mark.open.length];
      i += mark.open.length;
    } else if (opener && line.startsWith(mark.close, i)) {
      close(i, mark.close.length);
      i += mark.close.length;
    } else i++;
  }
  // an opener that never closed stays text (its delimiters were never marked)
  let text = "";
  const marked: boolean[] = [];
  const toText: number[] = [];
  for (let i = 0; i < line.length; i++) {
    toText.push(text.length);
    if (isDelimiter[i]) continue;
    text += line[i];
    marked.push(inside[i] ?? false);
  }
  toText.push(text.length);
  return { text, marked, toText };
}

const MARKUP = ["</u>", "<u>", "*", "~", "=", "`"];

/** The width of another mark's delimiter ending at / starting at `at`. */
function markupBefore(text: string, at: number): number {
  return (
    MARKUP.find((token) => at >= token.length && text.slice(at - token.length, at) === token)?.length ?? 0
  );
}
function markupAfter(text: string, at: number): number {
  return MARKUP.find((token) => text.startsWith(token, at))?.length ?? 0;
}

/** Whether the text between two columns is all marked, partly, or not. */
export function markCoverage(line: string, a: number, b: number, mark: RunMark): "all" | "some" | "none" {
  const { marked, toText } = parse(line, mark);
  const slice = marked.slice(toText[a], toText[b]);
  if (slice.length === 0) return "none";
  if (slice.every(Boolean)) return "all";
  return slice.some(Boolean) ? "some" : "none";
}

/** Flip the mark over columns [a, b): all marked → unmarked, otherwise
 * marked. Returns the new line and the selection over the same text. */
export function toggleMarkRun(
  line: string,
  a: number,
  b: number,
  mark: RunMark,
): { line: string; selStart: number; selEnd: number } {
  const { text, marked, toText } = parse(line, mark);
  let ta = toText[a] ?? 0;
  let tb = toText[b] ?? text.length;
  const next = [...marked];
  const on = !(tb > ta && marked.slice(ta, tb).every(Boolean));
  // the selection stays on what was picked, whatever the mark covers
  const [pickStart, pickEnd] = [ta, tb];
  if (!on) {
    // other marks' delimiters beside the text (`***x***`, `**==<u>x</u>==**`)
    // are markup, not content: the mark comes off around them too
    for (let width = markupBefore(text, ta); width > 0 && marked[ta - 1]; width = markupBefore(text, ta)) {
      ta -= width;
    }
    for (let width = markupAfter(text, tb); width > 0 && marked[tb]; width = markupAfter(text, tb))
      tb += width;
  }
  for (let i = ta; i < tb; i++) next[i] = on;
  // a span never starts or ends on a space (`** x**` isn't bold in Markdown)
  const runs: [number, number][] = [];
  for (let i = 0; i < text.length;) {
    if (!next[i]) {
      i++;
      continue;
    }
    let end = i;
    while (end < text.length && next[end]) end++;
    let s = i;
    let e = end;
    while (s < e && /\s/.test(text[s] ?? "")) s++;
    while (e > s && /\s/.test(text[e - 1] ?? "")) e--;
    if (e > s) runs.push([s, e]);
    i = end;
  }
  let out = "";
  let selStart = 0;
  let selEnd = 0;
  let r = 0;
  for (let i = 0; i <= text.length; i++) {
    const run = runs[r];
    if (run && i === run[1]) {
      if (i === pickEnd) selEnd = out.length; // the selection ends inside the mark
      out += mark.close;
      r++;
    }
    const nextRun = runs[r];
    if (i === pickStart) selStart = out.length + (nextRun && i === nextRun[0] ? mark.open.length : 0);
    if (nextRun && i === nextRun[0]) out += mark.open;
    if (i === pickEnd && !(run && i === run[1])) selEnd = out.length;
    if (i < text.length) out += text[i];
  }
  return { line: out, selStart, selEnd: Math.max(selStart, selEnd) };
}
