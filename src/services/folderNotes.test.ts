import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseNoteDocument } from "../lib/frontmatter";
import { today } from "../memex/contract";
import { DEST } from "./destinations";
import { FolderNotesService } from "./folderNotes";
import { MemoryVaultDir } from "./vaultDir";
import { FolderChatStore, webMemexBridge } from "./webChats";

const HERE = dirname(fileURLToPath(import.meta.url));
const SEED = join(HERE, "..", "..", "src-tauri", "demo-seed", "wiki");
const seedText = (rel: string): string => readFileSync(join(SEED, rel), "utf8");

const CAPTURES = ["_inbox/try-quick-capture.md", "_inbox/weekend-project.md"];
const CURATED = ["guides/welcome-to-rotli.md", "ideas/note-taking-that-lasts.md"];

/** A memex vault: the real demo-seed notes under wiki/, plus the empty
 * lifecycle sinks a Mac vault always has. */
async function memexVault(): Promise<MemoryVaultDir> {
  const dir = new MemoryVaultDir();
  for (const rel of [...CAPTURES, ...CURATED]) await dir.writeText(`wiki/${rel}`, seedText(rel));
  await dir.mkdir("wiki/_secure");
  await dir.mkdir("archive");
  await dir.mkdir("trash");
  return dir;
}

describe("listing a memex vault", () => {
  let dir: MemoryVaultDir;
  let notes: FolderNotesService;

  beforeEach(async () => {
    dir = await memexVault();
    notes = new FolderNotesService(dir);
  });

  test("listAll projects wiki/_inbox captures to Captures and keeps the disk folder", async () => {
    const all = await notes.listAll();
    expect(all).toHaveLength(4);
    const capture = all.find((n) => n.id === "demo-cap-quick");
    expect(capture?.folderId).toBe(DEST.board);
    expect(capture?.diskFolderId).toBe("wiki/_inbox");
    expect(capture?.title).toBe("Try Quick capture");
    const curated = all.find((n) => n.id === "demo-welcome");
    expect(curated?.folderId).toBe("wiki/guides");
    expect(curated?.pinned).toBe(true);
  });

  test("a wiki/_secure note is a Capture when shelved to Inbox and Secure otherwise", async () => {
    await dir.writeText(
      "wiki/_secure/quick.md",
      "---\nid: sec-capture\nsecure: true\nshelf: [Inbox]\n---\n# Quick secure\n",
    );
    await dir.writeText(
      "wiki/_secure/keys.md",
      "---\nid: sec-note\nsecure: true\nshelf: [Northstar]\n---\n# Keys\n",
    );
    const all = await notes.listAll();
    expect(all.find((n) => n.id === "sec-capture")?.folderId).toBe(DEST.board);
    expect(all.find((n) => n.id === "sec-note")?.folderId).toBe("wiki/_secure");
  });

  test("All Notes hides Captures while the Captures row shows them, newest first", async () => {
    const everything = await notes.listNotes();
    expect(everything.map((n) => n.id).sort()).toEqual(["demo-ideas", "demo-welcome"]);
    const captures = await notes.listNotes(DEST.board);
    expect(captures.map((n) => n.id)).toEqual(["demo-cap-quick", "demo-cap-weekend"]);
  });

  test("a wiki subfolder scopes to its own subtree", async () => {
    expect((await notes.listNotes("wiki/guides")).map((n) => n.id)).toEqual(["demo-welcome"]);
    expect((await notes.listNotes("wiki")).map((n) => n.id).sort()).toEqual(["demo-ideas", "demo-welcome"]);
  });

  test("search finds a body hit and getNote returns the raw body", async () => {
    const hits = await notes.searchNotes("dashboard that reads these notes");
    expect(hits.map((h) => h.id)).toEqual(["demo-cap-weekend"]);
    expect(hits[0]?.rank).toBe(2);
    const note = await notes.getNote("demo-cap-weekend");
    expect(note?.body.startsWith("# Weekend project idea")).toBe(true);
    expect(await notes.getNote("no-such-note")).toBeNull();
  });
});

describe("folders", () => {
  test("reserved rows, the wiki root, and every wiki directory are listed", async () => {
    const notes = new FolderNotesService(await memexVault());
    const folders = await notes.listFolders();
    for (const reserved of [DEST.inbox, DEST.secure, DEST.storage, DEST.board, DEST.archive, DEST.trash]) {
      expect(folders.find((f) => f.id === reserved)).toEqual({
        id: reserved,
        name: reserved,
        parentId: null,
      });
    }
    expect(folders.find((f) => f.id === "wiki")).toEqual({ id: "wiki", name: "wiki", parentId: null });
    expect(folders.find((f) => f.id === "wiki/guides")).toEqual({
      id: "wiki/guides",
      name: "guides",
      parentId: "wiki",
    });
  });

  test("createFolder makes a directory under wiki and deleteFolder removes an empty one", async () => {
    const dir = await memexVault();
    const notes = new FolderNotesService(dir);
    const folder = await notes.createFolder("northstar");
    expect(folder).toEqual({ id: "wiki/northstar", name: "northstar", parentId: "wiki" });
    expect(await dir.exists("wiki/northstar")).toBe(true);
    const nested = await notes.createFolder("payments", "wiki/northstar");
    expect(nested.id).toBe("wiki/northstar/payments");
    await notes.deleteFolder("wiki/northstar/payments");
    expect(await dir.exists("wiki/northstar/payments")).toBe(false);
  });

  test("deleting or renaming a folder with notes in it refuses", async () => {
    const notes = new FolderNotesService(await memexVault());
    await expect(notes.deleteFolder("wiki/guides")).rejects.toThrow("isn't empty");
    await expect(notes.updateFolder("wiki/guides", "manuals")).rejects.toThrow("isn't empty");
  });

  test("an empty folder renames on disk", async () => {
    const dir = await memexVault();
    const notes = new FolderNotesService(dir);
    await notes.createFolder("scratch");
    expect(await notes.updateFolder("wiki/scratch", "drafts")).toEqual({
      id: "wiki/drafts",
      name: "drafts",
      parentId: "wiki",
    });
    expect(await dir.exists("wiki/scratch")).toBe(false);
  });
});

describe("creating notes", () => {
  test("a new note lands in wiki/_inbox with a ULID id and a slugged stem", async () => {
    const dir = await memexVault();
    const notes = new FolderNotesService(dir);
    const note = await notes.createNote(DEST.inbox, "# Weekly plan\n\nship the thing\n");
    expect(note.folderId).toBe(DEST.board);
    expect(note.diskFolderId).toBe("wiki/_inbox");
    expect(note.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(note.title).toBe("Weekly plan");
    expect(await dir.exists("wiki/_inbox/weekly-plan.md")).toBe(true);
    const fm = parseNoteDocument(await dir.readText("wiki/_inbox/weekly-plan.md")).frontmatter;
    expect(fm?.id).toBe(note.id);
    expect(fm?.created).toBe(today());
    expect(fm?.foreign).toContain("shelf: [Inbox]");
    expect(await notes.getNote(note.id)).not.toBeNull();
  });

  test("a colliding stem becomes “ (2)”, then “ (3)”", async () => {
    const dir = await memexVault();
    const notes = new FolderNotesService(dir);
    await notes.createNote(DEST.inbox, "# Weekly plan\n");
    await notes.createNote(DEST.inbox, "# Weekly plan\n");
    const third = await notes.createNote(DEST.inbox, "# Weekly plan\n");
    expect(await dir.exists("wiki/_inbox/weekly-plan (2).md")).toBe(true);
    expect(third.diskFolderId).toBe("wiki/_inbox");
    expect(await dir.exists("wiki/_inbox/weekly-plan (3).md")).toBe(true);
  });

  test("a secure policy writes the secure flag into the file", async () => {
    const dir = await memexVault();
    const notes = new FolderNotesService(dir);
    await notes.createNote(DEST.inbox, "# Keys\n", { secure: true });
    const fm = parseNoteDocument(await dir.readText("wiki/_inbox/keys.md")).frontmatter;
    expect(fm?.foreign).toContain("secure: true");
  });
});

describe("the web's memex note lane (Rust write_note_at)", () => {
  const born = (id: string, extra = "") =>
    `---\nid: ${id}\ncreated: ${today()}\nupdated: ${today()}\nshelf: []\n${extra}---\n# Plan\n`;

  test("⌘N's note lands in wiki/_inbox while the Librarian is on, and opens by its id", async () => {
    const dir = await memexVault();
    const notes = new FolderNotesService(dir);
    const bridge = webMemexBridge(new FolderChatStore(dir), notes);
    expect(await bridge("memex_write_note", { stem: "plan", contents: born("01NEWNOTE") })).toBe(
      "wiki/_inbox/plan.md",
    );
    expect(await bridge("memex_write_note", { stem: "plan", contents: born("01NEWNOTE2") })).toBe(
      "wiki/_inbox/plan (2).md",
    );
    const note = await notes.getNote("01NEWNOTE");
    expect(note?.diskFolderId).toBe("wiki/_inbox");
    expect(note?.title).toBe("Plan");
  });

  test("with the Librarian off it lands at the wiki root; a secure note goes to _secure and .gitignore", async () => {
    const dir = await memexVault();
    await dir.writeText(".rotli/settings.json", JSON.stringify({ brainEnabled: false }));
    await dir.writeText(".gitignore", ".rotli/");
    const notes = new FolderNotesService(dir);
    expect(await notes.writeMemexNote("plan", born("01ROOT"))).toBe("wiki/plan.md");
    expect(await notes.writeMemexNote("keys", born("01SECURE", "secure: true\n"))).toBe(
      "wiki/_secure/keys.md",
    );
    expect(await dir.readText(".gitignore")).toBe(".rotli/\nwiki/_secure/keys.md\n");
    expect((await notes.getNote("01SECURE"))?.secure).toBe(true);
  });

  test("a plain folder's note lands at its root, and a stem that isn't a slug is refused", async () => {
    const dir = new MemoryVaultDir();
    await dir.writeText("todo.md", "# Todo\n");
    const notes = new FolderNotesService(dir);
    expect(await notes.writeMemexNote("plan", born("01PLAIN"))).toBe("plan.md");
    await expect(notes.writeMemexNote("../escape", born("01BAD"))).rejects.toThrow(/unsafe note stem/);
    expect(await dir.exists("wiki")).toBe(false);
  });

  test("the contract read answers missing files with empty text", async () => {
    const dir = await memexVault();
    await dir.writeText("users.json", '{"primary":"seth"}');
    const bridge = webMemexBridge(new FolderChatStore(dir), new FolderNotesService(dir));
    expect(await bridge("memex_read_contract", { root: "~/vault" })).toEqual({
      memexJson: "",
      usersJson: '{"primary":"seth"}',
      identitiesJson: "",
    });
    await expect(webMemexBridge(new FolderChatStore(dir))("memex_write_note", {})).rejects.toThrow(
      /no vault is connected/,
    );
  });
});

describe("updating notes", () => {
  test("a write changes the body and `updated`, and nothing else", async () => {
    const dir = await memexVault();
    const notes = new FolderNotesService(dir);
    const before = seedText("guides/welcome-to-rotli.md");
    const note = await notes.getNote("demo-welcome");
    await notes.updateNote("demo-welcome", "# Welcome to rotli\n\nrewritten.\n", note?.revision ?? "");
    const after = await dir.readText("wiki/guides/welcome-to-rotli.md");
    const parsed = parseNoteDocument(after);
    expect(parsed.body).toBe("# Welcome to rotli\n\nrewritten.\n");
    expect(parsed.frontmatter?.updated).toBe(today());
    expect(parsed.frontmatter?.foreign).toEqual(parseNoteDocument(before).frontmatter?.foreign as string[]);
    expect(parsed.frontmatter?.created).toBe("2026-07-01");
    expect(parsed.frontmatter?.pinned).toBe(true);
  });

  test("a stale revision is refused unless the body still matches", async () => {
    const dir = await memexVault();
    const notes = new FolderNotesService(dir);
    const note = await notes.getNote("demo-ideas");
    await notes.updateNote("demo-ideas", "# Note-taking that lasts\n\none\n", note?.revision ?? "");
    await expect(
      notes.updateNote("demo-ideas", "# Note-taking that lasts\n\ntwo\n", note?.revision ?? ""),
    ).rejects.toThrow("revision conflict");
    await expect(notes.updateNote("demo-ideas", "# x\n", "")).rejects.toThrow("revision conflict");
    const fresh = await notes.getNote("demo-ideas");
    await notes.updateNote("demo-ideas", "# Note-taking that lasts\n\nthree\n", "stale:0", fresh?.body);
    expect((await notes.getNote("demo-ideas"))?.body).toBe("# Note-taking that lasts\n\nthree\n");
  });

  test("a note with no frontmatter stays fenceless when it is saved", async () => {
    const dir = new MemoryVaultDir();
    await dir.writeText("notes/plain.md", "# Plain\n\nno fence\n");
    const notes = new FolderNotesService(dir);
    const note = await notes.getNote("notes/plain.md");
    await notes.updateNote("notes/plain.md", "# Plain\n\nedited\n", note?.revision ?? "");
    expect(await dir.readText("notes/plain.md")).toBe("# Plain\n\nedited\n");
  });
});

describe("lifecycle", () => {
  test("trash keeps the original path beneath the sink and stamps origin", async () => {
    const dir = await memexVault();
    const notes = new FolderNotesService(dir);
    const trashed = await notes.trashNote("demo-cap-quick");
    expect(trashed.folderId).toBe(DEST.trash);
    expect(await dir.exists("trash/wiki/_inbox/try-quick-capture.md")).toBe(true);
    expect(await dir.exists("wiki/_inbox/try-quick-capture.md")).toBe(false);
    const fm = parseNoteDocument(await dir.readText("trash/wiki/_inbox/try-quick-capture.md")).frontmatter;
    expect(fm?.origin).toBe(DEST.board);
    expect(await notes.listNotes()).not.toContainEqual(expect.objectContaining({ id: "demo-cap-quick" }));
    expect((await notes.listNotes(DEST.trash)).map((n) => n.id)).toEqual(["demo-cap-quick"]);
  });

  test("restore returns the note and clears origin, changing nothing else in the file", async () => {
    const dir = await memexVault();
    const notes = new FolderNotesService(dir);
    const original = await dir.readText("wiki/_inbox/weekend-project.md");
    await notes.trashNote("demo-cap-weekend");
    const restored = await notes.restoreNote("demo-cap-weekend");
    expect(restored.folderId).toBe(DEST.board);
    expect(restored.diskFolderId).toBe("wiki/_inbox");
    const after = await dir.readText("wiki/_inbox/weekend-project.md");
    expect(parseNoteDocument(after).frontmatter?.origin).toBeNull();
    // the first write normalizes the hand-written seed, so the fixed point of
    // the codec — not the raw seed bytes — is what must survive the round trip
    const parsed = parseNoteDocument(original);
    expect(parseNoteDocument(after).body).toBe(parsed.body);
    expect(parseNoteDocument(after).frontmatter?.foreign).toEqual(parsed.frontmatter?.foreign as string[]);
    expect(parseNoteDocument(after).frontmatter?.updated).toBe("2026-07-05");
  });

  test("restore returns a curated note to its own wiki folder, not to Captures", async () => {
    const dir = await memexVault();
    const notes = new FolderNotesService(dir);
    await notes.trashNote("demo-welcome");
    const restored = await notes.restoreNote("demo-welcome");
    expect(restored.diskFolderId).toBe("wiki/guides");
    expect(restored.folderId).toBe("wiki/guides");
    expect(await dir.exists("wiki/guides/welcome-to-rotli.md")).toBe(true);
  });

  test("restore falls back to wiki/_inbox when the original directory is gone", async () => {
    const dir = await memexVault();
    const notes = new FolderNotesService(dir);
    await notes.trashNote("demo-welcome");
    await dir.remove("wiki/guides");
    expect(await dir.exists("wiki/guides")).toBe(false);
    const restored = await notes.restoreNote("demo-welcome");
    expect(restored.diskFolderId).toBe("wiki/_inbox");
    expect(await dir.exists("wiki/_inbox/welcome-to-rotli.md")).toBe(true);
  });

  test("archive uses its own sink and a move to a wiki folder moves the file", async () => {
    const dir = await memexVault();
    const notes = new FolderNotesService(dir);
    await notes.archiveNote("demo-ideas");
    expect(await dir.exists("archive/wiki/ideas/note-taking-that-lasts.md")).toBe(true);
    const moved = await notes.moveNote("demo-ideas", "wiki/guides");
    expect(moved.folderId).toBe("wiki/guides");
    expect(await dir.exists("wiki/guides/note-taking-that-lasts.md")).toBe(true);
    const fm = parseNoteDocument(await dir.readText("wiki/guides/note-taking-that-lasts.md")).frontmatter;
    expect(fm?.origin).toBeNull();
  });

  test("a move to a projection with no disk home rewrites the shelf line only", async () => {
    const dir = await memexVault();
    const notes = new FolderNotesService(dir);
    await notes.moveNote("demo-cap-quick", "Northstar");
    const fm = parseNoteDocument(await dir.readText("wiki/_inbox/try-quick-capture.md")).frontmatter;
    expect(fm?.foreign).toContain("shelf: [Northstar]");
    expect(await dir.exists("wiki/_inbox/try-quick-capture.md")).toBe(true);
  });

  test("two same-named notes trashed in turn both survive in the sink", async () => {
    const dir = await memexVault();
    const notes = new FolderNotesService(dir);
    const first = await notes.createNote(DEST.inbox, "# Weekly plan\n\none\n");
    await notes.trashNote(first.id);
    const second = await notes.createNote(DEST.inbox, "# Weekly plan\n\ntwo\n");
    await notes.trashNote(second.id);
    expect(await dir.readText("trash/wiki/_inbox/weekly-plan.md")).toContain("one");
    expect(await dir.readText("trash/wiki/_inbox/weekly-plan (2).md")).toContain("two");
    expect((await notes.listNotes(DEST.trash)).map((n) => n.id).sort()).toEqual([first.id, second.id].sort());
  });

  test("Empty Trash deletes the file for good", async () => {
    const dir = await memexVault();
    const notes = new FolderNotesService(dir);
    await notes.trashNote("demo-cap-quick");
    await notes.deleteNote("demo-cap-quick");
    expect(await dir.exists("trash/wiki/_inbox/try-quick-capture.md")).toBe(false);
    expect(await notes.getNote("demo-cap-quick")).toBeNull();
    await notes.deleteNote("demo-cap-quick");
  });
});

describe("renaming", () => {
  test("rename moves the file inside its directory and keeps the id", async () => {
    const dir = await memexVault();
    const notes = new FolderNotesService(dir);
    expect(await notes.renameFile("demo-welcome", "Start here")).toBe("demo-welcome");
    expect(await dir.exists("wiki/guides/Start here.md")).toBe(true);
    expect(await dir.exists("wiki/guides/welcome-to-rotli.md")).toBe(false);
  });

  test("rename refuses a name a sibling already holds", async () => {
    const dir = await memexVault();
    await dir.writeText("wiki/guides/taken.md", "---\nid: taken\n---\n# Taken\n");
    const notes = new FolderNotesService(dir);
    await expect(notes.renameFile("demo-welcome", "taken")).rejects.toThrow("already exists here");
    expect(await dir.exists("wiki/guides/welcome-to-rotli.md")).toBe(true);
  });
});

describe("a plain folder of Markdown files", () => {
  test("root notes list as Inbox and subfolders keep their path", async () => {
    const dir = new MemoryVaultDir();
    await dir.writeText("thoughts.md", "# Thoughts\n\nplain vault\n");
    await dir.writeText("work/plan.md", "# Plan\n\nquarterly\n");
    const notes = new FolderNotesService(dir);
    const all = await notes.listAll();
    expect(all.find((n) => n.id === "thoughts.md")?.folderId).toBe(DEST.inbox);
    expect(all.find((n) => n.id === "work/plan.md")?.folderId).toBe("work");
    expect((await notes.listNotes("work")).map((n) => n.id)).toEqual(["work/plan.md"]);
    const created = await notes.createNote(DEST.inbox, "# Fresh\n");
    expect(created.diskFolderId).toBe("");
    expect(await dir.exists("fresh.md")).toBe(true);
    expect((await notes.searchNotes("quarterly")).map((h) => h.id)).toEqual(["work/plan.md"]);
  });

  test("chats/ transcripts are indexed for the Library but stay out of All notes and search", async () => {
    const dir = new MemoryVaultDir();
    await dir.writeText("wiki/plan.md", "# Plan\n\nlaunch");
    await dir.writeText(
      "chats/planning.md",
      "---\nid: 2026-09-16-planning\ntitle: Planning\nsource: rotli\n---\n\n# Planning\n\n## Messages\n\n**you** · t — launch\n",
    );
    const svc = new FolderNotesService(dir);
    const all = await svc.listAll();
    const chat = all.find((n) => n.folderId === "chats");
    expect(chat?.title).toBe("Planning");
    expect(chat?.aliases?.[0]).toBe("planning");
    expect((await svc.listNotes()).some((n) => n.folderId === "chats")).toBe(false);
    expect((await svc.searchNotes("launch")).map((h) => h.folderId)).toEqual(["wiki"]);
  });
});
