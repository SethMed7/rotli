// The Chat front's Projects list (docs/design/sidebar-home-chat.md,
// "Projects"): a "Projects" label with its "+", the first few projects and
// an "All projects (n)" disclosure, above the flat Recents list. A row opens the project's page in a tab; it is also where a dragged
// chat is dropped to join the project. Pinned projects come first, then the
// one with the newest chat activity (services/chatFolders groupChats). This is
// the wiring; the rows' look is projectRow.tsx.

import { useState } from "react";

import { pinActionLabel } from "../../lib/sidebarLook";
import {
  type ChatFoldersManifest,
  assignChatToFolder,
  createChatFolder,
  deleteChatFolder,
  setChatFolderPinned,
} from "../../services/chatFolders";
import { useContextMenu } from "../../state/contextMenu";
import { useFocusedTab, usePanesStore } from "../../state/panes";
import { ProjectListAction, ProjectRenameField, ProjectRow, ProjectsHeading } from "./projectRow";
import type { SidebarChatData } from "./useChatFolders";

/** How many projects show before "All projects" is opened (design A). */
export const PROJECTS_SHOWN = 3;

/** The projects a collapsed list shows: the first few, plus the open one if
 * it sits further down (so the selected row is never hidden). */
export function shownProjectIds(ids: readonly string[], expanded: boolean, openId: string | null): string[] {
  if (expanded || ids.length <= PROJECTS_SHOWN) return [...ids];
  const head = ids.slice(0, PROJECTS_SHOWN);
  return openId && ids.includes(openId) && !head.includes(openId) ? [...head, openId] : head;
}

/** Make a project (optionally filing one chat into it), then open its name
 * for editing — the one create flow for the toolbar, the empty list, and a
 * chat's "Add to project › New project…". */
export function createProject(
  update: SidebarChatData["update"],
  startRename: (id: string) => void,
  chatSlug?: string,
): void {
  let createdId: string | null = null;
  update(
    (m: ChatFoldersManifest) => {
      const created = createChatFolder(m, "New project");
      createdId = created.id;
      return chatSlug ? assignChatToFolder(created.manifest, chatSlug, created.id) : created.manifest;
    },
    () => {
      if (createdId) startRename(createdId);
    },
  );
}

export function SidebarChatProjects({
  chats,
  dropId,
  renamingId,
  setRenamingId,
  onRename,
}: {
  chats: SidebarChatData;
  /** The project row a dragged chat is over. */
  dropId: string | null;
  renamingId: string | null;
  setRenamingId: (id: string | null) => void;
  onRename: (id: string, name: string) => void;
}) {
  const { activeMemex, grouped, update, projectsError } = chats;
  const openContextMenu = useContextMenu((s) => s.open);
  const openProject = usePanesStore((s) => s.openProject);
  const focused = useFocusedTab();
  const openId = focused?.surfaceKind === "project" ? focused.projectId : null;
  const [expanded, setExpanded] = useState(false);

  if (!activeMemex) return null;
  if (projectsError) {
    return (
      <p className="sb-empty sb-chatprojects-error" role="alert">
        Couldn’t read this vault’s projects. Chats still list below.
      </p>
    );
  }
  const ids = grouped.folders.map(({ folder }) => folder.id);
  const shown = new Set(shownProjectIds(ids, expanded, openId));
  const newProject = { label: "New project", onClick: () => createProject(update, setRenamingId) };
  return (
    <>
      <div className="sb-chatprojects" role="group" aria-label="Projects">
        {/* the label carries the one in-list create; with no projects it is
            the whole section, so "+" is where a first project starts */}
        <ProjectsHeading label="Projects" hidden action={newProject} />
        {grouped.folders
          .filter(({ folder }) => shown.has(folder.id))
          .map(({ folder, chats: projectChats }) =>
            renamingId === folder.id ? (
              <ProjectRenameField
                key={folder.id}
                name={folder.name}
                onCommit={(value) => {
                  setRenamingId(null);
                  onRename(folder.id, value);
                }}
                onCancel={() => setRenamingId(null)}
              />
            ) : (
              <ProjectRow
                key={folder.id}
                id={folder.id}
                name={folder.name}
                chatCount={projectChats.length}
                pinned={folder.pinned === true}
                selected={openId === folder.id}
                dropTarget={dropId === folder.id}
                onOpen={() => openProject(folder.id, activeMemex.id)}
                onMenu={(e) =>
                  openContextMenu(e.clientX, e.clientY, [
                    {
                      kind: "action" as const,
                      label: "Open project",
                      onClick: () => openProject(folder.id, activeMemex.id),
                    },
                    {
                      kind: "action" as const,
                      label: pinActionLabel(folder.pinned === true),
                      checked: folder.pinned === true,
                      onClick: () => update((m) => setChatFolderPinned(m, folder.id, !folder.pinned)),
                    },
                    { kind: "action" as const, label: "Rename…", onClick: () => setRenamingId(folder.id) },
                    { kind: "sep" as const },
                    // two deliberate clicks: the project goes; its chats stay in
                    // the list, its instructions note stays a note, no file moves
                    {
                      kind: "drill" as const,
                      label: "Delete project…",
                      items: [
                        {
                          kind: "action" as const,
                          danger: true,
                          label: `Delete “${folder.name}” — its chats${
                            folder.instructionsNote ? " and instructions note" : ""
                          } stay`,
                          onClick: () => update((m) => deleteChatFolder(m, folder.id)),
                        },
                      ],
                    },
                  ])
                }
              />
            ),
          )}
        {ids.length > PROJECTS_SHOWN && (
          <ProjectListAction count={ids.length} expanded={expanded} onClick={() => setExpanded(!expanded)} />
        )}
      </div>
      {/* the flat list below the projects: every chat, newest reply first */}
      <ProjectsHeading label="Recents" />
    </>
  );
}
