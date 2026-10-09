// "Add to folder" in a note's menu (the owner, 2026-09-18): one note or the
// whole gathered selection into a Main folder, or into a new one. Pure over
// its inputs, like mainFolderMenu.ts, so the order and the labels are
// unit-tested without the menu. Main only: a named view's folders are its own
// subset. A file is filed only when it is already in Main (a new sheet or
// document lands there); this menu never brings a Library file into Main.

import {
  MAIN_ROOT,
  type MainNode,
  addFolderToMain,
  fileItemsInMainFolder,
  liftToMainRoot,
  mainFolderIds,
  mainNoteIds,
  mainParentOfNote,
  uniqueRootFolderName,
} from "../../services/mainTree";
import type { MenuSpec } from "../../state/contextMenu";
import type { NoteSummary } from "../../types";

export interface AddToFolderInput {
  tree: MainNode[];
  /** The clicked note… */
  note: NoteSummary;
  /** …and the gathered selection, which counts only when the note is part of it. */
  selection?: readonly NoteSummary[] | undefined;
  setTree: (tree: MainNode[]) => void;
  /** A folder made here is handed to the sidebar to be named in place. */
  requestRename: (folderId: string) => void;
}

/** The clicked note, or the gathered selection it belongs to, in the order
 * Main lists them (items not in Main follow). Files count only once in Main. */
function itemsToFile(input: Pick<AddToFolderInput, "tree" | "note" | "selection">): string[] {
  const listed = [...mainNoteIds(input.tree)];
  const rank = (id: string) => (listed.includes(id) ? listed.indexOf(id) : listed.length);
  const gathered =
    input.selection && input.selection.length > 1 && input.selection.some((item) => item.id === input.note.id)
      ? [...new Map(input.selection.map((item) => [item.id, item])).values()]
      : [input.note];
  return gathered
    .filter((item) => item.kind !== "file" || listed.includes(item.id))
    .map((item) => item.id)
    .sort((a, b) => rank(a) - rank(b));
}

export function addToFolderMenu(input: AddToFolderInput): MenuSpec | null {
  const { tree } = input;
  const filing = itemsToFile(input);
  if (filing.length === 0) return null;
  const fileInto = (from: MainNode[], folderId: string) =>
    input.setTree(fileItemsInMainFolder(from, filing, folderId));
  return {
    kind: "drill",
    label: filing.length > 1 ? `Add ${filing.length} items to folder` : "Add to folder",
    items: [
      ...mainFolderIds(tree).map((folderId) => ({
        kind: "action" as const,
        label: folderId.slice(MAIN_ROOT.length),
        onClick: () => fileInto(tree, folderId),
      })),
      {
        kind: "action" as const,
        label: "New folder…",
        onClick: () => {
          const name = uniqueRootFolderName(tree, "New folder");
          const folderId = `${MAIN_ROOT}${name}`;
          fileInto(addFolderToMain(tree, name), folderId);
          input.requestRename(folderId);
        },
      },
    ],
  };
}

/** "Remove from folder" (the owner, 2026-10-08): the note — or the gathered
 * selection — out of its Main folder to the top level, landing in the order
 * Main lists them. Null when none of them sits in a folder. */
export function removeFromFolderItem(
  input: Pick<AddToFolderInput, "tree" | "note" | "selection" | "setTree">,
): MenuSpec | null {
  const nested = itemsToFile(input).filter((id) => {
    const parent = mainParentOfNote(input.tree, id);
    return parent !== null && parent !== MAIN_ROOT;
  });
  if (nested.length === 0) return null;
  return {
    kind: "action",
    label: nested.length > 1 ? `Remove ${nested.length} items from folder` : "Remove from folder",
    // each lands just after its folder, so the last listed goes first
    onClick: () => input.setTree(nested.toReversed().reduce(liftToMainRoot, input.tree)),
  };
}
