// Portable single-choice list grammar:
//
//   - ( ) Red
//   - (x) Blue
//   - ( ) Green
//
// Adjacent choice rows at the same indent form one exclusive group. A blank,
// prose row, heading, or different indent ends the group. The source remains
// readable in any Markdown editor and does not collide with checkbox tasks.
//
// Pure: no CodeMirror, DOM, or store.

export const CHOICE_MARK = "[ xX]";

export const CHOICE_RE = new RegExp(`^- \\((${CHOICE_MARK})\\) `);
export const ORDERED_CHOICE_RE = new RegExp(`^(\\d+)\\. \\((${CHOICE_MARK})\\) `);
export const CHOICE_LINE_RE = new RegExp(`^(\\s*)((?:-|\\d+\\.) )\\((${CHOICE_MARK})\\) `);

export interface ChoiceLine {
  indent: number;
  selected: boolean;
  prefixLen: number;
}

export interface ChoiceEdit {
  index: number;
  line: string;
}

export function choiceLineOf(line: string): ChoiceLine | null {
  const match = CHOICE_LINE_RE.exec(line);
  if (!match) return null;
  return {
    indent: (match[1] ?? "").replace(/\t/g, "  ").length,
    selected: (match[3] ?? " ").toLowerCase() === "x",
    prefixLen: match[0].length,
  };
}

export function setChoiceSelected(line: string, selected: boolean): string | null {
  const match = CHOICE_LINE_RE.exec(line);
  if (!match) return null;
  return `${match[1] ?? ""}${match[2] ?? "- "}(${selected ? "x" : " "}) ${line.slice(match[0].length)}`;
}

export function choiceGlyph(selected: boolean): "●" | "○" {
  return selected ? "●" : "○";
}

/** Select one option and clear every adjacent same-indent sibling. */
export function selectChoiceGroup(lines: readonly string[], targetIndex: number): ChoiceEdit[] | null {
  const target = lines[targetIndex];
  const targetChoice = target === undefined ? null : choiceLineOf(target);
  if (!targetChoice) return null;

  let start = targetIndex;
  while (start > 0 && choiceLineOf(lines[start - 1] ?? "")?.indent === targetChoice.indent) start--;
  let end = targetIndex;
  while (end + 1 < lines.length && choiceLineOf(lines[end + 1] ?? "")?.indent === targetChoice.indent) end++;

  const edits: ChoiceEdit[] = [];
  for (let index = start; index <= end; index++) {
    const line = lines[index] ?? "";
    const next = setChoiceSelected(line, index === targetIndex);
    if (next !== null && next !== line) edits.push({ index, line: next });
  }
  return edits;
}
