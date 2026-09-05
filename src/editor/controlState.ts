// Portable choice and toggle grammar. The file remains readable in any plain
// Markdown editor; Rotli only supplies a richer render and source-safe writes.

import { resultOptionOf, type ResultOption } from "./resultState";

export type ChoiceControlKind = "radio" | "multi";

const CONTROL_LITERAL = /^(?:\[(?:[ /xX]|#{1,2}[xX]?|##\?)?\]|\[[^\r\n]*(?:\]\[|\|)[^\r\n]*\])$/;

export function isControlLiteral(value: string): boolean {
  return CONTROL_LITERAL.test(value);
}

export interface ChoiceControlLine {
  kind: ChoiceControlKind;
  indent: number;
  indentSource: string;
  marker: string;
  selected: boolean;
  prefixLen: number;
  text: string;
}

export interface ChoicePromptLine {
  indent: number;
  indentSource: string;
  marker: string;
  prefixLen: number;
  text: string;
}

export interface ControlEdit {
  index: number;
  line: string;
}

/** An optional heading for the immediately following `[##]` answer rows. */
export function parseChoicePromptLine(line: string): ChoicePromptLine | null {
  const match = /^(\s*)((?:-|\d+\.) )\[##\?\] (.*)$/.exec(line);
  if (!match) return null;
  return {
    indent: (match[1] ?? "").replace(/\t/g, "  ").length,
    indentSource: match[1] ?? "",
    marker: match[2] ?? "- ",
    prefixLen: match[0].length - (match[3] ?? "").length,
    text: match[3] ?? "",
  };
}

export function parseChoiceControlLine(line: string): ChoiceControlLine | null {
  const match = /^(\s*)((?:-|\d+\.) )\[(#{1,2})([xX]?)\] (.*)$/.exec(line);
  if (!match) return null;
  return {
    kind: match[3] === "#" ? "radio" : "multi",
    indent: (match[1] ?? "").replace(/\t/g, "  ").length,
    indentSource: match[1] ?? "",
    marker: match[2] ?? "- ",
    selected: (match[4] ?? "").toLowerCase() === "x",
    prefixLen: match[0].length - (match[5] ?? "").length,
    text: match[5] ?? "",
  };
}

export function setChoiceControlSelected(line: string, selected: boolean): string | null {
  const parsed = parseChoiceControlLine(line);
  if (!parsed) return null;
  const hashes = parsed.kind === "radio" ? "#" : "##";
  return `${parsed.indentSource}${parsed.marker}[${hashes}${selected ? "x" : ""}] ${parsed.text}`;
}

/** Select one adjacent, same-indent `[#]` option and clear its siblings. */
export function selectChoiceControlGroup(
  lines: readonly string[],
  targetIndex: number,
): ControlEdit[] | null {
  const target = lines[targetIndex] === undefined ? null : parseChoiceControlLine(lines[targetIndex] ?? "");
  if (!target || target.kind !== "radio") return null;
  let start = targetIndex;
  while (start > 0) {
    const previous = parseChoiceControlLine(lines[start - 1] ?? "");
    if (previous?.kind !== "radio" || previous.indent !== target.indent) break;
    start--;
  }
  let end = targetIndex;
  while (end + 1 < lines.length) {
    const next = parseChoiceControlLine(lines[end + 1] ?? "");
    if (next?.kind !== "radio" || next.indent !== target.indent) break;
    end++;
  }
  const edits: ControlEdit[] = [];
  for (let index = start; index <= end; index++) {
    const line = lines[index] ?? "";
    const next = setChoiceControlSelected(line, index === targetIndex);
    if (next !== null && next !== line) edits.push({ index, line: next });
  }
  return edits;
}

export interface ToggleLine {
  indentSource: string;
  marker: string;
  prefixLen: number;
  text: string;
  compact: boolean;
  on: boolean;
  options: [ResultOption, ResultOption];
  labels: [string, string];
}

export function parseToggleLine(line: string): ToggleLine | null {
  const match = /^(\s*)((?:-|\d+\.) )\[([^\]]*\|[^\]]*)\] (.*)$/.exec(line);
  if (!match) return null;
  const body = match[3] ?? "";
  if (body.indexOf("|") !== body.lastIndexOf("|")) return null;
  const [leftBody = "", rightBody = ""] = body.split("|");
  const compact = /^[xX]?$/.test(leftBody) && /^[xX]?$/.test(rightBody);
  let options: [ResultOption, ResultOption];
  if (compact) {
    const left = leftBody.toLowerCase() === "x";
    const right = rightBody.toLowerCase() === "x";
    if (left && right) return null;
    options = [
      { label: "On", selected: left, color: "green", source: "" },
      { label: "Off", selected: right || !left, color: "red", source: "" },
    ];
  } else {
    const left = resultOptionOf(leftBody, "On");
    const right = resultOptionOf(rightBody, "Off");
    if (!left || !right || (left.selected && right.selected)) return null;
    options = [left, { ...right, selected: right.selected || !left.selected }];
  }
  return {
    indentSource: match[1] ?? "",
    marker: match[2] ?? "- ",
    prefixLen: match[0].length - (match[4] ?? "").length,
    text: match[4] ?? "",
    compact,
    on: options[0].selected,
    options,
    labels: [options[0].label, options[1].label],
  };
}

export function setToggleOn(line: string, on: boolean): string | null {
  const parsed = parseToggleLine(line);
  if (!parsed) return null;
  const body = parsed.compact
    ? on
      ? "x|"
      : "|x"
    : `${on ? "x " : ""}${parsed.options[0].source}|${on ? "" : "x "}${parsed.options[1].source}`;
  return `${parsed.indentSource}${parsed.marker}[${body}] ${parsed.text}`;
}
