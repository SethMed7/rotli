// The LOOK of the Chat front's project pieces — a project row and the quiet
// tag a chat in a project wears. Props in, intents out: the wiring (opening,
// menus, drag targets, writes) lives in sidebarChatProjects.tsx and
// sidebarChat.tsx, so a sidebar redesign restyles or replaces this file alone.
// Classes: sb-chatproject*, sb-chattag in styles/notes.css.

import type { MouseEvent } from "react";

import { FolderGlyph, PinGlyph, PlusGlyph } from "../glyphs";
import { InlineRenameInput } from "../inlineRenameInput";

export function ProjectRow({
  id,
  name,
  chatCount,
  pinned,
  selected,
  dropTarget,
  onOpen,
  onMenu,
}: {
  id: string;
  name: string;
  chatCount: number;
  pinned: boolean;
  selected: boolean;
  /** A dragged chat is over this row. */
  dropTarget: boolean;
  onOpen: () => void;
  onMenu: (e: MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      className={`sb-chatrow sb-chatproject${dropTarget ? " chatdrop" : ""}${selected ? " sel" : ""}`}
      // the drop target the chat drag looks for (sidebarChat.tsx)
      data-chatproject-id={id}
      aria-current={selected ? "page" : undefined}
      aria-label={`Open project ${name}, ${chatCount} chats`}
      title={name}
      onClick={onOpen}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onMenu(e);
      }}
    >
      <FolderGlyph size={14} className="kind-folder" />
      <span className="fname">{name}</span>
      {pinned && <PinGlyph size={11} filled className="sb-chatpin" />}
      <span className="sb-chatfolder-n" aria-hidden="true">
        {chatCount}
      </span>
    </button>
  );
}

/** A quiet text row under the projects: "New project", "Show 3 more". */
export function ProjectListAction({
  label,
  kind,
  expanded,
  onClick,
}: {
  label: string;
  kind: "new" | "more";
  expanded?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`sb-chatrow sb-chatproject-${kind}`}
      aria-expanded={kind === "more" ? expanded : undefined}
      onClick={onClick}
    >
      {kind === "new" && <PlusGlyph size={14} />}
      <span className="fname">{label}</span>
    </button>
  );
}

/** The project a chat row belongs to, as a quiet tag beside its title. The
 * row's accessible name already says "in <project>", so the tag is hidden
 * from assistive tech. */
export function ProjectTag({ name }: { name: string }) {
  return (
    <span className="sb-chattag" title={`In project ${name}`} aria-hidden="true">
      {name}
    </span>
  );
}

/** A project row while its name is being edited — the row's own footprint. */
export function ProjectRenameField({
  name,
  onCommit,
  onCancel,
}: {
  name: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  return (
    <InlineRenameInput
      className="sb-chatrename"
      defaultValue={name}
      ariaLabel="Rename project"
      onCommit={onCommit}
      onCancel={onCancel}
    />
  );
}

/** The quiet section labels of the Chat front: Projects, Recents. `hidden`
 * when a group's own label already names it for assistive tech. */
export function ProjectsHeading({ label, hidden = false }: { label: string; hidden?: boolean }) {
  return (
    <p className="sb-chatsection" aria-hidden={hidden ? "true" : undefined}>
      {label}
    </p>
  );
}
