// "Add to folder" in a note's menu (the owner, 2026-09-18): one note or the
// whole gathered selection into a Main folder, or into a new one. Pure over
// its inputs, like mainFolderMenu.ts, so the order and the labels are
// unit-tested without the menu. Main only: a named view's folders are its own
// subset, and files never sit in Main.

import {
  MAIN_ROOT,
  type MainNode,
  addFolderToMain,
  fileItemsInMainFolder,
  mainFolderIds,
  mainNoteIds,
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

export function addToFolderMenu(input: AddToFolderInput): MenuSpec | null {
  const { tree } = input;
  // items already in Main keep the order Main lists them in; the rest follow
  const listed = [...mainNoteIds(tree)];
  const rank = (id: string) => (listed.includes(id) ? listed.indexOf(id) : listed.length);
  const gathered =
    input.selection && input.selection.length > 1 && input.selection.some((item) => item.id === input.note.id)
      ? [...new Map(input.selection.map((item) => [item.id, item])).values()]
      : [input.note];
  const filing = gathered
    .filter((item) => item.kind !== "file")
    .map((item) => item.id)
    .sort((a, b) => rank(a) - rank(b));
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
