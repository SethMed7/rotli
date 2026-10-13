// Named-view transaction twin of corpus.rs views_write_unlocked. Rollback
// restores only our own bytes; a newer external edit always wins.
import { composeNoteDocument, emptyFrontmatter, parseNoteDocument } from "../lib/frontmatter";
import { rotliMade, withTopLevelLine } from "../lib/frontmatterInPlace";
import { readVersionedFile, textRevision, writeVersionedFile } from "./folderFileIo";
import { updateGitExclusions } from "./folderMemexNotes";
import { FolderNotesService } from "./folderNotes";
import type { MainNode } from "./mainTree";
import { contentRevision, type VaultDir, vaultHasRotliMarker } from "./vaultDir";
import { VIEW_FOLDER_FORBIDDEN_CHARS, viewNameError, type ViewsManifest } from "./viewTree";

const broadRotliExclusions = [".rotli", ".rotli/"];

function membership(raw: string): Map<string, string> {
  const manifest = JSON.parse(raw || '{"version":1,"views":[]}') as ViewsManifest;
  if (manifest.version !== 1 || !Array.isArray(manifest.views))
    throw new Error("views format is not writable by this Rotli build");
  const names = new Set<string>();
  const members = new Map<string, string>();
  const walk = (nodes: MainNode[], name: string) => {
    if (!Array.isArray(nodes)) throw new Error("invalid view tree");
    for (const node of nodes) {
      if ("note" in node) {
        if (typeof node.note !== "string" || !node.note.trim() || members.has(node.note))
          throw new Error("item appears more than once across named views, or is empty");
        members.set(node.note, name);
      } else {
        if (
          typeof node.folder !== "string" ||
          !node.folder.trim() ||
          node.folder !== node.folder.trim() ||
          VIEW_FOLDER_FORBIDDEN_CHARS.some((ch) => node.folder.includes(ch))
        )
          throw new Error("invalid folder name in view");
        walk(node.children, name);
      }
    }
  };
  for (const view of manifest.views) {
    if (
      typeof view.name !== "string" ||
      view.name !== view.name.trim() ||
      viewNameError(view.name) ||
      names.has(view.name.toLowerCase())
    )
      throw new Error("invalid or duplicate view name");
    names.add(view.name.toLowerCase());
    walk(view.tree, view.name);
  }
  return members;
}

const contains = (nodes: MainNode[], id: string): boolean =>
  nodes.some((node) => ("note" in node ? node.note === id : contains(node.children, id)));

export async function writeFolderViews(
  dir: VaultDir,
  contents: string,
  expectedRevision: string,
): Promise<boolean> {
  const path = ".rotli/views.json";
  const currentRevision = await textRevision(dir, path);
  if (currentRevision !== expectedRevision) return false;
  const previous = (await dir.exists(path)) ? await dir.readText(path) : "";
  const next = membership(contents);
  let before: Map<string, string>;
  try {
    before = membership(previous);
  } catch {
    before = new Map();
  }
  const mainPath = ".rotli/main.json";
  const mainOpened = (await dir.exists(mainPath)) ? await readVersionedFile(dir, mainPath) : null;
  const main = JSON.parse(
    mainOpened?.contents && mainOpened.contents.trim() !== "{}"
      ? mainOpened.contents
      : '{"version":1,"tree":[]}',
  ) as { version: number; tree: MainNode[] };
  if (main.version !== 1 || !Array.isArray(main.tree))
    throw new Error("Main format is not writable by this Rotli build");
  let mainChanged = false;
  for (const id of next.keys())
    if (!contains(main.tree, id)) {
      main.tree.push({ note: id });
      mainChanged = true;
    }
  if (mainChanged) {
    const raw = `${JSON.stringify(main, null, 2)}\n`;
    await writeVersionedFile(dir, mainPath, raw, mainOpened?.revision ?? "0");
  }
  const notes = new FolderNotesService(dir);
  const written: { path: string; before: string; applied: string }[] = [];
  let manifestWritten = false;
  let ignoreRollback: { before: string | null; applied: string; safe: boolean } | null = null;
  // a folder opened in place: the person's notes gain only the view_tag line
  const inPlace = !(await vaultHasRotliMarker(dir));
  try {
    for (const id of new Set([...before.keys(), ...next.keys()])) {
      if (before.get(id) === next.get(id)) continue;
      const notePath = await notes.filePathOf(id).catch(() => null);
      if (!notePath?.endsWith(".md")) continue; // orphan, board, or binary
      const opened = await readVersionedFile(dir, notePath);
      const parsed = parseNoteDocument(opened.contents);
      const fm = parsed.frontmatter ?? emptyFrontmatter();
      const tag = next.get(id);
      const foreign = fm.foreign.filter((line) => line.split(":", 1)[0] !== "view_tag");
      if (tag) foreign.push(`view_tag: ${tag}`);
      const applied =
        inPlace && !rotliMade(parsed.frontmatter)
          ? withTopLevelLine(opened.contents, "view_tag", tag ?? null)
          : composeNoteDocument({ ...fm, foreign }, parsed.body);
      if (applied === opened.contents) continue;
      await writeVersionedFile(dir, notePath, applied, opened.revision);
      written.push({ path: notePath, before: opened.contents, applied });
    }
    if ((await textRevision(dir, path)) !== expectedRevision)
      throw new Error("revision conflict: views changed during write");
    if ((await dir.exists(".gitignore")) || (await dir.exists(".git"))) {
      // Narrow the directory exclusion so git can include the two projections.
      const hadIgnore = await dir.exists(".gitignore");
      const updated = await updateGitExclusions(
        dir,
        [".rotli/*", `!${mainPath}`, `!${path}`],
        broadRotliExclusions,
      );
      if (updated.after !== updated.before) {
        ignoreRollback = {
          before: hadIgnore || updated.before ? updated.before : null,
          applied: updated.after,
          safe: true,
        };
      }
    }
    await writeVersionedFile(dir, path, contents, expectedRevision);
    manifestWritten = true;
    return true;
  } catch (error) {
    if (ignoreRollback?.safe) {
      try {
        const current = await readVersionedFile(dir, ".gitignore");
        if (current.contents === ignoreRollback.applied) {
          if (ignoreRollback.before === null) await dir.remove(".gitignore", current.revision);
          else await writeVersionedFile(dir, ".gitignore", ignoreRollback.before, current.revision);
        }
      } catch {
        /* preserve a newer edit, or a path that became unwritable */
      }
    }
    for (const entry of written.reverse()) {
      try {
        const current = await readVersionedFile(dir, entry.path);
        if (current.contents === entry.applied)
          await writeVersionedFile(dir, entry.path, entry.before, current.revision);
      } catch {
        /* preserve a newer edit, or a path that became unwritable */
      }
    }
    if (manifestWritten) {
      const current = await readVersionedFile(dir, path);
      if (current.contents === contents) {
        if (previous) await writeVersionedFile(dir, path, previous, current.revision);
        else await dir.remove(path, contentRevision(contents));
      }
    }
    throw error;
  }
}
