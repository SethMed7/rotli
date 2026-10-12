// Durable selectors: Rust note_aliases / preserve_rename_aliases twins.
import { fileNameStem } from "../lib/fileKind";
import { type NoteFrontmatter, composeNoteDocument, parseNoteDocument } from "../lib/frontmatter";
import { isPlaceholderAlias, isTitleTypingTrail } from "../memex/aliases";
import { noteSlugify } from "../memex/contract";
import { isSecureNote } from "./folderMemexNotes";
import { syncSecureIgnore } from "./folderMetadata";
import { type VaultDir, baseName, freeVaultPath, parentPath } from "./vaultDir";

function aliasValues(fm: NoteFrontmatter | null): string[] {
  const raw = fm?.foreign
    .find((line) => line.split(":", 1)[0] === "aliases")
    ?.slice(8)
    .trim();
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((value) => typeof value === "string"))
      return parsed as string[];
  } catch {
    /* accept Rust's comma-separated scalar/list fallback */
  }
  const inner = raw.startsWith("[") && raw.endsWith("]") ? raw.slice(1, -1) : raw;
  return inner
    .split(",")
    .map((alias) => alias.trim().replace(/^["']+|["']+$/g, ""))
    .filter(Boolean);
}

function push(aliases: string[], value: string): void {
  const clean = value.trim();
  if (clean && !aliases.some((alias) => alias.toLowerCase() === clean.toLowerCase())) aliases.push(clean);
}

function legacyStem(path: string, id: string): string | null {
  const stem = fileNameStem(path);
  const tail = `-${id.slice(-6).toLowerCase()}`;
  return id && stem.endsWith(tail) ? stem.slice(0, -tail.length) || null : null;
}

export function folderNoteAliases(path: string, title: string, fm: NoteFrontmatter | null): string[] {
  const aliases = aliasValues(fm);
  for (const value of [fileNameStem(path), noteSlugify(title), legacyStem(path, fm?.id ?? "")])
    if (value) push(aliases, value);
  return aliases;
}

export function withRenameAliases(
  fm: NoteFrontmatter,
  path: string,
  oldTitle: string,
  newTitle: string,
): NoteFrontmatter {
  const aliases = aliasValues(fm).filter((alias) => !isPlaceholderAlias(alias));
  const typing = oldTitle !== newTitle && isTitleTypingTrail(oldTitle, newTitle);
  if (oldTitle !== newTitle && !typing && !isPlaceholderAlias(oldTitle)) {
    push(aliases, oldTitle);
    push(aliases, noteSlugify(oldTitle));
  }
  const stem = fileNameStem(path);
  const oldSlug = noteSlugify(oldTitle);
  const suffix = stem.slice(oldSlug.length);
  const trail = typing && (stem === oldSlug || (stem.startsWith(oldSlug) && /^ \(\d+\)$/.test(suffix)));
  if (!trail && !isPlaceholderAlias(stem)) push(aliases, stem);
  const legacy = legacyStem(path, fm.id ?? "");
  if (legacy) push(aliases, legacy);
  const foreign = fm.foreign.filter((line) => line.split(":", 1)[0] !== "aliases");
  if (aliases.length) foreign.unshift(`aliases: ${JSON.stringify(aliases)}`);
  return { ...fm, foreign };
}

/** Preparation only: the service still owns its guarded write and relocation. */
export async function prepareFolderTitleRename(
  dir: VaultDir,
  path: string,
  text: string,
  oldTitle: string,
  newTitle: string,
): Promise<{ path: string; text: string }> {
  if (oldTitle === newTitle || path === "Welcome to Rotli.md") return { path, text };
  const parsed = parseNoteDocument(text);
  if (!parsed.frontmatter?.id) return { path, text }; // path-addressed plain notes retain their durable selectors
  const desired = `${noteSlugify(newTitle)}.md`;
  const target =
    baseName(path) === desired
      ? path
      : await freeVaultPath(dir, parentPath(path), desired, (stem, ext, n) => `${stem} (${n})${ext}`);
  const fm = withRenameAliases(parsed.frontmatter, path, oldTitle, newTitle);
  if (target !== path && isSecureNote(text)) await syncSecureIgnore(dir, [target]);
  return { path: target, text: composeNoteDocument(fm, parsed.body) };
}
