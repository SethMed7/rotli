import { describe, expect, test } from "bun:test";

import { anchorFromSelection } from "./librarianActions";
import {
  HISTORY_TURNS,
  latestHighlight,
  type LibrarianContext,
  librarianChatMessages,
  type LibrarianTurn,
  splitLibrarianReply,
} from "./librarianChat";

const NOTE =
  "# Maya Chen\n\nMet Maya at the design meetup. She runs research at Northwind.\n\nFollow up in March.";
const CTX: LibrarianContext = {
  title: "Maya Chen",
  doc: NOTE,
  areas: ["people", "projects"],
  tags: ["q3"],
  people: ["People/Family", "People/Friends"],
  filing: ["Recipes go to Cooking"],
};
const at = NOTE.indexOf("runs research");
const HIGHLIGHT = anchorFromSelection(NOTE, at, at + "runs research".length);

describe("the messages a turn sends", () => {
  test("the rules and the note as it is now, then the conversation in order", () => {
    const turns: LibrarianTurn[] = [
      { role: "user", text: "Who is this?", highlight: null },
      { role: "librarian", text: "Someone you met.", raw: "Someone you met.", actions: [] },
      { role: "user", text: "Mark her job", highlight: HIGHLIGHT },
    ];
    const messages = librarianChatMessages(CTX, turns);
    expect(messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(messages[0]?.content).toContain("You never rewrite notes");
    expect(messages[0]?.content).toContain("belongs in Chat");
    expect(messages[0]?.content).toContain("Current tags: q3");
    expect(messages[0]?.content).toContain("Library areas: people, projects");
    expect(messages[0]?.content).toContain("She runs research at Northwind.");
    // the Librarian rules ride along: the People groups and the person's own filing rules
    expect(messages[0]?.content).toContain("People areas: People/Family, People/Friends");
    expect(messages[0]?.content).toContain(
      "filing rules (follow them when they apply):\n- Recipes go to Cooking",
    );
    // a question about a highlight carries the passage with it
    expect(messages[3]?.content).toBe('Highlighted passage: """runs research"""\n\nMark her job');
    expect(messages[1]?.content).toBe("Who is this?");
  });

  test("a long conversation carries only its latest turns", () => {
    const turns: LibrarianTurn[] = Array.from({ length: HISTORY_TURNS + 5 }, (_, at) => ({
      role: "user" as const,
      text: `message ${at}`,
      highlight: null,
    }));
    const messages = librarianChatMessages(CTX, turns);
    expect(messages).toHaveLength(HISTORY_TURNS + 1);
    expect(messages[1]?.content).toBe("message 5");
    expect(messages.at(-1)?.content).toBe(`message ${HISTORY_TURNS + 4}`);
  });

  test("the Librarian's own replies go back exactly as it sent them, JSON and all", () => {
    const raw = 'Tagging it.\n{"actions":[{"type":"tag","tags":["person"]}]}';
    const turns: LibrarianTurn[] = [
      { role: "user", text: "Tag it", highlight: null },
      { role: "librarian", text: "Tagging it.", raw, actions: [{ type: "tag", tags: ["person"] }] },
      { role: "user", text: "Thanks", highlight: null },
    ];
    expect(librarianChatMessages(CTX, turns)[2]?.content).toBe(raw);
  });

  test("the newest question's passage is the one a proposed mark uses", () => {
    expect(latestHighlight([])).toBeNull();
    expect(
      latestHighlight([
        { role: "user", text: "a", highlight: HIGHLIGHT },
        { role: "librarian", text: "b", raw: "b", actions: [] },
        { role: "user", text: "c", highlight: null },
      ]),
    ).toBeNull();
    expect(latestHighlight([{ role: "user", text: "a", highlight: HIGHLIGHT }])).toEqual(HIGHLIGHT);
  });
});

describe("a reply, split into what is said and what is proposed", () => {
  const context = { doc: NOTE, highlight: null, areas: ["people"] };

  test("prose alone is a reply with nothing to apply", () => {
    expect(splitLibrarianReply("  Maya runs research at Northwind.  ", context)).toEqual({
      prose: "Maya runs research at Northwind.",
      actions: [],
      handoff: false,
    });
  });

  test("the JSON block, fenced or not, is lifted out of what is shown", () => {
    const fenced =
      'I would tag it and file it.\n```json\n{"actions":[{"type":"tag","tags":["person"]},{"type":"file","area":"people"}]}\n```\nApply when ready.';
    expect(splitLibrarianReply(fenced, context)).toEqual({
      prose: "I would tag it and file it.\n\nApply when ready.",
      actions: [
        { type: "tag", tags: ["person"] },
        { type: "file", area: "people", create: false },
      ],
      handoff: false,
    });
    expect(splitLibrarianReply('{"actions":[{"type":"tag","tags":["a"]}]}', context)).toEqual({
      prose: "",
      actions: [{ type: "tag", tags: ["a"] }],
      handoff: false,
    });
  });

  test("actions outside the grammar are dropped, never guessed at", () => {
    const reply = 'Done.\n{"actions":[{"type":"rewrite","text":"x"},{"type":"file","area":"nowhere"}]}';
    expect(splitLibrarianReply(reply, context)).toEqual({ prose: "Done.", actions: [], handoff: false });
  });

  test("a person is filed into a People group the rules name, created when missing", () => {
    const people = { ...context, people: ["People/Family", "People/Friends"] };
    expect(
      splitLibrarianReply('{"actions":[{"type":"file","area":"people/friends"}]}', people).actions,
    ).toEqual([{ type: "file", area: "People/Friends", create: true }]);
    expect(
      splitLibrarianReply('{"actions":[{"type":"file","area":"People/Strangers"}]}', people).actions,
    ).toEqual([]);
  });

  test("a request that isn't about organizing comes back flagged for Chat", () => {
    const reply = 'That belongs in Chat; I only organize this note.\n{"actions":[],"handoff":"chat"}';
    expect(splitLibrarianReply(reply, context)).toEqual({
      prose: "That belongs in Chat; I only organize this note.",
      actions: [],
      handoff: true,
    });
    // a reply that proposes changes is organizing, whatever else it says
    const both = 'Tagging it.\n{"actions":[{"type":"tag","tags":["a"]}],"handoff":"chat"}';
    expect(splitLibrarianReply(both, context).handoff).toBe(false);
  });
});
