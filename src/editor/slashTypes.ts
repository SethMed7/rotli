// The slash menu's vocabulary (split from slashMenu.tsx, 2026-09-29): which
// command an item runs, which picker it opens, and how the menu files it.

import type { ReactNode } from "react";

import type { DateWord } from "../lib/noteDates";
import type { BlockToggle } from "./commands";

export type SlashPickerMode =
  | "linkNote"
  | "linkChat"
  | "insertTemplate"
  | "embedBoard"
  | "embedSheet"
  | "embedDocument"
  /** A function: link a project list, or its next one when it's all done. */
  | "continueList";

export type SlashOp =
  | { kind: "heading"; level: 1 | 2 | 3 }
  | { kind: "block"; block: BlockToggle }
  /** Starts a centered or right-aligned paragraph (alignedLine.ts). */
  | { kind: "align"; align: "center" | "right" }
  | { kind: "code" }
  | { kind: "table" }
  | { kind: "divider" }
  | { kind: "fence"; lang: "" | "math" | "mermaid" }
  /** Opens the chart picker; the chosen kind's starter fence lands and its
   * Edit form opens (SYNTAX.md). */
  | { kind: "chart" }
  | { kind: "picker"; mode: SlashPickerMode }
  /** Opens Finder and inserts copied vault image assets at this position. */
  | { kind: "attachImage" }
  /** Opens the AI image popover (engine + prompt) — the maintainer, 2026-08-04. */
  | { kind: "imageGen" }
  /** Ask AI: a request at the cursor, the answer inserted only on Insert (2026-10-05). */
  | { kind: "ai" }
  /** Swaps the format bar for the Librarian bar (2026-09-28). */
  | { kind: "librarian" }
  /** Opens Hand to AI's prompt for this note (2026-09-28). */
  | { kind: "handToAi" }
  /** Today's, yesterday's, or tomorrow's date (2026-09-29); a `{{today}}`
   * placeholder in a template, filled in when the template is used. */
  | { kind: "date"; word: DateWord };

export interface SlashItem {
  label: string;
  /** The Crepe-style section header this item files under. */
  group: "Text" | "List" | "Insert" | "Link" | "Date" | "Function";
  /** A muted one-line description (keeps the menu self-teaching). */
  hint: string;
  glyph: ReactNode;
  op: SlashOp;
  /** Extra filter tokens (note, wiki, excalidraw, …). */
  keywords?: string[];
}
