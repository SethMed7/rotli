// Which remembered open/closed folders survive a launch (persist.ts runs it in
// its deferred GC, #78): a key is kept while its folder or row still exists, so
// expandedDests never grows forever, and a key whose row is live is never lost.
import { mainFolderIds } from "../services/mainTree";
import type { MainNode } from "../services/mainTree";
import { vaultTree } from "../services/vaultTree";
import type { Folder, NoteSummary } from "../types";
import { RESERVED_DESTS } from "./ui";

export function foldStateKeeper(
  folders: readonly Folder[],
  mainTree: MainNode[],
  notes: Iterable<NoteSummary> | null,
): (key: string) => boolean {
  const valid = new Set<string>([
    "Brain", // the Brain section header keys its accordion here
    ...RESERVED_DESTS,
    ...folders.map((f) => f.id),
    ...mainFolderIds(mainTree),
    // the Vault view's rows are the folders as on disk, keyed like Main's;
    // without them every opened Vault view folder closed again on launch.
    // Its rows come from the whole note universe (an inbox capture sits in a
    // hidden root, so it is not in listNotes); unread notes skip this part.
    ...(notes ? mainFolderIds(vaultTree(notes, folders)) : []),
  ]);
  // Without the notes, a "main:" key may be a Vault view row no one can see
  // yet: keep it rather than close a folder that is still there.
  // root markers ("vault:", "<rootid>:"), the synthetic Storage grouping
  // rows, and chat VIRTUAL folders aren't in listFolders — keep them by
  // shape (chatfolder:* pruning silently re-expanded folded chat folders
  // on every relaunch — review, 2026-07-31)
  // "sec:*" zone keys are kept by SHAPE, not by name: sec:system is live,
  // and the retired sec:chat / sec:notes / sec:inbox keys must survive so a
  // downgrade (or the parked Inbox front's return) finds its fold state
  return (key) =>
    valid.has(key) ||
    (notes === null && key.startsWith("main:")) ||
    key.startsWith("sec:") ||
    key.endsWith(":") ||
    key.startsWith("Storage/") ||
    key.startsWith("chatfolder:");
}
