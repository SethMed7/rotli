// A chat project's page, opened from its row in the Chat front's Projects
// list (docs/design/sidebar-home-chat.md, "Projects"). This file is the
// WIRING: which project, its chats newest first, renaming, and its
// instructions note (made, previewed, opened in the editor, unlinked). What
// the page looks like is projectPage.tsx. The project is a record in
// `.rotli/chat-folders.json`; its chats stay plain files in chats/, and its
// instructions are an ordinary note.

import { useMemo, useState } from "react";

import { parseNoteDocument } from "../lib/frontmatter";
import { useNow } from "../lib/useNow";
import { activeInstance } from "../memex/config";
import { useInstanceChats, useMemexConfig } from "../memex/useMemex";
import {
  type ChatFoldersManifest,
  chatActivityMs,
  renameChatFolder,
  setChatFolderInstructionsNote,
  sortChatsByActivity,
  updateChatProjects,
} from "../services/chatFolders";
import { createProjectInstructions } from "../services/chatProjects";
import { useNote } from "../services/hooks";
import { usePanesStore } from "../state/panes";
import { type ProjectInstructionsView, ProjectNotice, ProjectPage } from "./chat/projectPage";
import { relativeChatAge } from "./sidebar/sidebarChatProjection";
import { useChatProjectsManifest } from "./sidebar/useChatFolders";

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The instructions as the page previews them: the note's words without its
 * frontmatter or its own title line, cut to a glance. */
function previewOf(body: string): string {
  const text = parseNoteDocument(body)
    .body.replace(/^#\s[^\n]*\n+/, "")
    .trim();
  return text.length > 1200 ? `${text.slice(0, 1200)}…` : text;
}

export function ProjectSurface({ projectId, vaultId }: { projectId: string; vaultId?: string }) {
  const now = useNow();
  const memexCfg = useMemexConfig();
  const activeMemex = memexCfg.data ? activeInstance(memexCfg.data) : null;
  const projects = useChatProjectsManifest(activeMemex);
  const rawChats = useInstanceChats(activeMemex).data;
  const openChat = usePanesStore((s) => s.openChat);
  const openNote = usePanesStore((s) => s.openNote);
  const [renaming, setRenaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const project = projects.data?.manifest.folders.find((folder) => folder.id === projectId) ?? null;
  const noteId = project?.instructionsNote ?? "";
  // the person's own screen: a local read of their note, never a model's
  const note = useNote(noteId, { enabled: noteId !== "" });
  const chats = useMemo(
    () =>
      rawChats === undefined
        ? null
        : sortChatsByActivity(
            rawChats.filter((chat) => projects.data?.manifest.assignments[chat.slug] === projectId),
          ),
    [rawChats, projects.data, projectId],
  );

  if (!activeMemex) {
    return <ProjectNotice title="No vault connected" detail="Connect a vault to use projects." />;
  }
  if (vaultId && vaultId !== activeMemex.id) {
    return (
      <ProjectNotice
        title="This project is in another vault"
        detail="Switch to that vault to open it, or close this tab."
      />
    );
  }
  if (projects.isPending) {
    return <ProjectNotice title="Opening project…" detail="Reading this vault’s projects." />;
  }
  if (projects.isError) {
    return (
      <ProjectNotice
        alert
        title="Couldn’t read this vault’s projects"
        detail={message(projects.error)}
        action={{ label: "Try again", onClick: () => void projects.refetch() }}
      />
    );
  }
  if (!project) {
    return (
      <ProjectNotice
        title="This project no longer exists"
        detail="It was deleted. Its chats are still in your chat list."
      />
    );
  }

  const instructions: ProjectInstructionsView = !noteId
    ? { state: "none" }
    : note.isPending
      ? { state: "loading" }
      : note.isError || !note.data
        ? { state: "missing", message: note.error ? message(note.error) : "it may have been deleted" }
        : {
            state: "ready",
            preview: previewOf(note.data.body),
            secure: note.data.secure === true,
            locked: note.data.locked === true,
          };

  // the shared project write path (fresh load, edit, prune, guarded save);
  // a project deleted elsewhere since this page rendered is refused, not revived
  const write = (mutate: (m: ChatFoldersManifest) => ChatFoldersManifest) =>
    updateChatProjects(activeMemex, (m) => {
      if (!m.folders.some((folder) => folder.id === projectId)) {
        throw new Error("this project was deleted elsewhere");
      }
      return mutate(m);
    });

  const busyWith = (label: string, run: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    run()
      .catch((err: unknown) => setError(`Couldn’t ${label} — ${message(err)}`))
      .finally(() => setBusy(false));
  };

  return (
    <ProjectPage
      projectId={projectId}
      name={project.name}
      chats={
        chats?.map((chat) => ({
          slug: chat.slug,
          title: chat.title || chat.slug,
          age: relativeChatAge(now, chatActivityMs(chat)),
        })) ?? null
      }
      renaming={renaming}
      instructions={instructions}
      busy={busy}
      error={error}
      onStartRename={() => setRenaming(true)}
      onRename={(value) => {
        setRenaming(false);
        setError(null);
        write((m) => renameChatFolder(m, projectId, value)).catch((err: unknown) =>
          setError(`Couldn’t rename the project — ${message(err)}`),
        );
      }}
      onCancelRename={() => setRenaming(false)}
      onNewChat={() => openChat(null, { vaultId: activeMemex.id, projectId })}
      onOpenChat={(slug) => openChat(slug, { vaultId: activeMemex.id })}
      onAddInstructions={() =>
        busyWith("add instructions", async () =>
          openNote(await createProjectInstructions(activeMemex, projectId, project.name)),
        )
      }
      onEditInstructions={() => openNote(noteId)}
      onUnlinkInstructions={() =>
        busyWith("unlink the instructions", () =>
          write((m) => setChatFolderInstructionsNote(m, projectId, null)),
        )
      }
    />
  );
}
