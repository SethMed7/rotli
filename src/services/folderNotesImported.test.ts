import { afterEach, describe, expect, test } from "bun:test";

import { DEST, IMPORTED_FOLDER_ROLES, setFolderRoles } from "./destinations";
import { setFolderSecure } from "./folderMetadata";
import { FolderNotesService } from "./folderNotes";
import { MemoryVaultDir, vaultOpenedInPlace } from "./vaultDir";
import { FolderChatStore } from "./webChats";

// An imported vault (slice 4) on Rotli Web: the copy's tree is the person's.
// Its wiki/ is no memex spine, its Archive/ no sink, and names are kept.
describe("an imported vault", () => {
  async function importedVault(): Promise<MemoryVaultDir> {
    const dir = new MemoryVaultDir();
    const marker = {
      id: "mx_webcopy07",
      contract: "3.9",
      layout: "imported",
      folders: IMPORTED_FOLDER_ROLES,
    };
    await dir.writeText("memex.json", `${JSON.stringify(marker)}\n`);
    await dir.writeText("wiki/Sourdough.md", "# Sourdough\n");
    await dir.writeText("history/1999.md", "# 1999\n");
    await dir.writeText("Archive/Last spring.md", "# Last spring\n");
    await dir.writeText("Hikes/Trail notes.md", "# Trail\n\nSee [[Last spring]].\n");
    return dir;
  }

  afterEach(() => setFolderRoles(null));

  test("shows every folder, keeps the person's Archive plain, and trashes into Rotli's own", async () => {
    const dir = await importedVault();
    const notes = new FolderNotesService(dir);
    const all = await notes.listAll();
    const folderOf = (title: string) => all.find((n) => n.title === title)?.folderId;
    expect(folderOf("Sourdough")).toBe("wiki");
    expect(folderOf("1999")).toBe("history");
    expect(folderOf("Last spring")).toBe("Archive");
    expect((await notes.listNotes()).map((n) => n.title)).toContain("Last spring");

    const trail = all.find((n) => n.title === "Trail");
    if (!trail) throw new Error("missing fixture note");
    await notes.trashNote(trail.id);
    expect(await dir.exists("Trash (Rotli)/Hikes/Trail notes.md")).toBe(true);
    expect(await dir.exists("Trash/Trail notes.md")).toBe(false);
  });

  test("a save keeps the note's file name, so Obsidian links still resolve", async () => {
    const dir = await importedVault();
    const notes = new FolderNotesService(dir);
    const trail = (await notes.listAll()).find((n) => n.title === "Trail");
    if (!trail) throw new Error("missing fixture note");
    const note = await notes.getNote(trail.id);
    await notes.updateNote(trail.id, "# Renamed heading\n\nmore\n", note?.revision ?? "");
    expect(await dir.exists("Hikes/Trail notes.md")).toBe(true);
  });

  test("a move into the person's own Archive is an ordinary move", async () => {
    const dir = await importedVault();
    const notes = new FolderNotesService(dir);
    const trail = (await notes.listAll()).find((n) => n.title === "Trail");
    if (!trail) throw new Error("missing fixture note");
    const moved = await notes.moveNote(trail.id, "Archive");
    expect(moved.folderId).toBe("Archive");
    expect(await dir.exists("Archive/Trail notes.md")).toBe(true);
    expect(await dir.exists("archive/Hikes/Trail notes.md")).toBe(false);
    expect(await dir.readText("Archive/Trail notes.md")).not.toContain("origin:");
  });

  test("a new note lands in the top-level Inbox", async () => {
    const dir = await importedVault();
    const notes = new FolderNotesService(dir);
    const note = await notes.createNote(DEST.inbox, "# Brand new\n");
    expect(note.folderId).toBe("Inbox");
  });

  test("restore sends a trashed note back to the folder it came from", async () => {
    const dir = await importedVault();
    const notes = new FolderNotesService(dir);
    const trail = (await notes.listAll()).find((n) => n.title === "Trail");
    if (!trail) throw new Error("missing fixture note");
    const trashed = await notes.trashNote(trail.id);
    const restored = await notes.restoreNote(trashed.id);
    expect(restored.folderId).toBe("Hikes");
    expect(await dir.exists("Hikes/Trail notes.md")).toBe(true);
  });

  test("the marker is never a file row, and secure stays where the note is", async () => {
    const dir = await importedVault();
    const notes = new FolderNotesService(dir);
    expect((await notes.listAll()).some((n) => n.id === "memex.json")).toBe(false);
    await setFolderSecure(dir, "wiki/Sourdough.md", true);
    expect(await dir.exists("wiki/Sourdough.md")).toBe(true);
    expect(await dir.exists("wiki/_secure")).toBe(false);
  });

  test("a chat is kept in Rotli's own chats folder, never the person's", async () => {
    const dir = await importedVault();
    const chats = new FolderChatStore(dir);
    await chats.write("pancakes", "---\ntitle: Pancakes\n---\n", null);
    expect(await dir.exists(`${IMPORTED_FOLDER_ROLES.chats}/pancakes.md`)).toBe(true);
    expect(await dir.exists("chats/pancakes.md")).toBe(false);
  });

  test("a memex note write never grows a wiki/ lane: it lands in the Inbox", async () => {
    const dir = await importedVault();
    const notes = new FolderNotesService(dir);
    const path = await notes.writeMemexNote(
      "chat-note",
      "---\nid: 01JWEBCHATNOTE000000000000\n---\n# Chat note\n",
    );
    expect(path).toBe("Inbox/chat-note.md");
    expect(await dir.exists("wiki/_inbox")).toBe(false);
  });
});

// Decision I (owner, 2026-10-15): a folder connected in place gets the same
// marker as a copy plus `"inPlace": true`. Rotli Web reads that field — not
// "no marker" — to keep the person's notes exactly as they wrote them.
describe("a folder connected in place", () => {
  async function inPlaceVault(inPlace: boolean): Promise<MemoryVaultDir> {
    const dir = new MemoryVaultDir();
    const marker = {
      id: "mx_webinplace",
      contract: "3.9",
      layout: "imported",
      folders: IMPORTED_FOLDER_ROLES,
    };
    await dir.writeText("memex.json", JSON.stringify(inPlace ? { ...marker, inPlace: true } : marker));
    await dir.writeText("Hikes/Trail notes.md", "# Trail\n\nOld.\n");
    return dir;
  }

  afterEach(() => setFolderRoles(null));

  test("is detected from the marker's field, and a copy or a Rotli vault is not", async () => {
    expect(await vaultOpenedInPlace(await inPlaceVault(true))).toBe(true);
    expect(await vaultOpenedInPlace(await inPlaceVault(false))).toBe(false);
    const plain = new MemoryVaultDir();
    expect(await vaultOpenedInPlace(plain)).toBe(true);
    await plain.writeText("memex.json", JSON.stringify({ id: "mx_rotli" }));
    expect(await vaultOpenedInPlace(plain)).toBe(false);
  });

  test("a save stamps nothing on the person's note", async () => {
    const dir = await inPlaceVault(true);
    const notes = new FolderNotesService(dir);
    const trail = (await notes.listAll()).find((n) => n.title === "Trail");
    if (!trail) throw new Error("missing fixture note");
    const note = await notes.getNote(trail.id);
    await notes.updateNote(trail.id, "# Trail\n\nNew.\n", note?.revision ?? "");
    expect(await dir.readText("Hikes/Trail notes.md")).toBe("# Trail\n\nNew.\n");
  });

  test("trash uses Rotli's own trash there too", async () => {
    const dir = await inPlaceVault(true);
    const notes = new FolderNotesService(dir);
    const trail = (await notes.listAll()).find((n) => n.title === "Trail");
    if (!trail) throw new Error("missing fixture note");
    await notes.trashNote(trail.id);
    expect(await dir.exists("Trash (Rotli)/Hikes/Trail notes.md")).toBe(true);
  });
});
