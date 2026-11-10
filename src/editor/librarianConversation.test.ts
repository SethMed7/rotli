import { beforeEach, describe, expect, test } from "bun:test";

import type { VaultAction } from "../lib/librarianPeople";
import { DEFAULT_LIBRARIAN_RULES } from "../lib/librarianRules";
import { approved, approvedRows, person, promptOf } from "../lib/promptText.fixtures";
import type { ChatModelInfo } from "../lib/tauri";
import type { KeepDeps } from "../services/librarianPeople";
import { closeLibrarianChat, useLibrarianBar } from "../state/librarianBar";
import { NOT_WRITTEN, settleVault } from "./librarianKeep";
import type { LibrarianReads } from "./librarianSession";
import {
  applyProposal,
  librarianContext,
  PASSAGE_NOT_SAVED,
  sendToLibrarian,
  startOver,
  takeToChat,
  tauriHostFor,
} from "./librarianSession";
import { allow, context, fakeModel, MODEL, NOTE, start } from "./librarianSession.fixtures";
import * as model from "./model";
import { savedVersionMismatch } from "./savedVersion";

beforeEach(() => closeLibrarianChat());

// Fourth review of pull request 267 (#1): an on-device Librarian's permitted
// listing included a secure person; its reply named her; switched to a remote
// model, the next send carried that reply in its history. A conversation now
// remembers that it held text only an on-device model may read, and never
// goes to a remote model again. Since the sixth review secure People never
// reach the Librarian; these tests mark a conversation through its note.
describe("a conversation that held on-device-only text", () => {
  const LOCAL: ChatModelInfo = {
    ...MODEL,
    id: "local-gemma",
    label: "Gemma (on this Mac)",
    provider: "ollama",
    endpoint: "http://127.0.0.1:11434",
    api: "generate",
  };
  const SECURE_PERSON = "Velmora";
  /** The gate's answers: the on-device reader gets the note marked on-device
   * only, and a secure person the Librarian leaves out (sixth review: listing
   * People never marks a conversation); the remote reader gets neither. */
  const gated: LibrarianReads = {
    flush: async () => {},
    note: async (id, model) => ({
      id,
      revision: "r1",
      text: approved(NOTE),
      body: approved(NOTE),
      title: approved("Maya Chen"),
      onDeviceOnly: model.id === LOCAL.id,
    }),
    listing: async (model) => ({
      folderIds: [approved("wiki/People")],
      people: approvedRows(
        model.id === LOCAL.id
          ? [
              {
                id: "protected-person",
                title: SECURE_PERSON,
                snippet: "",
                folderId: "wiki/People",
                diskFolderId: "wiki/People",
                createdAt: 0,
                updatedAt: 0,
                pinned: false,
                kind: "note" as const,
                onDeviceOnly: true,
              },
            ]
          : [],
      ),
    }),
  };
  const ask = (text: string) => ({ text: person(text), highlight: null });

  async function onDeviceTurn() {
    start();
    const local = fakeModel(`${SECURE_PERSON}.`);
    await sendToLibrarian(
      "chat-1",
      ask("Who do I know?"),
      LOCAL,
      (m) => librarianContext("n1", m, gated),
      allow,
      local.hostFor,
    );
    expect(JSON.stringify(local.sent)).not.toContain(SECURE_PERSON);
    expect(useLibrarianBar.getState().chat?.onDeviceOnly).toBe(true);
  }

  test("is refused on a remote model with zero remote calls, in plain words, with the one action", async () => {
    await onDeviceTurn();
    const remote = fakeModel("Noted.");
    const outcome = await sendToLibrarian(
      "chat-1",
      ask("Continue"),
      MODEL,
      (m) => librarianContext("n1", m, gated),
      allow,
      remote.hostFor,
    );
    expect(outcome).toBe("onDeviceOnly");
    expect(remote.sent).toEqual([]);
    const chat = useLibrarianBar.getState().chat;
    expect(chat?.error).toBe(
      "This conversation includes notes only an on-device model can read. Start a new one to use Claude Opus.",
    );
    expect(chat?.restartWith).toBe(MODEL.id);
    // the refused message never joined the conversation
    expect(chat?.turns.filter((turn) => turn.role === "user")).toHaveLength(1);
    // the one action: a new conversation, the words back in its composer
    startOver(chat!, MODEL.id, "Continue");
    const fresh = useLibrarianBar.getState().chat;
    expect(fresh?.id).not.toBe("chat-1");
    expect([fresh?.modelId, fresh?.turns.length, fresh?.draft, fresh?.onDeviceOnly]).toEqual([
      MODEL.id,
      0,
      "Continue",
      undefined,
    ]);
  });

  test("keeps going on an on-device model", async () => {
    await onDeviceTurn();
    const local = fakeModel("Done.");
    expect(
      await sendToLibrarian(
        "chat-1",
        ask("And?"),
        LOCAL,
        (m) => librarianContext("n1", m, gated),
        allow,
        local.hostFor,
      ),
    ).toBe("sent");
    expect(local.sent).toHaveLength(1);
  });

  test("the live host refuses a remote call for it too (the backstop)", async () => {
    await onDeviceTurn();
    await expect(
      tauriHostFor(MODEL).complete({ messages: [{ role: "user", content: promptOf("Continue") }] }),
    ).rejects.toThrow(/secure-note content/);
  });

  test("Open in Chat hands the mark over: the new chat is born secure-context", async () => {
    await onDeviceTurn();
    const opened: unknown[] = [];
    await takeToChat(
      "n1",
      { text: "Continue", highlight: null },
      useLibrarianBar.getState().chat?.onDeviceOnly === true,
      async (id, opts) => {
        opened.push([id, opts]);
        return true;
      },
    );
    expect(opened).toEqual([["n1", { create: true, secureContext: true }]]);
    // an ordinary conversation hands over nothing extra
    start("chat-2");
    opened.length = 0;
    await takeToChat("n1", null, useLibrarianBar.getState().chat?.onDeviceOnly === true, async (id, opts) => {
      opened.push([id, opts]);
      return true;
    });
    expect(opened).toEqual([["n1", { create: true }]]);
  });

  // Fifth review (#3): the Librarian bar closes as it sends, and its question
  // lived only in the bar, so a refusal lost it and the restart had nothing.
  test("a refused question from the bar is kept, and the restart puts it back with no old history", async () => {
    await onDeviceTurn();
    const remote = fakeModel("Noted.");
    await sendToLibrarian(
      "chat-1",
      ask("What about the harbor lease?"),
      MODEL,
      (m) => librarianContext("n1", m, gated),
      allow,
      remote.hostFor,
    );
    const chat = useLibrarianBar.getState().chat!;
    expect(remote.sent).toEqual([]);
    expect(chat.draft).toBe("What about the harbor lease?");
    startOver(chat, chat.restartWith!, chat.draft!);
    const fresh = useLibrarianBar.getState().chat!;
    expect([fresh.draft, fresh.turns.length, fresh.modelId]).toEqual([
      "What about the harbor lease?",
      0,
      MODEL.id,
    ]);
  });

  // Fifth review (#2): a marked conversation writes nothing where a remote
  // model could read it: no People notes, rules or groups, no answered
  // question, no proposal into the open note (never secure).
  test("writes nothing unprotected, and says so", async () => {
    await onDeviceTurn();
    const written: string[] = [];
    const deps: KeepDeps = {
      rules: () => structuredClone(DEFAULT_LIBRARIAN_RULES),
      setRules: () => void written.push("rules"),
      saveRules: async () => void written.push("rules saved"),
      createNote: async () => (written.push("person note"), "01NEW"),
      notePath: async (id) => `wiki/People/${id}.md`,
      log: async () => {},
      apply: async () => (written.push("update"), 1),
      refresh: async () => {},
      existingPerson: async () => null,
    };
    const reply = useLibrarianBar.getState().chat!.turns[1]!;
    const vault: VaultAction[] = [
      { type: "person", name: "Velmora", area: "People/Work", about: "A harbor pilot.", tags: [] },
      { type: "rule", text: "Notes about Velmora go to People/Work" },
    ];
    await settleVault("chat-1", reply.id, vault, "local-gemma", reply.protection!, deps);
    expect(written).toEqual([]);
    const kept = useLibrarianBar.getState().chat!.turns[1]!.kept;
    expect(kept).toEqual({ kind: "kept", lines: [{ text: NOT_WRITTEN, failed: true }] });
    let applied = 0;
    await applyProposal(
      "chat-1",
      reply.id,
      [{ type: "tag", tags: ["velmora"] }],
      { id: "n1", title: "Maya Chen", model: "local-gemma" },
      async () => ++applied,
    );
    expect(applied).toBe(0);
    expect(useLibrarianBar.getState().chat!.error).toBe(NOT_WRITTEN);
  });
});

// Fourth review (#2): flushNote returned at once while a fired timer's save
// was still out, so the Librarian read the previous version; and a passage
// highlighted after the last save silently dropped out of the request.
describe("the Librarian reads the note as just saved", () => {
  test("waits for a save already running", async () => {
    const id = "review4-flight";
    const old = "# Old title\n\nold body";
    const fresh = "# New title\n\njust typed";
    let disk = old;
    let release!: () => void;
    const delayed = new Promise<void>((resolve) => {
      release = resolve;
    });
    model.ensureDocument(id, old, "r1");
    model.setWriteNoteBodyForTests(async () => {
      await delayed;
      disk = fresh;
    });
    model.setDocumentText(id, fresh);
    const saving = model.flushNote(id); // the autosave (or a pane switch) started the write
    const reads: LibrarianReads = {
      flush: model.flushNote,
      saved: () => null,
      note: async (noteId) => ({
        id: noteId,
        revision: "r2",
        text: approved(disk),
        body: approved(disk),
        title: approved(disk.split("\n")[0]!),
        onDeviceOnly: false,
      }),
      listing: async () => ({ folderIds: [], people: [] }),
    };
    let readBeforeSaved = false;
    const reading = librarianContext(id, MODEL, reads).then((ctx) => {
      readBeforeSaved = disk === old;
      return ctx;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    release();
    const ctx = await reading;
    await saving;
    model.evictDocument(id);
    model.setWriteNoteBodyForTests(null);
    expect(readBeforeSaved).toBe(false);
    expect(String(ctx.doc)).toBe(fresh);
  });

  test("a failed save is said in its own words, and nothing is read or sent", async () => {
    const id = "review4-failed";
    model.ensureDocument(id, "# Plan\n\nold", "r1");
    model.setWriteNoteBodyForTests(() => Promise.reject(new Error("The disk is full.")));
    model.setDocumentText(id, "# Plan\n\nnew");
    const asked: string[] = [];
    const reads: LibrarianReads = {
      flush: model.flushNote,
      note: async () => {
        asked.push("note");
        throw new Error("never read");
      },
      listing: async () => ({ folderIds: [], people: [] }),
    };
    start();
    useLibrarianBar.setState((s) => ({ chat: s.chat && { ...s.chat, noteId: id } }));
    const host = fakeModel("Done.");
    await sendToLibrarian(
      "chat-1",
      { text: person("Tag it"), highlight: null },
      MODEL,
      (m) => librarianContext(id, m, reads),
      allow,
      host.hostFor,
    );
    model.evictDocument(id);
    model.setWriteNoteBodyForTests(null);
    expect(useLibrarianBar.getState().chat?.error).toBe("The disk is full.");
    expect(asked).toEqual([]);
    expect(host.sent).toEqual([]);
  });

  test("a read that isn't the editor's saved version sends nothing: still saving", async () => {
    const id = "review4-stale";
    model.ensureDocument(id, "# Plan\n\nas the editor saved it", "r-editor");
    const reads: LibrarianReads = {
      flush: async () => {},
      saved: savedVersionMismatch,
      note: async (noteId) => ({
        id: noteId,
        revision: "r-older",
        text: approved("# Plan\n\nan older version"),
        body: approved("# Plan\n\nan older version"),
        title: approved("Plan"),
        onDeviceOnly: false,
      }),
      listing: async () => ({ folderIds: [], people: [] }),
    };
    await expect(librarianContext(id, MODEL, reads)).rejects.toThrow("Still saving. Try again in a moment.");
    model.evictDocument(id);
  });

  test("a passage highlighted after the last save is a refusal with words, never dropped", async () => {
    start();
    const host = fakeModel("Done.");
    const highlight = { exact: "typed after the save", prefix: "", suffix: "" };
    await sendToLibrarian(
      "chat-1",
      { text: person("Mark this"), highlight },
      MODEL,
      context,
      allow,
      host.hostFor,
    );
    expect(host.sent).toEqual([]);
    expect(useLibrarianBar.getState().chat?.error).toBe(PASSAGE_NOT_SAVED);
  });
});
