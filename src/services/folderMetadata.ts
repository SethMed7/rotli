// The web twin of the corpus protection and raw-metadata commands.
import { looksSecret } from "../ai/guard";
import {
  composeNoteDocument,
  emptyFrontmatter,
  isSecureFrontmatter,
  parseNoteDocument,
  type NoteFrontmatter,
} from "../lib/frontmatter";
import { composeInPlace, rotliMade, withSecureLineOnly } from "../lib/frontmatterInPlace";
import { mergeRawFrontmatter, rawFrontmatterBlock } from "../lib/frontmatterRaw";
import { SECURE_NOTES_FOLDER } from "../security/secureNotes";
import { assertVaultFilePath, readVersionedFile, writeVersionedFile } from "./folderFileIo";
import { updateGitExclusions } from "./folderMemexNotes";
import {
  type VaultDir,
  baseName,
  freeVaultPath,
  parentPath,
  vaultHasRotliMarker,
  vaultIsMemex,
} from "./vaultDir";

const valueOf = (fm: NoteFrontmatter, key: string): string | undefined => {
  const line = fm.foreign.find((line) => line.slice(0, line.indexOf(":")).trim() === key);
  return line?.slice(line.indexOf(":") + 1).trim();
};
const withField = (fm: NoteFrontmatter, key: string, value: string | null): NoteFrontmatter => ({
  ...fm,
  foreign: [
    ...fm.foreign.filter((line) => line.split(":", 1)[0]?.trim() !== key),
    ...(value === null ? [] : [`${key}: ${value}`]),
  ],
});

function assertSecureRemoval(body: string): void {
  if (looksSecret(body))
    throw new Error("Remove the detected secret from the note before removing secure protection");
}

/** Returns the resulting path for relocation bookkeeping. Identity is stable;
 * protect the target BEFORE moving, and leave the old ignore on any failure. */
export async function setFolderSecure(dir: VaultDir, path: string, secure: boolean): Promise<string> {
  const opened = await readVersionedFile(dir, path);
  const { frontmatter, body } = parseNoteDocument(opened.contents);
  let fm = frontmatter ?? emptyFrontmatter();
  if (!secure) assertSecureRemoval(body);
  if (!(await vaultHasRotliMarker(dir))) {
    // A folder opened in place keeps the note where it is (owner rule
    // 2026-10-13): only the secure line changes, and its ignore line protects
    // the path. Protect before the write, unprotect after.
    if (secure) await updateGitExclusions(dir, [path]);
    await writeVersionedFile(dir, path, withSecureLineOnly(opened.contents, secure), opened.revision);
    if (!secure) await updateGitExclusions(dir, [], [path]);
    return path;
  }
  if (!fm.id) throw new Error("secure notes require a stable frontmatter id");
  const home = (await vaultIsMemex(dir)) ? "wiki/_secure" : SECURE_NOTES_FOLDER;
  const current = parentPath(path);
  const inHome = current === home || current.startsWith(`${home}/`);
  if (secure) {
    if (!inHome && valueOf(fm, "secure_origin") === undefined) fm = withField(fm, "secure_origin", current);
    fm = withField(fm, "secure", "true");
    await updateGitExclusions(dir, [path]);
    await writeVersionedFile(dir, path, composeNoteDocument(fm, body), opened.revision);
  }
  const origin = valueOf(fm, "secure_origin");
  const targetHome = secure
    ? home
    : origin !== undefined && origin !== home && !origin.startsWith(`${home}/`)
      ? origin
      : (await vaultIsMemex(dir))
        ? "wiki/_inbox"
        : "Inbox";
  let target = path;
  if (secure ? !inHome : inHome) {
    target = await freeVaultPath(dir, targetHome, baseName(path), (stem, ext, n) => `${stem} (${n})${ext}`);
    assertVaultFilePath(target);
    await updateGitExclusions(dir, [target]);
    // Both writes used the opening revision; re-read before relocation.
    const currentFile = await readVersionedFile(dir, path);
    const expected = secure ? composeNoteDocument(fm, body) : opened.contents;
    if (currentFile.contents !== expected)
      throw new Error("revision conflict: secure note changed before move");
    await dir.move(path, target);
    await updateGitExclusions(dir, [], [path]).catch(() => {
      // The move landed; retaining an obsolete exclusion is safer than
      // reporting failure after the caller's path has already changed.
    });
  }
  if (!secure) {
    const final = await readVersionedFile(dir, target);
    const parsed = parseNoteDocument(final.contents);
    let cleared = parsed.frontmatter ?? emptyFrontmatter();
    for (const key of ["secure", "local_ai_allowed", "secure_origin"])
      cleared = withField(cleared, key, null);
    await writeVersionedFile(dir, target, composeNoteDocument(cleared, parsed.body), final.revision);
    await updateGitExclusions(dir, [], [target]);
  }
  return target;
}

export async function setFolderProtection(
  dir: VaultDir,
  notes: { filePathOf(id: string): Promise<string>; listAll(): Promise<unknown> },
  id: string,
  key: "locked" | "ai_edit" | "secure" | "local_ai_allowed",
  allowed: boolean,
): Promise<void> {
  const path = await notes.filePathOf(id);
  if (!path.endsWith(".md")) throw new Error("not a Markdown note");
  if (key === "secure") {
    await setFolderSecure(dir, path, allowed);
    await notes.listAll();
    return;
  }
  const opened = await readVersionedFile(dir, path);
  const { frontmatter, body } = parseNoteDocument(opened.contents);
  let fm = frontmatter ?? emptyFrontmatter();
  if (key === "local_ai_allowed") {
    if (!isSecureFrontmatter(fm) && !looksSecret(body))
      throw new Error("Local AI access is only meaningful for a secure note");
    if (!isSecureFrontmatter(fm)) {
      fm = withField(fm, "secure", "true");
      await updateGitExclusions(dir, [path]);
    }
  }
  fm = withField(fm, key, key === "locked" && !allowed ? null : String(allowed));
  // a person's note in a folder opened in place gains only the line asked for
  const inPlace = !rotliMade(frontmatter) && !(await vaultHasRotliMarker(dir));
  const text = inPlace ? composeInPlace(opened.contents, fm) : composeNoteDocument(fm, body);
  await writeVersionedFile(dir, path, text, opened.revision);
}

export async function readFolderRawMetadata(dir: VaultDir, path: string) {
  const opened = await readVersionedFile(dir, path);
  return { ...opened, contents: rawFrontmatterBlock(opened.contents) };
}

export async function writeFolderRawMetadata(
  dir: VaultDir,
  path: string,
  block: string,
  revision: string,
): Promise<string> {
  if (!path.endsWith(".md")) throw new Error("not a Markdown note");
  const opened = await readVersionedFile(dir, path);
  if (!revision || opened.revision !== revision)
    throw new Error("revision conflict: note changed after metadata was opened");
  const next = mergeRawFrontmatter(opened.contents, block);
  if (next === opened.contents) return opened.revision;
  const was = parseNoteDocument(opened.contents).frontmatter;
  const after = parseNoteDocument(next).frontmatter;
  const beforeSecure = !!was && isSecureFrontmatter(was);
  const afterSecure = !!after && isSecureFrontmatter(after);
  if (beforeSecure && !afterSecure) assertSecureRemoval(parseNoteDocument(next).body);
  if (afterSecure && !beforeSecure) await updateGitExclusions(dir, [path]);
  const landed = await writeVersionedFile(dir, path, next, revision);
  if (beforeSecure && !afterSecure) await updateGitExclusions(dir, [], [path]);
  return landed;
}
