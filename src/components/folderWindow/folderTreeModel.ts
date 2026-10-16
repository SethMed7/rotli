// The folder window's tree (docs/design/open-in-rotli.md, stage 2): the one
// folder opened from Finder as nested branches, folders first, each level
// sorted the way Finder sorts names.

import type { Folder, NoteSummary } from "../../types";

export interface FolderBranch {
  id: string;
  name: string;
  folders: FolderBranch[];
  items: NoteSummary[];
}

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Nest a mount's listing under its root (`<root>:`). A folder or item whose
 * parent isn't listed lands at the top rather than vanishing. */
export function folderTree(
  rootId: string,
  folders: readonly Folder[],
  items: readonly NoteSummary[],
): FolderBranch {
  const top: FolderBranch = { id: `${rootId}:`, name: "", folders: [], items: [] };
  const branches = new Map<string, FolderBranch>([[top.id, top]]);
  for (const folder of folders)
    branches.set(folder.id, { id: folder.id, name: folder.name, folders: [], items: [] });
  for (const folder of folders) {
    const branch = branches.get(folder.id);
    if (branch) (branches.get(folder.parentId ?? top.id) ?? top).folders.push(branch);
  }
  for (const item of items) (branches.get(item.folderId) ?? top).items.push(item);
  const sort = (branch: FolderBranch): void => {
    branch.folders.sort((a, b) => byName.compare(a.name, b.name));
    branch.items.sort((a, b) => byName.compare(a.title, b.title));
    branch.folders.forEach(sort);
  };
  sort(top);
  return top;
}
