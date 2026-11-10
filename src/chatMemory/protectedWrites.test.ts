// Fifth review of pull request 267: an on-device chat attached to a secure,
// person-written note kept its conversation notes in a NEW, unprotected
// memory note, which a remote model could then find and read. Anything a
// conversation that carries the on-device-only mark writes is now itself
// protected, or isn't written. These run on Rotli Web's twin: the notes
// service and its AI corpus, read as a remote model reads.
import { describe, expect, test } from "bun:test";

import { approved, model } from "../lib/promptText.fixtures";
import { CORPUS_INSTANCE_ID, type MemexInstance } from "../memex/config";
import { createNoteForChat } from "../noteChat/composition";
import { InMemoryNotesService } from "../services/inMemoryNotes";
import { notesService } from "../services/notes";
import { createWebAiCorpus } from "../services/webAiCorpus";
import { memoryNoteFor } from "./composition";
import { type ChatMemoryRepository, MEMORY_NOT_PROTECTED, syncChatMemory } from "./workflow";

const LOCAL = { id: "local", endpoint: "http://127.0.0.1:11434" };
const SECURE_BODY = "# Private\n\n## Conversation notes\n\nVelmora";
const saved = { flush: async () => {}, mismatch: () => null };
/** The secure attachment, as the gate gives it to an on-device model. */
const secureAttachment = () =>
  memoryNoteFor(
    "secret",
    "private",
    false, // person-written: the chat may not edit it
    LOCAL,
    async (id) => ({
      id,
      revision: "r1",
      text: approved(SECURE_BODY),
      body: approved(SECURE_BODY),
      title: approved("Private"),
      onDeviceOnly: true,
    }),
    saved,
  );
const input = {
  title: "Harbor",
  chatSlug: "harbor",
  attachedStem: "private",
  turns: [{ speaker: "rotli", text: model("Velmora") }],
  composeNotes: async () => "- Velmora",
};

describe("a marked conversation's memory", () => {
  test("the reviewer's sequence: the separate memory note is created secure, and a remote search and read reveal nothing", async () => {
    const svc = new InMemoryNotesService();
    const attachment = await secureAttachment();
    const repository: ChatMemoryRepository = {
      findByStem: async () => attachment,
      findMemoryNote: async () => null,
      create: async (body, opts) => {
        const note = await svc.createNote("Inbox", body, {
          createdBy: "chat",
          ...(opts?.secure ? { secure: true } : {}),
        });
        return {
          id: note.id,
          stem: "memory",
          body,
          revision: note.revision,
          notes: null,
          aiEditable: true,
          secure: opts?.secure === true,
        };
      },
      update: async () => {},
      attach: async () => {},
      setMemoryNote: async () => {},
    };
    const written = await syncChatMemory(repository, { ...input, protectedOnly: true });
    expect(written?.secure).toBe(true);
    const remote = createWebAiCorpus(() => svc);
    expect(await remote.search("Velmora", 10)).toEqual([]);
    expect(JSON.stringify(await remote.list())).not.toContain("Velmora");
    await expect(remote.read(written!.id)).rejects.toThrow(/secure/);
  });

  test("an unprotected memory note is never written to: nothing composed, nothing written, and it says so", async () => {
    const attachment = await secureAttachment();
    const calls: string[] = [];
    const repository: ChatMemoryRepository = {
      findByStem: async () => attachment,
      findMemoryNote: async () => ({
        id: "open",
        stem: "memory",
        body: "# Harbor",
        revision: "r1",
        notes: null,
        aiEditable: true,
        secure: false,
      }),
      create: async () => {
        throw new Error("never created");
      },
      update: async () => void calls.push("update"),
      attach: async () => {},
      setMemoryNote: async () => {},
    };
    await expect(
      syncChatMemory(repository, {
        ...input,
        protectedOnly: true,
        composeNotes: async () => (calls.push("compose"), "- Velmora"),
      }),
    ).rejects.toThrow(MEMORY_NOT_PROTECTED);
    expect(calls).toEqual([]);
  });

  test("an unmarked conversation still keeps its notes where it always did", async () => {
    let created: { secure?: boolean } | undefined;
    const repository: ChatMemoryRepository = {
      findByStem: async () => null,
      findMemoryNote: async () => null,
      create: async (body, opts) => {
        created = opts ?? {};
        return { id: "n", stem: "harbor", body, revision: "r1", notes: null, aiEditable: true };
      },
      update: async () => {},
      attach: async () => {},
      setMemoryNote: async () => {},
    };
    const { attachedStem: _attached, ...unattached } = input;
    await syncChatMemory(repository, { ...unattached, protectedOnly: false });
    expect(created).toEqual({});
  });
});

test("the chat's note button makes a secure note for a marked chat (its title can come from what it read)", async () => {
  const instance = {
    id: CORPUS_INSTANCE_ID,
    label: "Vault",
    root: "",
    role: "",
    memexId: null,
    mode: null,
    perms: { read: true, write: true } as never,
    brainEnabled: true,
    layout: "imported",
    inPlace: false,
    folderRoles: null,
  } as MemexInstance;
  const { id } = await createNoteForChat(instance, "harbor", "Velmora and the harbor", true);
  expect((await notesService.getNote(id))?.secure).toBe(true);
  await expect(createWebAiCorpus(() => notesService).read(id)).rejects.toThrow(/secure/);
});
