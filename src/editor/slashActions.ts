import { applyBlockToggle, applyHeading } from "./commands";
import type { SlashOp, SlashPickerMode } from "./slashMenu";
import { cellSpansOf, insertTableText } from "./tables";

export interface SlashInsertion {
  insert: string;
  caret: number;
}

/** Canonical scaffold for every immediate slash command. Picker commands need
 * a target first and intentionally return null. */
export function slashInsertion(op: SlashOp): SlashInsertion | null {
  if (op.kind === "picker") return null;
  if (op.kind === "code") return { insert: "``", caret: 1 };
  if (op.kind === "table") {
    const insert = insertTableText(3, 2);
    return { insert, caret: cellSpansOf(insert.split("\n")[0] ?? "")[0]?.start ?? 2 };
  }
  if (op.kind === "divider") {
    const insert = "---\n\n";
    return { insert, caret: insert.length };
  }
  if (op.kind === "fence") {
    const insert = `\`\`\`${op.lang}\n\n\`\`\``;
    return { insert, caret: 4 + op.lang.length };
  }
  if (op.kind === "heading") {
    const result = applyHeading("", op.level);
    return { insert: result.line, caret: result.line.length };
  }
  const result = applyBlockToggle("", op.block);
  return { insert: result.line, caret: result.line.length };
}

export function pickerFence(mode: Exclude<SlashPickerMode, "linkNote">, fileId: string): string {
  const lang =
    mode === "embedBoard" ? "board" : mode === "embedSheet" ? "sheet" : "document";
  return `\`\`\`${lang}\n${fileId}\n\`\`\`\n\n`;
}
