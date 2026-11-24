import { describe, expect, test } from "bun:test";

import { isConsultAlias, parseConsultMention } from "../../ai/chatProvider";
import type { NoteSummary } from "../../types";
import {
  CHAT_COMMANDS,
  type ChatCommandId,
  composerAttachment,
  composerTrigger,
  filterChatCommands,
  filterMentionNotes,
  latestReplyMermaid,
  latestReplyText,
  MENTION_LIMIT,
  mentionableNotes,
  removeTrigger,
  replaceTrigger,
  replyNoteBody,
} from "./chatComposerMenuModel";

const ALL = new Set<ChatCommandId>(CHAT_COMMANDS.map((command) => command.id));
const at = (text: string) => composerTrigger(text, text.length);

const note = (id: string, title: string, extra: Partial<NoteSummary> = {}): NoteSummary => ({
  id,
  title,
  snippet: "",
  folderId: "Notes",
  createdAt: 0,
  updatedAt: 0,
  pinned: false,
  ...extra,
});

describe("composer triggers", () => {
  test("a slash at the start or after whitespace opens the command menu", () => {
    expect(at("/")).toEqual({ kind: "command", from: 0, to: 1, query: "" });
    expect(at("/boa")).toEqual({ kind: "command", from: 0, to: 4, query: "boa" });
    expect(at("draw this /bo")).toEqual({ kind: "command", from: 10, to: 13, query: "bo" });
    expect(at("first line\n/no")?.query).toBe("no");
  });

  test("a slash inside a word, a path or a URL stays literal", () => {
    expect(at("and/or")).toBeNull();
    expect(at("see https://rotli.co/")).toBeNull();
    expect(at("src/components/")).toBeNull();
    expect(at("/boa ")).toBeNull();
  });

  test("the caret mid-token still reads the whole token", () => {
    expect(composerTrigger("/board", 2)).toEqual({ kind: "command", from: 0, to: 6, query: "board" });
  });

  test("an @ at the start or after whitespace opens the note picker", () => {
    expect(at("@")).toEqual({ kind: "mention", from: 0, to: 1, query: "" });
    expect(at("about @road")).toEqual({ kind: "mention", from: 6, to: 11, query: "road" });
  });

  test("an email address or a mid-word @ stays literal", () => {
    expect(at("mail me at name@example.com")).toBeNull();
    expect(at("a@b")).toBeNull();
    expect(at("@road map")).toBeNull();
  });

  test("provider tags keep their consult meaning", () => {
    expect(at("@claude")).toBeNull();
    expect(at("ask @gpt")).toBeNull();
    expect(at("@codex:gpt-5")).toBeNull();
    expect(at("@cla")?.kind).toBe("mention");
    expect(isConsultAlias("agy")).toBe(true);
    expect(isConsultAlias("Claude")).toBe(true);
    expect(isConsultAlias("claudette")).toBe(false);
    expect(parseConsultMention("@claude what next?")).toMatchObject({ kind: "consult", provider: "claude" });
  });

  test("removing a trigger keeps the rest of the draft", () => {
    const text = "summarise /boa please";
    const trigger = composerTrigger(text, 14)!;
    expect(removeTrigger(text, trigger)).toEqual({ text: "summarise please", caret: 10 });
    expect(removeTrigger("/note", at("/note")!)).toEqual({ text: "", caret: 0 });
  });

  test("Tab completion replaces the token", () => {
    expect(replaceTrigger("/bo", at("/bo")!, "/board ")).toEqual({ text: "/board ", caret: 7 });
  });
});

describe("command filter", () => {
  test("an empty query lists every available command in catalog order", () => {
    expect(filterChatCommands("", ALL).map((c) => c.id)).toEqual(CHAT_COMMANDS.map((c) => c.id));
  });

  test("/boa finds board first", () => {
    expect(filterChatCommands("boa", ALL)[0]?.id).toBe("board");
  });

  test("a name prefix outranks a description word and a keyword", () => {
    expect(filterChatCommands("n", ALL).map((c) => c.id)).toEqual(["note", "new", "board", "attach", "tag"]);
    expect(filterChatCommands("diagram", ALL).map((c) => c.id)).toEqual(["board"]);
  });

  test("an unavailable command never shows", () => {
    const withoutTag = new Set<ChatCommandId>(["board", "note", "new"]);
    expect(filterChatCommands("tag", withoutTag)).toEqual([]);
    expect(filterChatCommands("", withoutTag).map((c) => c.id)).toEqual(["board", "note", "new"]);
  });

  test("no match is an empty list", () => {
    expect(filterChatCommands("zzz", ALL)).toEqual([]);
  });
});

describe("note mentions", () => {
  test("only Markdown notes outside chats/ can be mentioned", () => {
    const notes = [
      note("a", "Plan"),
      note("b", "Sketch", { kind: "board" }),
      note("c", "photo.png", { kind: "file" }),
      note("d", "A chat", { folderId: "chats" }),
    ];
    expect(mentionableNotes(notes).map((n) => n.id)).toEqual(["a"]);
  });

  test("title prefix, then a title word, then anywhere; newest first within a rank", () => {
    const notes = [
      note("1", "Weekly roadmap", { updatedAt: 3 }),
      note("2", "Roadmap 2027", { updatedAt: 1 }),
      note("3", "Roadmap draft", { updatedAt: 2 }),
      note("4", "Unroadmapped ideas", { updatedAt: 9 }),
      note("5", "Groceries", { updatedAt: 10 }),
    ];
    expect(filterMentionNotes("road", notes).map((n) => n.id)).toEqual(["3", "2", "1", "4"]);
    expect(filterMentionNotes("", notes)[0]?.id).toBe("5");
  });

  test("the picker never shows more than its limit", () => {
    const many = Array.from({ length: 20 }, (_, i) => note(String(i), `Note ${i}`));
    expect(filterMentionNotes("note", many)).toHaveLength(MENTION_LIMIT);
  });
});

describe("reply helpers", () => {
  const thread = [
    { speaker: "you", text: "draw it" },
    { speaker: "rotli", text: "Here:\n```mermaid\ngraph TD\nA-->B\n```" },
    { speaker: "you", text: "and as prose?" },
    { speaker: "rotli", text: "A leads to B." },
    { speaker: "rotli", text: "⚠ The model stopped." },
  ];

  test("the newest Mermaid diagram in any reply", () => {
    expect(latestReplyMermaid(thread)).toBe("graph TD\nA-->B");
    expect(latestReplyMermaid([{ speaker: "you", text: "```mermaid\ngraph LR\n```" }])).toBeNull();
  });

  test("the newest real reply, skipping warnings", () => {
    expect(latestReplyText(thread)).toBe("A leads to B.");
    expect(latestReplyText([{ speaker: "you", text: "hi" }])).toBeNull();
  });

  test("a saved reply is titled by the chat unless it has its own heading", () => {
    expect(replyNoteBody("Roadmap chat", "A leads to B.")).toBe("# Roadmap chat\n\nA leads to B.\n");
    expect(replyNoteBody("Roadmap chat", "# Plan\n\nSteps")).toBe("# Plan\n\nSteps\n");
    expect(replyNoteBody("  ", "x")).toBe("# Saved reply\n\nx\n");
  });
});

describe("composer attachment", () => {
  const pending = { noteId: "n1", title: "Payroll", stem: "secure-note-abc123", secure: true };

  test("a pending secure note makes the chat secure before anything is sent", () => {
    expect(composerAttachment({ savedStem: "", savedNoteId: null, pending, secureContext: false })).toEqual({
      noteId: "n1",
      secureHint: true,
      secureChat: true,
    });
  });

  test("a plain pending note leaves a plain chat plain", () => {
    const plain = { ...pending, stem: "roadmap", secure: false };
    expect(
      composerAttachment({ savedStem: "", savedNoteId: null, pending: plain, secureContext: false })
        .secureChat,
    ).toBe(false);
  });

  test("the saved attachment's secure stem and a tainted history both count", () => {
    expect(
      composerAttachment({
        savedStem: "secure-note-x",
        savedNoteId: "n2",
        pending: null,
        secureContext: false,
      }),
    ).toEqual({ noteId: "n2", secureHint: true, secureChat: true });
    expect(
      composerAttachment({ savedStem: "plan", savedNoteId: "n3", pending: null, secureContext: true })
        .secureChat,
    ).toBe(true);
  });
});
