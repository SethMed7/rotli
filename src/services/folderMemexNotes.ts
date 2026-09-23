// Rotli Web's memex note lane: what the Mac app's `memex_read_contract` and
// `memex_write_note` decide in Rust (memex.rs `write_note_at`), over the
// connected VaultDir. FolderNotesService.writeMemexNote owns the write and the
// id index; this module owns the rules.

import { isSecureFrontmatter, parseNoteDocument } from "../lib/frontmatter";
import type { MemexContractRaw } from "../lib/tauri";
import type { VaultDir } from "./vaultDir";

/** The vault's settings file: its `brainEnabled` is the Librarian switch. */
const SETTINGS_FILE = ".rotli/settings.json";

/** Rust `memex_read_contract`: the vault's contract files, "" when missing. */
export async function readMemexContract(dir: VaultDir): Promise<MemexContractRaw> {
  const read = async (path: string) => ((await dir.exists(path)) ? dir.readText(path) : "");
  return {
    memexJson: await read("memex.json"),
    usersJson: await read("users.json"),
    identitiesJson: await read("identities.local.json"),
  };
}

/** Rust `safe_slug`: a note stem is lowercase letters, digits, and dashes. */
export function assertSafeStem(stem: string): void {
  if (!/^[a-z0-9-]{1,80}$/.test(stem)) throw new Error(`unsafe note stem: ${JSON.stringify(stem)}`);
}

/** The folder a new memex note is born in: `wiki/_secure` for a secure note,
 * else `wiki/_inbox` while the Librarian is on (missing or malformed settings
 * keep the ON default, as in Rust), else the `wiki/` root. A plain folder has
 * no `wiki/`, so its notes land at its root. */
export async function memexNoteFolder(dir: VaultDir, contents: string, isMemex: boolean): Promise<string> {
  if (!isMemex) return "";
  if (isSecureNote(contents)) return "wiki/_secure";
  return (await librarianEnabled(dir)) ? "wiki/_inbox" : "wiki";
}

export function isSecureNote(contents: string): boolean {
  const { frontmatter } = parseNoteDocument(contents);
  return frontmatter ? isSecureFrontmatter(frontmatter) : false;
}

async function librarianEnabled(dir: VaultDir): Promise<boolean> {
  if (!(await dir.exists(SETTINGS_FILE))) return true;
  try {
    const value = (JSON.parse(await dir.readText(SETTINGS_FILE)) as { brainEnabled?: unknown }).brainEnabled;
    return typeof value === "boolean" ? value : true;
  } catch {
    return true;
  }
}

/** List a secure note's path in the vault's `.gitignore`, once. */
export async function ignoreInGit(dir: VaultDir, path: string): Promise<void> {
  const existing = (await dir.exists(".gitignore")) ? await dir.readText(".gitignore") : "";
  if (existing.split("\n").some((line) => line.trim() === path)) return;
  const lead = existing && !existing.endsWith("\n") ? "\n" : "";
  await dir.writeText(".gitignore", `${existing}${lead}${path}\n`);
}
