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
export type ResultColor =
  | "accent"
  | "blue"
  | "green"
  | "yellow"
  | "purple"
  | "red"
  | "neutral"
  | `#${string}`;
export const RESULT_REASON_SEPARATOR = " — ";

export interface ResultOption {
  /** Human-readable button text. Compact results use Yes/No for accessibility. */
  label: string;
  selected: boolean;
  /** Null means the current theme accent for labeled controls. */
  color: ResultColor | null;
  /** The exact portable option body without a leading `x ` selection marker. */
  source: string;
}

export interface ParsedResultLine {
  indent: string;
  /** Source list marker including its trailing space (`- ` or `3. `). */
  marker: string;
  prefixLen: number;
  text: string;
  compact: boolean;
  options: ResultOption[];
}

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

const RESULT_COLOR_NAMES = new Set<ResultColor>([
  "accent",
  "blue",
  "green",
  "yellow",
  "purple",
  "red",
  "neutral",
]);
const RESULT_HEX_RE = /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i;

export function resultOptionOf(body: string, fallbackLabel?: string): ResultOption | null {
  const trimmed = body.trim();
  const selectedMatch = /^x\s+(.+)$/.exec(trimmed);
  const source = (selectedMatch?.[1] ?? trimmed).trim();
  if (!source) return null;

  let label = source;
  let color: ResultColor | null = null;
  const colon = source.lastIndexOf(":");
  if (colon >= 0) {
    const suffix = source.slice(colon + 1).trim();
    const normalized = suffix.toLowerCase();
    if (RESULT_HEX_RE.test(suffix)) color = suffix as ResultColor;
    else if (RESULT_COLOR_NAMES.has(normalized as ResultColor)) color = normalized as ResultColor;
    else return null;
    label = source.slice(0, colon).trim();
  }
  if (!label) {
    if (!fallbackLabel || color === null) return null;
    label = fallbackLabel;
  }
  return { label: label.replace(/^\\(?=[xX]\s)/, ""), selected: selectedMatch !== null, color, source };
}

/** Parse the whole portable result prefix. Labeled options are adjacent boxes:
 * `[True][False]` or labels with semantic/custom color suffixes. Invalid color
 * syntax and multiple selections fail closed, leaving ordinary Markdown. */
export function parseResultLine(line: string): ParsedResultLine | null {
  const lead = /^(\s*)((?:-|\d+\.) )/.exec(line);
  if (!lead) return null;
  let at = lead[0].length;
  const bodies: string[] = [];
  while (line[at] === "[") {
    const close = line.indexOf("]", at + 1);
    if (close < 0) return null;
    bodies.push(line.slice(at + 1, close));
    at = close + 1;
  }
  if (bodies.length < 2 || line[at] !== " ") return null;

  const compact = bodies.length === 2 && bodies.every((body) => /^[ xX]$/.test(body));
  let options: ResultOption[];
  if (compact) {
    const state = resultStateOf(bodies[0] ?? " ", bodies[1] ?? " ");
    if (state === null) return null;
    options = [
      { label: "Yes", selected: state === "yes", color: "green", source: "" },
      { label: "No", selected: state === "no", color: "red", source: "" },
    ];
  } else {
    const parsed = bodies.map((body) => resultOptionOf(body));
    if (parsed.some((option) => option === null)) return null;
    options = parsed as ResultOption[];
    if (options.filter((option) => option.selected).length > 1) return null;
    if (options.length === 2) {
      options = options.map((option, index) => ({
        ...option,
        color: option.color ?? (index === 0 ? "green" : "red"),
      }));
    }
  }

  return {
    indent: lead[1] ?? "",
    marker: lead[2] ?? "- ",
    prefixLen: at + 1,
    text: line.slice(at + 1),
    compact,
    options,
  };
}

/** Rewrite only a valid result row, preserving its indent, list marker, and text. */
export function chooseResult(line: string, choice: ResultChoice | number): string | null {
  const parsed = parseResultLine(line);
  if (!parsed) return null;
  const index = typeof choice === "number" ? choice : choice === "yes" ? 0 : 1;
  if (index < 0 || index >= parsed.options.length) return null;
  const boxes = parsed.compact
    ? index === 0
      ? "[x][ ]"
      : "[ ][x]"
    : parsed.options
        .map((option, optionIndex) => `[${optionIndex === index ? "x " : ""}${option.source}]`)
        .join("");
  return `${parsed.indent}${parsed.marker}${boxes} ${parsed.text}`;
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
