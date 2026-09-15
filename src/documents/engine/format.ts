// The document pane's answer to Rotli's editor.* format actions. Pure: it maps
// a format intent to a Univer command id and hands it to the engine's command
// runner, so the key registry never resolves a document pane to nothing after
// its dispatcher has already claimed the chord.
//
// Inside the canvas Univer's own shortcut service also handles ⌘B/⌘I/⌘U. It
// runs first and prevents default, so the registry handle is a fallback for
// the moments Univer's hidden input is not focused, never a second toggle.

export type DocumentMark = "bold" | "italic" | "underline" | "strike" | "code" | "highlight" | "link";
export type DocumentBlock = "quote" | "bullet" | "numbered" | "checklist";

const MARK_COMMANDS: Partial<Record<DocumentMark, string>> = {
  bold: "doc.command.set-inline-format-bold",
  italic: "doc.command.set-inline-format-italic",
  underline: "doc.command.set-inline-format-underline",
  strike: "doc.command.set-inline-format-strikethrough",
};

const HEADING_COMMANDS: Record<1 | 2 | 3, string> = {
  1: "doc.command.h1-heading",
  2: "doc.command.h2-heading",
  3: "doc.command.h3-heading",
};

// Checklists are not part of the portable DOCX subset (the codec keeps only
// bullet and numbered lists), so they stay unmapped rather than silently lost.
const BLOCK_COMMANDS: Partial<Record<DocumentBlock, string>> = {
  bullet: "doc.command.bullet-list",
  numbered: "doc.command.order-list",
};

export function documentMarkCommand(mark: DocumentMark): string | null {
  return MARK_COMMANDS[mark] ?? null;
}

export function documentHeadingCommand(level: 1 | 2 | 3): string {
  return HEADING_COMMANDS[level];
}

export function documentBlockCommand(block: DocumentBlock): string | null {
  return BLOCK_COMMANDS[block] ?? null;
}

/** Markdown-only intents (code, highlight, link, quote, checklist) are no-ops. */
export function documentFormatHandle(runCommand: (id: string) => void) {
  const run = (id: string | null) => {
    if (id) runCommand(id);
  };
  return {
    toggleMark: (mark: DocumentMark) => run(documentMarkCommand(mark)),
    setHeading: (level: 1 | 2 | 3) => run(documentHeadingCommand(level)),
    toggleBlock: (block: DocumentBlock) => run(documentBlockCommand(block)),
  };
}
