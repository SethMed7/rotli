// resolveChatNoteId: one match is the note; several are told apart by the
// back-link to the chat, reading only the ambiguous bodies (2026-09-17).
import { describe, expect, test } from "bun:test";

import type { ApprovedNote } from "../ai/approvedRead";
import { approved, person } from "../lib/promptText.fixtures";
import { CORPUS_INSTANCE_ID } from "../memex/config";
import {
  chatNoteListingFolder,
  chatNoteScope,
  MEMORY_NOTE_WITHHELD,
  memoryNoteFor,
  resolveChatNoteId,
} from "./composition";
import { CHAT_NOTES_HEADING } from "./model";
import { type ChatMemoryRepository, syncChatMemory } from "./workflow";

describe("resolveChatNoteId", () => {
  const notes = [
    { id: "projects", aliases: ["omachary-research"], updatedAt: 2 },
    { id: "research", aliases: ["omachary-research"], updatedAt: 5 },
    { id: "seths-own", aliases: ["omachary-research"], updatedAt: 9 },
  ];
  const bodies: Record<string, string> = {
    projects: "# Omachary Research\n\nNotes from [[omachary-research]].",
    research: "# Omachary Research\n\n> chat: [[omachary-research]]",
    "seths-own": "# Omachary Research\n\nmy own note with the same title",
  };

  test("a single match never reads a body", async () => {
    let reads = 0;
    const id = await resolveChatNoteId("omachary-research", "omachary-research", [notes[0]!], async () => {
      reads += 1;
      return null;
    });
    expect(id).toBe("projects");
    expect(reads).toBe(0);
  });

  test("several matches resolve to the newest note that links back to the chat", async () => {
    const read: string[] = [];
    const id = await resolveChatNoteId("omachary-research", "omachary-research", notes, async (noteId) => {
      read.push(noteId);
      return bodies[noteId] ?? null;
    });
    expect(id).toBe("research");
    expect(read.sort()).toEqual(["projects", "research", "seths-own"]);
  });

  test("no match is null", async () => {
    expect(await resolveChatNoteId("nope", "chat", notes, async () => null)).toBeNull();
  });
});

describe("chatNoteScope", () => {
  test("the corpus reads the unscoped listing", () => {
    const scope = chatNoteScope({ id: CORPUS_INSTANCE_ID });
    expect(scope).toEqual({ kind: "corpus" });
    expect(chatNoteListingFolder(scope)).toBeUndefined();
  });

  test("a connected brain reads only its own root", () => {
    const scope = chatNoteScope({ id: "work" });
    expect(scope).toEqual({ kind: "brain", root: "work:" });
    expect(chatNoteListingFolder(scope)).toBe("work:");
  });
});

// Third review of pull request 267 (#3): both memory paths (the note the chat
// is attached to, and the chat's own memory note) read the note through the
// editor's ungated lane, so a note that turned secure mid-turn had its notes
// sent to the chat's model. They now read through the gated, versioned read
// for that model, and stop when it refuses.
describe("conversation memory reads its note through the gate", () => {
  const MODEL = { id: "cloud-model", endpoint: "https://api.example.test" };
  const CANARY = "PRIVATE-CANARY-7Q4";
  const body = `# Plan\n\n${CHAT_NOTES_HEADING}\n\n- launch on friday\n`;
  const turns = [{ speaker: "you", text: person("what did we decide?") }];
  /** The gated read: the note while it is public, a refusal once it turned secure. */
  const gate =
    (secure: ReadonlySet<string>): ((id: string) => Promise<ApprovedNote>) =>
    async (id) => {
      if (secure.has(id)) throw new Error("This note is secure and can never be sent to a remote model.");
      return {
        id,
        revision: `rev-${id}`,
        text: approved(body),
        body: approved(body),
        title: approved("Plan"),
        onDeviceOnly: false,
      };
    };

  function run(secure: ReadonlySet<string>, attachedEditable: boolean) {
    const read = gate(secure);
    const composed: (string | null)[] = [];
    const writes: string[] = [];
    const repository: ChatMemoryRepository = {
      findByStem: (stem) => memoryNoteFor("attached", stem, attachedEditable, MODEL, read),
      findMemoryNote: () => memoryNoteFor("own", "chat-own", true, MODEL, read),
      create: async () => {
        throw new Error("no note is created");
      },
      update: async (id, _next, revision) => void writes.push(`${id}@${revision}`),
      attach: async () => {},
      setMemoryNote: async () => {},
    };
    const done = syncChatMemory(repository, {
      title: "Plan",
      chatSlug: "plan",
      attachedStem: "plan",
      turns,
      composeNotes: async ({ currentNotes }) => (composed.push(currentNotes), `- ${CANARY}`),
    });
    return { done, composed, writes };
  }

  test("the attached note turning secure mid-turn: nothing sent to the model, nothing written", async () => {
    const { done, composed, writes } = run(new Set(["attached"]), true);
    await expect(done).rejects.toThrow(MEMORY_NOTE_WITHHELD);
    expect(composed).toEqual([]);
    expect(writes).toEqual([]);
  });

  test("the chat's own memory note turning secure mid-turn: nothing sent to the model, nothing written", async () => {
    // a person-written attached note is only read; the chat writes its own note
    const { done, composed, writes } = run(new Set(["own"]), false);
    await expect(done).rejects.toThrow(MEMORY_NOTE_WITHHELD);
    expect(composed).toEqual([]);
    expect(writes).toEqual([]);
  });

  test("while both are readable, the model gets the notes of the approved read, written back at its revision", async () => {
    const { done, composed, writes } = run(new Set(), true);
    await done;
    expect(composed).toEqual(["- launch on friday"]);
    expect(writes).toEqual(["attached@rev-attached"]);
  });
});

// Fourth review (#2): memory waits for the note's save and sends nothing when
// the read isn't the version the editor just saved, or the save failed.
describe("conversation memory reads its note as just saved", () => {
  const MODEL = { id: "local", endpoint: "http://127.0.0.1:11434" };
  const read = async (id: string): Promise<ApprovedNote> => ({
    id,
    revision: "r-disk",
    text: approved("# Plan"),
    body: approved("# Plan"),
    title: approved("Plan"),
    onDeviceOnly: false,
  });

  test("a failed save is the refusal, in its own words, before anything is read", async () => {
    let reads = 0;
    const saved = {
      flush: async () => {
        throw new Error("The disk is full.");
      },
      mismatch: () => null,
    };
    await expect(
      memoryNoteFor(
        "n",
        "plan",
        true,
        MODEL,
        async (id) => {
          reads += 1;
          return read(id);
        },
        saved,
      ),
    ).rejects.toThrow("The disk is full.");
    expect(reads).toBe(0);
  });

  test("a read that isn't the editor's saved version is refused: still saving", async () => {
    const saved = { flush: async () => {}, mismatch: () => "Still saving. Try again in a moment." };
    await expect(memoryNoteFor("n", "plan", true, MODEL, read, saved)).rejects.toThrow(
      "Still saving. Try again in a moment.",
    );
  });
});
