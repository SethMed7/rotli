// Auto-pairing while typing, as a pure edit rule. Typing an opener inserts its
// closer with the caret between; typing a closer that is already there steps
// over it instead of doubling it. Pairs:
//   `[` → `[]` (so `[[` → `[[]]`), `(` → `()`, a backtick → two backticks,
//   and the second char of `**`, `==`, `~~` → `****`, `====`, `~~~~`.
// Never paired: `_` (snake_case) and a single `*` (a line-start `*` is a
// bullet). Inside a backtick span nothing pairs. A third delimiter typed into
// an empty pair (`**|**` + `*`) collapses to `***`, so rules and fences still
// type naturally. A delimiter pair glued to a word (`2**3`) never pairs. Fenced code is skipped by the caller (autoPairInput.ts).

export interface AutoPairEdit {
  /** Text inserted at the caret. */
  insert: string;
  /** Characters after the caret that `insert` replaces (the stepped-over closer). */
  replace: number;
  /** Where the caret lands, relative to the caret before the edit. */
  cursorOffset: number;
}

const CLOSERS: Record<string, string> = { "[": "]", "(": ")" };
const OPENERS: Record<string, string> = { "]": "[", ")": "(" };
const DOUBLE_DELIMITERS = new Set(["*", "=", "~"]);

/** A closer only appears when nothing is glued to the caret's right. */
const roomAfter = (next: string): boolean => next === "" || /[\s)\]}:;>]/.test(next);

const count = (text: string, token: string): number => text.split(token).length - 1;

/** Backticks before the caret come in pairs unless the caret is inside a span. */
const inCodeSpan = (before: string): boolean => count(before, "`") % 2 === 1;

export function autoPairEdit(
  lineText: string,
  caretCol: number,
  typedChar: string,
  nextChar: string,
): AutoPairEdit | null {
  const before = lineText.slice(0, caretCol);
  const after = lineText.slice(caretCol);
  const prev = before.slice(-1);

  if (typedChar === "`") {
    if (nextChar === "`" && inCodeSpan(before)) return { insert: "`", replace: 1, cursorOffset: 1 };
    if (prev === "`" || inCodeSpan(before) || !roomAfter(nextChar)) return null;
    return { insert: "``", replace: 0, cursorOffset: 1 };
  }
  if (inCodeSpan(before)) return null;

  const opener = OPENERS[typedChar];
  if (opener !== undefined) {
    const unclosed = count(before, opener) > count(before, typedChar);
    return nextChar === typedChar && unclosed ? { insert: typedChar, replace: 1, cursorOffset: 1 } : null;
  }
  const closer = CLOSERS[typedChar];
  if (closer !== undefined) {
    return roomAfter(nextChar) ? { insert: typedChar + closer, replace: 0, cursorOffset: 1 } : null;
  }

  if (!DOUBLE_DELIMITERS.has(typedChar)) return null;
  const pair = typedChar + typedChar;
  // `**|**` + `*` → `***|`: a rule, a fence, or bold-italic — never `*****`
  if (before.endsWith(pair) && after.startsWith(pair) && before.slice(-3, -2) !== typedChar)
    return { insert: typedChar, replace: 2, cursorOffset: 1 };
  // a closer typed against an auto-inserted one steps over it: the line's
  // delimiter chars are balanced (even) exactly when a pair is waiting to close
  if (nextChar === typedChar && /\S/.test(prev) && count(lineText, typedChar) % 2 === 0)
    return { insert: typedChar, replace: 1, cursorOffset: 1 };
  // an opener starts a word: `2**3` and `a==b` stay as typed
  if (prev !== typedChar || !/^[\s([{"'>]?$/.test(before.slice(-2, -1)) || !roomAfter(nextChar)) return null;
  // the second delimiter char opens a pair only when it isn't closing one
  if (count(before + typedChar, pair) % 2 === 0) return null;
  return { insert: typedChar + pair, replace: 0, cursorOffset: 1 };
}
