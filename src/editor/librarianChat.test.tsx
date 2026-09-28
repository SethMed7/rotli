import { describe, expect, test } from "bun:test";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";

import type { LibrarianChat as Chat } from "../state/librarianBar";
import { ChatPanel, chatShownIn, LibrarianCorner } from "./librarianChat";

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
  test("what a statement kept shows under the reply, and a question about someone known asks Yes or No", () => {
    const markup = render({
      ...base,
      turns: [
        {
          id: "t1",
          role: "librarian",
          text: "Added Ana. Sam already has a note.",
          raw: "",
          actions: [],
          vault: [
            { type: "person", name: "Ana", area: "People/Work", about: "", tags: [] },
            {
              type: "update",
              noteId: "01SAM",
              name: "Sam",
              from: "people/friends",
              area: "People/Work",
              tags: [],
            },
          ],
          kept: { kind: "kept", lines: [{ text: "Added Ana to People/Work", noteId: "01ANA" }] },
          asks: [{ kind: "open" }],
        },
      ],
    });
    expect(markup).toContain("<li>Added Ana to People/Work</li>");
    expect(markup).toContain("See or undo in Librarian Activity");
    expect(markup).toContain(
      "Sam already has a note in people/friends. Move it from people/friends to People/Work?",
    );
    expect(markup).toContain(">No</button>");
    expect(markup).toContain(">Yes</button>");
  });

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
    // under the composer: what the Librarian is for, and isn't
    expect(markup).toContain("The Librarian only organizes");
    expect(markup).toContain("It doesn’t chat.");
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

  test("the pill comes with a /librarian conversation: tucked, or open above it", () => {
    const corner = (here: Chat) =>
      renderToStaticMarkup(
        <QueryClientProvider client={new QueryClient()}>
          <LibrarianCorner here={here} noteId="n1" paneId="p1" />
        </QueryClientProvider>,
      );
    const tucked = corner({ ...base, minimized: true });
    expect(tucked).toContain('aria-label="Open the Librarian"');
    expect(tucked).not.toContain('aria-label="Librarian chat"');
    const open = corner(base);
    expect(open).toContain('aria-label="Librarian chat"');
    expect(open).toContain('aria-label="Hide the Librarian"');
    expect(open).toContain('aria-expanded="true"');
  });

  test("an applied reply lists exactly what changed", () => {
    const markup = render({
      ...base,
      turns: [
        { id: "t1", role: "user", text: "tag and file it", highlight: null },
        {
          id: "t2",
          role: "librarian",
          text: "Done.",
          raw: "",
          actions: [
            { type: "tag", tags: ["rotli", "bugs"] },
            { type: "file", area: "Projects", create: false },
          ],
          proposal: {
            kind: "applied",
            message: "2 changes made.",
            done: [
              { type: "tag", tags: ["rotli", "bugs"] },
              { type: "file", area: "Projects", create: false },
            ],
          },
        },
      ],
    });
    expect(markup).toContain('aria-label="What changed"');
    expect(markup).toContain("Tagged: rotli, bugs");
    expect(markup).toContain("Filed in Projects");
  });

  test("before anything is asked, it says what it can do", () => {
    expect(render(base)).toContain("Tell me how to organize this note");
  });
});
