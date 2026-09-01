// The two-choice result grammar — ONE definition of Rotli's compact yes/no
// control. The Markdown stays portable and legible outside Rotli:
//
//   - [ ][ ] unanswered
//   - [x][ ] yes / passed  (left check)
//   - [ ][x] no / failed   (right X)
//
// The two boxes are mutually exclusive. A hand-edited `[x][x]` line is
// deliberately invalid and renders as ordinary Markdown instead of silently
// choosing a winner.
//
// Pure: no CodeMirror, DOM, or store.

export const RESULT_MARK = "[ xX]";

export type ResultState = "unanswered" | "no" | "yes";
export type ResultChoice = Exclude<ResultState, "unanswered">;
export const RESULT_REASON_SEPARATOR = " — ";

export interface ResultTextParts {
  label: string;
  reason: string | null;
}

/** Plain `- [ ][ ] case`. Captures the yes mark, then the no mark. */
export const RESULT_RE = new RegExp(`^- \\[(${RESULT_MARK})\\]\\[(${RESULT_MARK})\\] `);

/** Ordered `1. [ ][ ] case`. Captures the number, yes mark, then no mark. */
export const ORDERED_RESULT_RE = new RegExp(`^(\\d+)\\. \\[(${RESULT_MARK})\\]\\[(${RESULT_MARK})\\] `);

/** A whole result prefix. Captures indent, list marker, yes mark, and no mark. */
export const RESULT_LINE_RE = new RegExp(
  `^(\\s*)((?:-|\\d+\\.) )\\[(${RESULT_MARK})\\]\\[(${RESULT_MARK})\\] `,
);

/** Read an exclusive pair. Both selected is malformed and fails closed. */
export function resultStateOf(yesMark: string, noMark: string): ResultState | null {
  const yes = yesMark.toLowerCase() === "x";
  const no = noMark.toLowerCase() === "x";
  if (no && yes) return null;
  if (no) return "no";
  return yes ? "yes" : "unanswered";
}

/** Rewrite only a valid result row, preserving its indent, list marker, and text. */
export function chooseResult(line: string, choice: ResultChoice): string | null {
  const match = RESULT_LINE_RE.exec(line);
  if (!match || resultStateOf(match[3] ?? " ", match[4] ?? " ") === null) return null;
  const marks = choice === "yes" ? "[x][ ]" : "[ ][x]";
  return `${match[1] ?? ""}${match[2] ?? "- "}${marks} ${line.slice(match[0].length)}`;
}

/** Split an optional human explanation without adding metadata or a sidecar. */
export function resultTextParts(text: string): ResultTextParts {
  const at = text.indexOf(RESULT_REASON_SEPARATOR);
  if (at < 0) return { label: text, reason: null };
  return {
    label: text.slice(0, at),
    reason: text.slice(at + RESULT_REASON_SEPARATOR.length),
  };
}

/** A compact read-only marker for Quick Look and brief readers. */
export function resultGlyph(state: ResultState): string {
  if (state === "no") return "×";
  return state === "yes" ? "✓" : "×/✓";
}
