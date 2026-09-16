// The Main-tree folder menu's items (right-click and the roving "m" key
// build the same list). Pure over its inputs so the labels and the
// destructive grammar are unit-tested without the sidebar.

import { type MainNode, removeFromMain } from "../../services/mainTree";
import { type ViewsManifest, transferTreeItemToView } from "../../services/viewTree";
import type { MenuSpec } from "../../state/contextMenu";
import type { Folder, NoteSummary } from "../../types";

export interface MainFolderMenuInput {
  folder: Folder;
  /** The durable items the folder holds, as far as the note index knows them. */
  folderItems: NoteSummary[];
  /** False when some referenced item is missing from the index (never trash blind). */
  folderScopeComplete: boolean;
  views: ViewsManifest;
  activeView: string | null;
  mainTree: MainNode[];
  activeTree: MainNode[];
  liveIds: Set<string> | undefined;
  rename: () => void;
  setViews: (manifest: ViewsManifest) => void;
  setActiveTree: (tree: MainNode[], liveIds?: Set<string>) => void;
  trashItems: (items: NoteSummary[], onSuccess: () => void) => void;
}

export function mainFolderMenuItems(input: MainFolderMenuInput): MenuSpec[] {
  const { folder: f, folderItems, folderScopeComplete, views, activeView } = input;
  const removeFolder = () => input.setActiveTree(removeFromMain(input.activeTree, f.id), input.liveIds);
  return [
    { kind: "action" as const, label: "Rename folder…", onClick: input.rename },
    ...(views.views.length > 0
      ? [
          {
            kind: "drill" as const,
            label: "Move to view",
            items: [
              {
                kind: "action" as const,
                label: "Main only",
                checked: activeView === null,
                checkedMark: "highlight" as const,
                onClick: () =>
                  input.setViews(transferTreeItemToView(input.mainTree, views, activeView, f.id, null)),
              },
              ...views.views.map((view) => ({
                kind: "action" as const,
                label: view.name,
                checked: activeView === view.name,
                checkedMark: "highlight" as const,
                onClick: () =>
                  input.setViews(transferTreeItemToView(input.mainTree, views, activeView, f.id, view.name)),
              })),
            ],
          },
        ]
      : []),
    { kind: "sep" as const },
    {
      kind: "action" as const,
      label: `Remove from ${activeView ?? "Main"}`,
      onClick: removeFolder,
    },
    { kind: "sep" as const },
    // Delete = the folder goes away (2026-09-16). Its notes are never deleted
    // with it: an empty folder is simply removed, a full one sends its items
    // to Trash first (recoverable) and then goes away.
    folderItems.length === 0
      ? { kind: "action" as const, label: "Delete folder", danger: true, onClick: removeFolder }
      : {
          kind: "drill" as const,
          label: folderScopeComplete ? "Delete folder…" : "Unavailable items — can’t delete folder",
          danger: true,
          disabled: !folderScopeComplete,
          items: [
            {
              kind: "action" as const,
              label: `Move ${folderItems.length} ${folderItems.length === 1 ? "item" : "items"} to Trash and delete folder`,
              danger: true,
              onClick: () => input.trashItems(folderItems, removeFolder),
            },
          ],
        },
  ];
}
