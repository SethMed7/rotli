import { beforeEach, expect, test } from "bun:test";

import { buildWikilinkIndex, resolveWikilink } from "../editor/wikilink";
import { BrowserVault } from "../lib/browserVault";
import { FolderVaultStore } from "../lib/folderVaultStore";
import { parseNoteDocument } from "../lib/frontmatter";
import {
  corpusSetAiEdit,
  corpusSetLocalAiAccess,
  corpusSetLocked,
  corpusSetSecure,
} from "../lib/noteProtection";
import {
  corpusFileStat,
  corpusCreateManagedFile,
  corpusDiscardPristineManagedFile,
  corpusMoveFileToSink,
  corpusRestoreFile,
  corpusFrontmatter,
  corpusFileText,
  corpusRawFrontmatter,
  corpusWriteFileBytes,
  corpusWriteFrontmatterRaw,
  fileAssetUrl,
} from "../lib/tauri";
import { FolderNotesService } from "./folderNotes";
import { contentRevision } from "./vaultDir";
import { MemoryVaultDir } from "./vaultDir";
import { createWebAiCorpus } from "./webAiCorpus";
import { configureWebVaultIo } from "./webVaultIo";

let dir: MemoryVaultDir;
let notes: FolderNotesService;
const original =
  "---\nid: durable\ncreated: 2026-01-01\nowner: person\ncustom: keep me\n---\n# First title\n\nBody stays.\n";
beforeEach(async () => {
  dir = new MemoryVaultDir();
  await dir.writeText("wiki/first-title.md", original);
  notes = new FolderNotesService(dir);
  configureWebVaultIo(dir, notes);
});

test("web protection controls write durable metadata and secure home; AI excludes it", async () => {
  await corpusSetLocked("durable", true);
  await corpusSetAiEdit("durable", false);
  await corpusSetSecure("durable", true);
  await notes.listAll();
  await corpusSetLocalAiAccess("durable", false);
  const path = await notes.filePathOf("durable");
  expect(path).toBe("wiki/_secure/first-title.md");
  const text = await dir.readText(path);
  for (const line of [
    "locked: true",
    "ai_edit: false",
    "secure: true",
    "local_ai_allowed: false",
    "custom: keep me",
    "secure_origin: wiki",
  ])
    expect(text).toContain(line);
  expect(await dir.readText(".gitignore")).toContain(path);
  const ai = createWebAiCorpus(() => notes);
  expect(await ai.readableIds(["durable"])).toEqual([]);
  expect(await ai.search("First title", 10)).toEqual([]);
  await expect(ai.read("durable")).rejects.toThrow(/secure/);
  const protection = await corpusFrontmatter("durable");
  expect(protection?.localAiAllowed).toBe(false);
  expect(protection?.locked).toBe(true);
  expect(protection?.fields).toContain("custom: keep me");
  await corpusSetSecure("durable", false);
  await notes.listAll();
  expect(await notes.filePathOf("durable")).toBe("wiki/first-title.md");
  expect(await dir.readText("wiki/first-title.md")).not.toContain("secure:");
});

test("raw metadata is versioned, persists foreign edits, and refuses stale/reserved edits", async () => {
  const opened = await corpusRawFrontmatter("durable");
  expect(opened.contents).toContain("custom: keep me");
  const revision = await corpusWriteFrontmatterRaw(
    "durable",
    opened.contents.replace("keep me", "changed"),
    opened.revision,
  );
  expect(await dir.readText("wiki/first-title.md")).toContain("custom: changed");
  expect(parseNoteDocument(await dir.readText("wiki/first-title.md")).body).toBe(
    parseNoteDocument(original).body,
  );
  await expect(corpusWriteFrontmatterRaw("durable", opened.contents, opened.revision)).rejects.toThrow(
    /revision conflict/,
  );
  await expect(
    corpusWriteFrontmatterRaw("durable", opened.contents.replace("id: durable", "id: hacked"), revision),
  ).rejects.toThrow(/managed|reserved/);
});

test("views assignment, reassignment, rename and Main only sync notes, never boards", async () => {
  await dir.writeText("storage/excalidraw/map.excalidraw", "board bytes");
  const vault = new BrowserVault(new FolderVaultStore(dir));
  let revision = (await vault.readVersioned("views")).revision;
  for (const name of ["Work", "Home", "Renamed"]) {
    revision = await vault.writeVersioned(
      "views",
      JSON.stringify({
        version: 1,
        views: [{ name, tree: [{ note: "durable" }, { note: "storage/excalidraw/map.excalidraw" }] }],
      }),
      revision,
    );
    expect(await dir.readText("wiki/first-title.md")).toContain(`view_tag: ${name}`);
    expect(await dir.readText("storage/excalidraw/map.excalidraw")).toBe("board bytes");
    expect(await dir.readText(".rotli/main.json")).toContain("durable");
  }
  await vault.writeVersioned("views", '{"version":1,"views":[]}', revision);
  expect(await dir.readText("wiki/first-title.md")).not.toContain("view_tag:");
});

test("failed view note writes roll back note bytes and leave the manifest", async () => {
  await dir.writeText("wiki/second.md", "---\nid: second\n---\n# Second\n");
  const write = dir.writeText.bind(dir);
  dir.writeText = async (path, text) => {
    if (path === "wiki/second.md") throw new Error("disk refused");
    await write(path, text);
  };
  const vault = new BrowserVault(new FolderVaultStore(dir));
  await expect(
    vault.writeVersioned(
      "views",
      '{"version":1,"views":[{"name":"Work","tree":[{"note":"durable"},{"note":"second"}]}]}',
      "0",
    ),
  ).rejects.toThrow("disk refused");
  expect(await dir.readText("wiki/first-title.md")).toBe(original);
  expect(await dir.exists(".rotli/views.json")).toBe(false);
});

test("imported aliases resolve and links survive two title renames", async () => {
  await dir.writeText(
    "wiki/first-title.md",
    original.replace("custom: keep me", 'aliases: ["Imported selector"]'),
  );
  let note = (await notes.getNote("durable"))!;
  expect(resolveWikilink("Imported selector", buildWikilinkIndex(await notes.listAll()))).toBe("durable");
  note = await notes.updateNote(note.id, "# Second name\n", note.revision);
  note = await notes.updateNote(note.id, "# Third name\n", note.revision);
  expect(note.aliases).toContain("First title");
  expect(note.aliases).toContain("Second name");
  expect(await notes.filePathOf(note.id)).toBe("wiki/third-name.md");
});

test("mixed files list and search by stat alone, outside the text index", async () => {
  for (const path of [
    "storage/images/photo.png",
    "storage/movie.mp4",
    "storage/rows.csv",
    "storage/offline.html",
    "storage/report.pdf",
    "storage/report.docx",
    "storage/budget.xlsx",
    "wiki/chart.png",
    ".rotli/secret.csv",
    ".git/secret.png",
    "identity/secret.png",
    "storage/.hidden.png",
    "memex.json",
  ])
    await dir.writeText(path, "private binary fixture");
  const read = dir.readText.bind(dir);
  dir.readText = async (path) => {
    if (!path.endsWith(".md")) throw new Error(`binary read: ${path}`);
    return read(path);
  };
  const all = await notes.listAll();
  expect(
    all
      .filter((n) => n.kind === "file")
      .map((n) => n.title)
      .sort(),
  ).toEqual([
    "budget.xlsx",
    "chart.png",
    "movie.mp4",
    "offline.html",
    "photo.png",
    "report.docx",
    "report.pdf",
    "rows.csv",
  ]);
  expect((await notes.searchNotes("photo.png")).map((n) => n.id)).toEqual(["storage/images/photo.png"]);
  expect(await notes.getNote("storage/images/photo.png")).toBeNull();
  expect(await notes.searchNotes("private binary fixture")).toEqual([]);
});

test("web file bytes/text/stat are real and CSV saves refuse stale revisions", async () => {
  await dir.writeText("storage/data.csv", "name,value\none,1\n");
  const stat = (await corpusFileStat("storage/data.csv"))!;
  expect(stat?.writable).toBe(true);
  expect(stat.revision).toBe(contentRevision("name,value\none,1\n"));
  expect(await corpusFileText("storage/data.csv")).toBe("name,value\none,1\n");
  const url = await fileAssetUrl("storage/data.csv", true);
  expect(url).toStartWith("blob:");
  URL.revokeObjectURL(url);
  const revision = await corpusWriteFileBytes(
    "storage/data.csv",
    btoa("name,value\ntwo,2\n"),
    false,
    stat.revision,
  );
  expect(await dir.readText("storage/data.csv")).toContain("two,2");
  expect(revision).not.toBe(stat.revision);
  await expect(
    corpusWriteFileBytes("storage/data.csv", btoa("clobber"), false, stat.revision),
  ).rejects.toThrow(/revision conflict/);
});

test("metadata and protection follow the refreshed note service after an external move", async () => {
  let active = notes;
  configureWebVaultIo(dir, () => active);
  await dir.move("wiki/first-title.md", "wiki/moved.md");
  active = new FolderNotesService(dir);
  expect((await corpusRawFrontmatter("durable")).contents).toContain("custom: keep me");
  await corpusSetLocked("durable", true);
  expect(await dir.readText("wiki/moved.md")).toContain("locked: true");
});

test("web corpus route creates managed bytes and refuses to discard changed bytes", async () => {
  const id = await corpusCreateManagedFile("Draft.docx", btoa("original"));
  expect(id).toBe("storage/rotli/Draft.docx");
  expect(await dir.readText(id)).toBe("original");
  await dir.writeText(id, "changed");
  await expect(corpusDiscardPristineManagedFile(id)).rejects.toThrow(/revision conflict/);
  expect(await dir.readText(id)).toBe("changed");
  const next = await corpusCreateManagedFile("Draft.docx", btoa("other"));
  expect(next).toBe("storage/rotli/Draft-2.docx");
  await corpusDiscardPristineManagedFile(next);
  expect(await dir.exists(next)).toBe(false);
});

test("ordinary web file lifecycle moves to Trash and restores its original path", async () => {
  await dir.writeBytes("storage/manual.xlsx", new Uint8Array([7]));
  const trashed = await corpusMoveFileToSink("storage/manual.xlsx", "Trash");
  expect(trashed).toBe("trash/storage/manual.xlsx");
  expect(await dir.exists(trashed)).toBe(true);
  expect(await corpusRestoreFile(trashed)).toBe("storage/manual.xlsx");
  expect(await dir.readBytes("storage/manual.xlsx")).toEqual(new Uint8Array([7]));
});
