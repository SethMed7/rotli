// The slash menu's catalog (split from slashMenu.tsx, 2026-10-05): every item's
// glyph, label, group, hint, structured op, and search keywords, in menu order.
// slashMenu.tsx owns filtering, placement, and the caret grammar.

import { DOCUMENT_SEARCH_KEYWORDS } from "../documents/kinds";
import { DATE_WORDS } from "../lib/noteDates";
import { withBetaLabel } from "../newItems/model";
import { chartGlyph } from "./chartGlyphs";
import { Gl, bulletGlyph, checklistGlyph, codeGlyph, numberedGlyph, quoteGlyph } from "./formatGlyphs";
import { ALIGN_SLASH_ITEMS } from "./slashAlign";
import type { SlashItem } from "./slashTypes";

// "H1/2/3" read as text glyphs (matches the format bar's H affordance voice)
function Heading({ level }: { level: 1 | 2 | 3 }) {
  return <span className="slashglyph-h">{`H${level}`}</span>;
}

// Each item names its glyph + label and a STRUCTURED op the editor applies to
// the cleared line: headings/blocks reuse the canonical line transforms, "code"
// stays the inline-backticks primitive, and the multi-line kinds (table /
// divider / fences) insert their scaffold with the caret placed inside
// (CmEditor's pickSlash owns the caret math).

// a minimal grid mark for Table + a thin rule for Divider (the shared Gl voice)
const tableGlyph = (
  <Gl>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 9.5h18M9.5 9.5V20M15.5 9.5V20" />
  </Gl>
);
const dividerGlyph = (
  <Gl>
    <path d="M3 12h18" />
    <path d="M7 5h10M7 19h10" opacity="0.35" />
  </Gl>
);
const mathGlyph = <span className="slashglyph-h">∑</span>;
const mermaidGlyph = (
  <svg
    viewBox="0 0 24 24"
    width={15}
    height={15}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="3" width="7" height="6" rx="1.5" />
    <rect x="14" y="15" width="7" height="6" rx="1.5" />
    <path d="M6.5 9v4a2 2 0 0 0 2 2h5.5" />
  </svg>
);

// a framed picture with a sun + hill — the classic image mark, in the Gl voice
const calendarGlyph = (
  <Gl>
    <rect x="4" y="5" width="16" height="15" rx="2" />
    <path d="M4 10h16M9 3v4M15 3v4" />
  </Gl>
);
// a spark: the model writes the next part
const askAiGlyph = (
  <svg
    viewBox="0 0 24 24"
    width={15}
    height={15}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.5 6.5l2.5 2.5M15 15l2.5 2.5M17.5 6.5 15 9M9 15l-2.5 2.5" />
  </svg>
);

const imageGenGlyph = (
  <svg
    viewBox="0 0 24 24"
    width={15}
    height={15}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="M21 15.5 16.5 11 7 20" />
  </svg>
);
// a page with its layout already ruled in: a heading bar, then two blocks
const templateGlyph = (
  <svg
    viewBox="0 0 24 24"
    width={15}
    height={15}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <path d="M8 8h8M8 12.5h3.5v4.5H8zM14.5 12.5H16M14.5 17H16" />
  </svg>
);

// a speech bubble — the chat the link points at
const chatLinkGlyph = (
  <svg
    viewBox="0 0 24 24"
    width={15}
    height={15}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M5 5h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-4 3.5V7a2 2 0 0 1 2-2Z" />
  </svg>
);

const linkGlyph = (
  <svg
    viewBox="0 0 24 24"
    width={15}
    height={15}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);
const boardGlyph = (
  <svg
    viewBox="0 0 24 24"
    width={15}
    height={15}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M8 12h8M12 8v8" opacity="0.45" />
  </svg>
);
const sheetGlyph = (
  <svg
    viewBox="0 0 24 24"
    width={15}
    height={15}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 9.5h18M9.5 9.5V20M15.5 9.5V20" />
  </svg>
);
const documentGlyph = (
  <svg
    viewBox="0 0 24 24"
    width={15}
    height={15}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M6 3h8l4 4v14H6z" />
    <path d="M14 3v5h5M9 12h6M9 16h6" />
  </svg>
);

export const SLASH_ITEMS: SlashItem[] = [
  {
    label: "Heading 1",
    group: "Text",
    hint: "Big section heading",
    glyph: <Heading level={1} />,
    op: { kind: "heading", level: 1 },
  },
  {
    label: "Heading 2",
    group: "Text",
    hint: "Medium heading",
    glyph: <Heading level={2} />,
    op: { kind: "heading", level: 2 },
  },
  {
    label: "Heading 3",
    group: "Text",
    hint: "Small heading",
    glyph: <Heading level={3} />,
    op: { kind: "heading", level: 3 },
  },
  {
    label: "Quote",
    group: "Text",
    hint: "Pulled-aside passage",
    glyph: quoteGlyph,
    op: { kind: "block", block: "quote" },
  },
  ...ALIGN_SLASH_ITEMS,
  {
    label: "Bullet",
    group: "List",
    hint: "Plain bulleted list",
    glyph: bulletGlyph,
    op: { kind: "block", block: "bullet" },
  },
  {
    label: "Numbered",
    group: "List",
    hint: "Ordered list",
    glyph: numberedGlyph,
    op: { kind: "block", block: "numbered" },
  },
  {
    label: "Checklist",
    group: "List",
    hint: "Tasks with checkboxes",
    glyph: checklistGlyph,
    op: { kind: "block", block: "checklist" },
  },
  {
    label: "Table",
    group: "Insert",
    hint: "3×2 grid, Tab hops cells",
    glyph: tableGlyph,
    op: { kind: "table" },
  },
  {
    label: "Divider",
    group: "Insert",
    hint: "Horizontal rule",
    glyph: dividerGlyph,
    op: { kind: "divider" },
  },
  {
    label: "Code block",
    group: "Insert",
    hint: "Fenced code",
    glyph: codeGlyph,
    op: { kind: "fence", lang: "" },
  },
  {
    label: "Inline code",
    group: "Insert",
    hint: "Code inside a sentence",
    glyph: codeGlyph,
    op: { kind: "code" },
  },
  {
    label: "Math",
    group: "Insert",
    hint: "KaTeX block",
    glyph: mathGlyph,
    op: { kind: "fence", lang: "math" },
  },
  {
    label: "Mermaid",
    group: "Insert",
    hint: "Interactive diagram",
    glyph: mermaidGlyph,
    op: { kind: "fence", lang: "mermaid" },
    keywords: ["diagram", "flowchart", "graph"],
  },
  {
    label: "Chart",
    group: "Insert",
    hint: "Choose from ten kinds",
    glyph: chartGlyph("bar"),
    op: { kind: "chart" },
    keywords: [
      "chart",
      "graph",
      "plot",
      "bar",
      "line",
      "area",
      "pie",
      "donut",
      "scatter",
      "radar",
      "heatmap",
    ],
  },
  {
    label: "Attach image",
    group: "Insert",
    hint: "Choose an image from Finder",
    glyph: imageGenGlyph,
    op: { kind: "attachImage" },
    // Keep the user's requested spelling executable while also supporting the
    // conventional spelling in search.
    keywords: ["attatch", "attach", "image", "picture", "photo", "finder", "upload"],
  },
  {
    label: "Ask AI",
    group: "Insert",
    hint: "Writes the next part from your request",
    glyph: askAiGlyph,
    op: { kind: "ai" },
    keywords: ["ai", "ask", "write", "sources", "chart", "draft"],
  },
  {
    label: "Generate image",
    group: "Insert",
    hint: "AI image from a prompt, saved to your assets",
    glyph: imageGenGlyph,
    op: { kind: "imageGen" },
    keywords: ["image-gen", "imagegen", "image", "ai", "picture", "photo", "generate"],
  },
  {
    label: "Talk to the Librarian",
    group: "Insert",
    hint: "Tag, mark a passage, or file this note",
    glyph: imageGenGlyph,
    op: { kind: "librarian" },
    keywords: ["librarian", "tag", "file", "organize", "mark", "ai"],
  },
  {
    label: "Hand to AI",
    group: "Insert",
    hint: "This note as a prompt for Claude Code or another agent",
    glyph: imageGenGlyph,
    op: { kind: "handToAi" },
    keywords: ["hand", "send to ai", "agent", "prompt", "claude"],
  },
  {
    label: "Template",
    group: "Insert",
    hint: "Insert a saved note layout",
    glyph: templateGlyph,
    op: { kind: "picker", mode: "insertTemplate" },
    keywords: ["template", "layout", "snippet", "boilerplate", "meeting"],
  },
  {
    label: "Link note",
    group: "Link",
    hint: "Wikilink to another note",
    glyph: linkGlyph,
    op: { kind: "picker", mode: "linkNote" },
    keywords: ["note", "wiki", "link"],
  },
  {
    label: "Link chat",
    group: "Link",
    hint: "Wikilink to one of your chats",
    glyph: chatLinkGlyph,
    op: { kind: "picker", mode: "linkChat" },
    keywords: ["chat", "conversation", "link", "wiki"],
  },
  {
    label: "Board",
    group: "Insert",
    hint: "Embed Excalidraw",
    glyph: boardGlyph,
    op: { kind: "picker", mode: "embedBoard" },
    keywords: ["excalidraw", "canvas", "draw"],
  },
  {
    label: "Sheet",
    group: "Insert",
    hint: withBetaLabel("Embed spreadsheet", "sheet"),
    glyph: sheetGlyph,
    op: { kind: "picker", mode: "embedSheet" },
    keywords: ["xlsx", "csv", "spreadsheet", "excel"],
  },
  {
    label: "Document",
    group: "Insert",
    hint: withBetaLabel("Create or embed editable DOCX", "document"),
    glyph: documentGlyph,
    op: { kind: "picker", mode: "embedDocument" },
    keywords: [...DOCUMENT_SEARCH_KEYWORDS],
  },
  // dates (2026-09-29): the date itself, or a {{placeholder}} in a template
  ...DATE_WORDS.map((word): SlashItem => ({
    label: word[0]!.toUpperCase() + word.slice(1),
    group: "Date",
    hint:
      word === "today"
        ? "Today's date; in a template, the day it's used"
        : `${word[0]!.toUpperCase() + word.slice(1)}'s date`,
    glyph: calendarGlyph,
    op: { kind: "date", word },
    keywords: ["date", "day", word],
  })),
  {
    label: "Continue a project list",
    group: "Function",
    hint: "Link a project's task note, or start its next one when it's all done",
    glyph: calendarGlyph,
    op: { kind: "picker", mode: "continueList" },
    keywords: ["function", "project", "todo", "tasks", "next", "continue", "round"],
  },
];
