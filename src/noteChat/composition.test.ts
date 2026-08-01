// The chat chip's listing contract, exercised through the REAL composition
// module with the memex service + corpus bridge mocked: a note owns many chats,
// and every chat pointed at that note must come back (newest work first) so the
// chip can offer the picker instead of silently continuing one chat.
//
// The last test is the 2026-08-01 regression: the chat surface syncs
// "Conversation notes" after every turn, and that sync used to RE-POINT the
// chat's `attachedTo` at the memory note it had just written — orphaning the
// chat from the note it was opened on, so the chip listed nothing, fell through
// to "continue the deterministic chat", and the same chat opened every time
// with no picker.
//
// `mock.module` is process-wide and outlives this file, so every mock spreads
// the REAL module and afterAll puts the real ones back — a bare stub would
// break whichever test file loads next.

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { MemexInstance } from "../memex/config";
import type { NoteSummary } from "../types";
import { syncChatMemory } from "../chatMemory/workflow";
import { findAttachedChats } from "./model";
import * as realTauri from "../lib/tauri";
import * as realService from "../memex/service";

const INSTANCE: MemexInstance = {
  id: "vault",
  label: "vault",
  root: "/tmp/vault",
  role: "chat-system",
  memexId: "mx_test",
  mode: "secure",
  perms: "chats+inbox",
  brainEnabled: true,
};

interface FakeChat {
  slug: string;
  title: string;
  source: string;
  attachedTo: string;
  path: string;
  modifiedMs: number;
  pinned: boolean;
}

const chats: FakeChat[] = [];

const makeChat = (slug: string, attachedTo: string, modifiedMs: number, title = slug): FakeChat => ({
  slug,
  title,
  source: "rotli",
  attachedTo,
  path: `/tmp/vault/chats/${slug}.md`,
  modifiedMs,
  pinned: false,
});

void mock.module("../lib/tauri", () => ({
  ...realTauri,
  corpusNotePath: async () => "vault:wiki/_inbox/fish-audio-vs-elevenlabs.md",
  corpusFrontmatter: async () => ({}),
}));
void mock.module("../memex/service", () => ({
  ...realService,
  loadConfig: async () => ({ activeId: INSTANCE.id, instances: [INSTANCE] }),
  listChats: async () => chats.map((chat) => ({ ...chat })),
  setChatAttachedTo: async (_instance: MemexInstance, slug: string, stem: string) => {
    const chat = chats.find((c) => c.slug === slug);
    if (chat) chat.attachedTo = stem;
  },
  writeChat: async (input: { slug: string; title: string; attachedTo?: string }) => {
    chats.push(makeChat(input.slug, input.attachedTo ?? "", Date.now(), input.title));
    return { slug: input.slug, path: `/tmp/vault/chats/${input.slug}.md` };
  },
}));

afterAll(() => {
  void mock.module("../lib/tauri", () => realTauri);
  void mock.module("../memex/service", () => realService);
});

const { listChatsForNote, openChatForNote } = await import("./composition");

const NOTE: NoteSummary = {
  id: "01KYTBW1KRYR9G5SJ5CT854416",
  title: "Fish Audio vs ElevenLabs",
  snippet: "",
  folderId: "vault:wiki/_inbox",
  createdAt: 0,
  updatedAt: 0,
  pinned: false,
  kind: "note",
};
const NOTE_STEM = "fish-audio-vs-elevenlabs";
const FIRST_CHAT = "chat-about-fish-audio-vs-elevenlabs-854416";

beforeEach(() => {
  chats.length = 0;
});

describe("listChatsForNote", () => {
  test("returns EVERY chat attached to the note, newest work first", async () => {
    chats.push(
      makeChat(FIRST_CHAT, NOTE_STEM, 10),
      makeChat("chat-about-something-else-zzz999", "something-else", 99),
      makeChat(`${FIRST_CHAT}-2`, NOTE_STEM, 30),
    );
    expect((await listChatsForNote(NOTE)).map((c) => c.slug)).toEqual([`${FIRST_CHAT}-2`, FIRST_CHAT]);
  });

  test("a chat created from the note is listed on the very next click", async () => {
    await openChatForNote(NOTE);
    expect((await listChatsForNote(NOTE)).map((c) => c.slug)).toEqual([FIRST_CHAT]);
    // …and a second chat JOINS it rather than replacing it (the picker's point)
    await openChatForNote(NOTE, { create: true });
    expect((await listChatsForNote(NOTE)).map((c) => c.slug).sort()).toEqual([FIRST_CHAT, `${FIRST_CHAT}-2`]);
  });

  test("REGRESSION: a chat's memory sync never orphans it from its note", async () => {
    await openChatForNote(NOTE);
    const slug = chats[0]!.slug;

    // one chat turn: the notes-keeping sync runs with the chat's attachment. In
    // a connected brain the attached note is not in the unscoped "All notes"
    // listing, so resolution can fail — the sync must NOT hand the attachment
    // to the memory note it writes instead.
    await syncChatMemory(
      {
        findByStem: async () => null,
        create: async (body) => ({ id: "memory", stem: "chat-about-fish-audio-vs-elevenlabs", body }),
        update: async () => {},
        attach: async (stem) => {
          const chat = chats.find((c) => c.slug === slug);
          if (chat) chat.attachedTo = stem;
        },
      },
      {
        title: "Chat about Fish Audio vs ElevenLabs",
        chatSlug: slug,
        attachedStem: NOTE_STEM,
        turns: [{ speaker: "you", text: "compare them" }],
      },
    );

    expect(findAttachedChats(chats, NOTE_STEM).map((c) => c.slug)).toEqual([slug]);
    // the chip still has something to offer → the picker, not a silent continue
    expect((await listChatsForNote(NOTE)).map((c) => c.slug)).toEqual([slug]);
  });
});
