import { describe, expect, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";

import type { LibrarianChat as Chat } from "../state/librarianBar";
import { ChatPanel, chatShownIn } from "./librarianChat";

function render(chat: Chat) {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <ChatPanel chat={chat} noteId={chat.noteId} paneId={chat.paneId} />
    </QueryClientProvider>,
  );
}

const base: Chat = {
  id: "c1",
  paneId: "p1",
  noteId: "n1",
  modelId: "claude-opus",
  turns: [],
  status: "idle",
  error: null,
  minimized: false,
};

describe("the Librarian chat", () => {
  test("only the pane showing the conversation's note shows it", () => {
    expect(chatShownIn(base, "p1", "n1")).toBe(true);
    expect(chatShownIn(base, "p2", "n1")).toBe(false);
    expect(chatShownIn(base, "p1", "n2")).toBe(false);
    expect(chatShownIn(null, "p1", "n1")).toBe(false);
    expect(render(base)).toContain('aria-label="Librarian chat"');
  });

  test("the conversation reads as a chat: the question with its passage, the reply, and its proposals", () => {
    const markup = render({
      ...base,
      turns: [
        {
          id: "t1",
          role: "user",
          text: "Who is this?",
          highlight: { exact: "the survey in March", prefix: "", suffix: "" },
        },
        {
          id: "t2",
          role: "librarian",
          text: "Someone you met.\n\nI’d file this with Projects.",
          raw: "",
          actions: [{ type: "file", area: "Projects", create: false }],
          proposal: { kind: "open", picked: [true] },
        },
      ],
    });
    expect(markup).toContain('<q class="libchat-quote">the survey in March</q><p>Who is this?</p>');
    expect(markup).toContain("<p>Someone you met.</p><p>I’d file this with Projects.</p>");
    expect(markup).toContain("File it in Projects");
    expect(markup).toContain(">Apply</button>");
    expect(markup).toContain('aria-live="polite"');
    // the composer, ready for the next message
    expect(markup).toContain('aria-label="Message the Librarian"');
  });

  test("while it thinks, and when something goes wrong, it says so", () => {
    const markup = render({ ...base, status: "thinking", error: "The Claude lane is signed out." });
    expect(markup).toContain('aria-label="The Librarian is thinking"');
    expect(markup).toContain('role="alert">The Claude lane is signed out.</p>');
  });

  test("an applied proposal points to where it can be undone", () => {
    const markup = render({
      ...base,
      turns: [
        {
          id: "t2",
          role: "librarian",
          text: "All set.",
          raw: "",
          actions: [{ type: "tag", tags: ["person"] }],
          proposal: { kind: "applied", message: "1 change made." },
        },
      ],
    });
    expect(markup).toContain("1 change made.");
    expect(markup).toContain("Undo in Librarian Activity");
    expect(markup).not.toContain(">Apply</button>");
  });

  test("it says what it is for, and offers Chat for anything else", () => {
    const markup = render({
      ...base,
      turns: [
        { id: "t1", role: "user", text: "Write me a poem about Maya", highlight: null },
        {
          id: "t2",
          role: "librarian",
          text: "A poem is one for Chat.",
          raw: "",
          actions: [],
          handoff: true,
        },
      ],
    });
    expect(markup).toContain("organizes this note");
    expect(markup).toContain(">Open in Chat</button>");
    expect(markup).toContain(">Take this to Chat</button>");
    // the quick asks keep it to its job
    expect(markup).toContain(">Suggest tags</button>");
    expect(markup).toContain(">File this note</button>");
    expect(markup).toContain('placeholder="Connect a model in Settings"');
  });

  test("once taken to Chat, the offer says so and can't open a second chat", () => {
    const markup = render({
      ...base,
      turns: [
        {
          id: "t2",
          role: "librarian",
          text: "A poem is one for Chat.",
          raw: "",
          actions: [],
          handoff: true,
          handedOff: true,
        },
      ],
    });
    expect(markup).toContain('disabled="">Opened in Chat</button>');
  });

  test("a reply that organizes has no Chat offer of its own", () => {
    const markup = render({
      ...base,
      turns: [
        {
          id: "t2",
          role: "librarian",
          text: "Tagging it.",
          raw: "",
          actions: [{ type: "tag", tags: ["person"] }],
          proposal: { kind: "open", picked: [true] },
        },
      ],
    });
    expect(markup).not.toContain("Take this to Chat");
  });

  test("minimized, it is a button in the same corner", () => {
    const markup = render({ ...base, minimized: true });
    expect(markup).toContain('aria-label="Open the Librarian chat"');
    expect(markup).not.toContain('aria-label="Librarian chat"');
  });
});
