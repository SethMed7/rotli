import { applyBlockToggle, applyHeading } from "./commands";
import type { SlashOp, SlashPickerMode } from "./slashMenu";
import { cellSpansOf, insertTableText } from "./tables";

export interface SlashInsertion {
  insert: string;
  caret: number;
}

export const MERMAID_STARTER = `flowchart LR
  Start[Start] --> Next[Next step]`;

/** Canonical scaffold for every immediate slash command. Picker commands — and
 * image attachment/generation — which open a picker/popover first —
 * intentionally return null. */
export function slashInsertion(op: SlashOp): SlashInsertion | null {
  if (op.kind === "picker" || op.kind === "attachImage" || op.kind === "imageGen") return null;
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
    if (op.lang === "mermaid") {
      const insert = `\`\`\`mermaid\n${MERMAID_STARTER}\n\`\`\``;
      return { insert, caret: insert.indexOf("Start]") };
    }
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

export function pickerFence(
  mode: Exclude<SlashPickerMode, "linkNote" | "insertTemplate">,
  fileId: string,
): string {
  const lang = mode === "embedBoard" ? "board" : mode === "embedSheet" ? "sheet" : "document";
  return `\`\`\`${lang}\n${fileId}\n\`\`\`\n\n`;
}

/** What `/template` inserts from a template note's body. Into an EMPTY note it
 * comes whole: its leading `# Heading` becomes the new note's title, which is
 * the point of starting from a template. Into a note that already has content
 * that leading H1 is the TEMPLATE's name, not content — a note's first H1 is
 * its title, so carrying it in could retitle and rename the host. Bodies
 * arrive frontmatter-free from every adapter; a stray leading fence is skipped
 * anyway, because frontmatter is Rotli's to own. */
export function templateInsertion(body: string, hostIsEmpty: boolean): string {
  let text = body.replace(/^\uFEFF?---\n[\s\S]*?\n---\n?/, "");
  if (!hostIsEmpty) text = text.replace(/^\s*# [^\n]*(?:\n|$)/, "");
  return text.trim();
}
