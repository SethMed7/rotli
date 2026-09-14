import { describe, expect, test } from "bun:test";

import {
  emptyPasteOutcome,
  classifyPaste,
  type DropCandidate,
  firstTarget,
  planDrop,
  UNROUTED_MEDIA_NOTICE,
} from "./dropRouting";

// A fake element: enough of `closest` (class, [attr], [attr="v"] selectors,
// comma lists) to stand in for what `document.elementsFromPoint` returns.
class FakeElement {
  constructor(
    readonly name: string,
    readonly classes: string[] = [],
    readonly attrs: Record<string, string> = {},
    readonly parent: FakeElement | null = null,
  ) {}
  matches(selector: string): boolean {
    return selector.split(",").some((raw) => {
      const part = raw.trim();
      if (part.startsWith(".")) return this.classes.includes(part.slice(1));
      const attr = part.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);
      if (!attr?.[1]) return false;
      const value = this.attrs[attr[1]];
      return attr[2] === undefined ? value !== undefined : value === attr[2];
    });
  }
  closest(selector: string): FakeElement | null {
    if (this.matches(selector)) return this;
    return this.parent ? this.parent.closest(selector) : null;
  }
}

const body = new FakeElement("body");
const pane = new FakeElement("pane", ["pane"], {}, body);
const editor = new FakeElement(
  "cm-line",
  ["cm-line"],
  {},
  new FakeElement("cm-editor", ["cm-editor"], {}, pane),
);
const chat = new FakeElement(
  "composer",
  ["chat-composer"],
  {},
  new FakeElement("chat", [], { "data-chat-pane": "p2" }, body),
);
const overlay = new FakeElement("overlay", ["full-window-layer"], {}, body);
const tourCard = new FakeElement("tour-card", ["tour-card"], {}, new FakeElement("tour", ["tour"], {}, body));
const dialog = new FakeElement(
  "dialog",
  ["pvw"],
  { role: "dialog", "aria-modal": "true" },
  new FakeElement("scrim", ["pv-scrim"], {}, body),
);

const editorAt = (element: FakeElement) => (element.closest(".cm-editor") ? "editor" : null);
const chatAt = (element: FakeElement) => (element.closest("[data-chat-pane]") ? "chat" : null);
const at = (...stack: FakeElement[]): DropCandidate<FakeElement> => ({ point: { x: 10, y: 20 }, stack });

describe("the drop router walks the element stack", () => {
  test("a full-window overlay above the note no longer steals the drop", () => {
    // before: elementFromPoint returned only `overlay`, so no editor was found
    // and the image went silently to storage
    expect(firstTarget([at(overlay, editor, pane, body)], editorAt)?.target).toBe("editor");
  });

  test("the non-modal tour card passes the drop through to the app underneath", () => {
    expect(firstTarget([at(tourCard, editor, pane, body)], editorAt)?.target).toBe("editor");
  });

  test("a modal dialog owns the drop: it never tunnels into the note beneath", () => {
    expect(firstTarget([at(dialog, editor, pane, body)], editorAt)).toBeNull();
    expect(firstTarget([at(dialog.parent!, editor, pane, body)], editorAt)).toBeNull();
  });

  test("candidate points are tried in order and report the point that hit", () => {
    const miss: DropCandidate<FakeElement> = { point: { x: 1, y: 1 }, stack: [body] };
    const hit: DropCandidate<FakeElement> = { point: { x: 2, y: 2 }, stack: [chat, body] };
    expect(firstTarget([miss, hit], chatAt)).toEqual({ target: "chat", point: { x: 2, y: 2 } });
    expect(firstTarget([miss], chatAt)).toBeNull();
  });
});

describe("the drop plan", () => {
  test("a chat attaches the images it accepts and stores the rest", () => {
    expect(planDrop(["/a/shot.png", "/a/logo.svg", "/a/report.pdf"], "chat")).toEqual({
      attach: ["/a/shot.png"],
      embed: [],
      store: ["/a/logo.svg", "/a/report.pdf"],
      notice: null,
    });
  });

  test("a note embeds images and video and stores everything else", () => {
    expect(planDrop(["/a/logo.svg", "/a/clip.mp4", "/a/report.pdf"], "editor")).toEqual({
      attach: [],
      embed: ["/a/logo.svg", "/a/clip.mp4"],
      store: ["/a/report.pdf"],
      notice: null,
    });
  });

  test("files with no chat or note under them are stored AND say so", () => {
    expect(planDrop(["/a/shot.png"], "none")).toEqual({
      attach: [],
      embed: [],
      store: ["/a/shot.png"],
      notice: UNROUTED_MEDIA_NOTICE,
    });
    expect(planDrop(["/a/one.pdf", "/a/two.zip"], "none").notice).toBe("Saved 2 files to Assets");
    expect(planDrop([], "none").notice).toBeNull();
  });
});

describe("a paste of copied files", () => {
  const finderCopy = { types: ["text/plain"], fileCount: 0, uriList: "" };

  test("a Finder copy (just the file name as text) is a file paste once the host sees file references", () => {
    // before: the chat pasted the name as text and the note did nothing
    expect(classifyPaste(finderCopy, "chat", true)).toEqual({ paths: true, bytes: false });
    expect(classifyPaste(finderCopy, "editor", true)).toEqual({ paths: true, bytes: false });
  });

  test("ordinary text keeps pasting as text", () => {
    expect(classifyPaste(finderCopy, "editor", false)).toBeNull();
    expect(
      classifyPaste({ types: ["text/html", "text/plain"], fileCount: 1, uriList: "" }, "editor", false),
    ).toBeNull();
  });

  test("a file:// uri-list is a file paste on either surface without the host signal", () => {
    const uris = { types: ["text/uri-list"], fileCount: 0, uriList: "# copied\nfile:///Users/a/shot.png" };
    expect(classifyPaste(uris, "chat", false)).toEqual({ paths: true, bytes: false });
    expect(classifyPaste({ ...uris, uriList: "https://example.com/a.png" }, "chat", false)).toBeNull();
  });

  test("bare image bytes paste into a note, never into a chat", () => {
    const screenshot = { types: ["Files", "image/png"], fileCount: 1, uriList: "" };
    expect(classifyPaste(screenshot, "editor", false)).toEqual({ paths: false, bytes: true });
    expect(classifyPaste(screenshot, "chat", false)).toBeNull();
  });

  test("a stale 'has files' signal never eats the text the person copied inside Rotli", () => {
    // Finder copy → focus Rotli → "Copy path" → ⌘V: nothing granted, no files left
    expect(emptyPasteOutcome(false, "editor", "/Users/a/notes/plan.md")).toBe("insert-text");
    expect(emptyPasteOutcome(false, "chat", "/Users/a/notes/plan.md")).toBe("paste-again");
    expect(emptyPasteOutcome(false, "editor", "")).toBe("paste-again");
    // the files are still there but this copy's one grant is spent
    expect(emptyPasteOutcome(true, "editor", "shot.png")).toBe("copy-again");
  });
});
