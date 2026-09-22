// A fresh vault's spine, written into an EMPTY folder — the TypeScript twin of
// Rust `scaffold_memex` (src-tauri/src/memex.rs), for Rotli Web's "an empty
// folder becomes a vault". The same directories, the same four files, so the
// folder the browser made opens in Rotli for Mac as a vault it recognizes.
// Rust also drops a root welcome note; here the Welcome folder is seeded by
// services/welcome.ts right after, inside wiki/, as the browser twin does.

import { CONTRACT_VERSION } from "../memex/contract";
import type { VaultDir } from "./vaultDir";

/** The directories of the v3.6 spine, in creation order. */
export const VAULT_SPINE_DIRS = [
  "identity",
  "personality",
  "wiki",
  "wiki/_inbox",
  "wiki/_secure",
  "history",
  "chats",
  "storage",
  "archive",
  "trash",
] as const;

const INBOX_MARK = "<!-- entries below this line -->";

/** The spine's files, by path. Pure; exported for tests. */
export function vaultScaffoldFiles(id: string, nowIso: string): Record<string, string> {
  const info = {
    id,
    contract: CONTRACT_VERSION,
    createdAt: nowIso,
    selfHeal: true,
    apps: { rotli: { role: "chat-system", connectedAt: nowIso } },
  };
  return {
    "inbox.md": `# Inbox\n\n${INBOX_MARK}\n`,
    "MAP.md": "# MAP\n\nThe index of this Rotli vault.\n",
    // the vault is a TEXT tree; binaries live in storage/, .rotli/ is rebuildable
    ".gitignore": "storage/\n.rotli/\n",
    "memex.json": `${JSON.stringify(info, null, 2)}\n`,
  };
}

/** Write the spine into `dir`. The caller has checked the folder is empty;
 * this never deletes and never overwrites a file that already exists. */
export async function scaffoldVault(dir: VaultDir, now: Date = new Date()): Promise<void> {
  for (const path of VAULT_SPINE_DIRS) await dir.mkdir(path);
  const id = `mx_${crypto.randomUUID()}`;
  for (const [path, text] of Object.entries(vaultScaffoldFiles(id, now.toISOString()))) {
    if (!(await dir.exists(path))) await dir.writeText(path, text);
  }
}
