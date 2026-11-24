// The LOOK of the Chat front's project pieces — a project row and the quiet
// tag a chat in a project wears. Props in, intents out: the wiring (opening,
// menus, drag targets, writes) lives in sidebarChatProjects.tsx and
// sidebarChat.tsx, so a sidebar redesign restyles or replaces this file alone.
// Classes: sb-chatproject*, sb-chattag, sb-chatsection* in styles/notes.css.

import type { MouseEvent } from "react";

import { PinGlyph, PlusGlyph, ProjectGlyph } from "../glyphs";
import { InlineRenameInput } from "../inlineRenameInput";
import { DisclosureChevron } from "./disclosureChevron";

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
      <ProjectGlyph size={14} className="sb-chatproject-glyph" />
      <span className="fname">{name}</span>
      {pinned && <PinGlyph size={11} filled className="sb-chatpin" />}
    </button>
  );
}

/** "All projects (n)": opens the rest of the list in place, its chevron
 * turning with it — the row says what it holds, never "Show 4 more". */
export function ProjectListAction({
  count,
  expanded,
  onClick,
}: {
  count: number;
  expanded: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="sb-chatrow sb-chatproject-more"
      aria-expanded={expanded}
      aria-label={`All projects, ${count}`}
      onClick={onClick}
    >
      <DisclosureChevron open={expanded} />
      <span className="fname">All projects</span>
      <span className="sb-chatfolder-n" aria-hidden="true">
        {count}
      </span>
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

/** The quiet section labels of the Chat front: Projects, Recents — sentence
 * case, never caps. `hidden` when a group's own label already names it for
 * assistive tech; `action` is the label's one quiet button ("+"). */
export function ProjectsHeading({
  label,
  hidden = false,
  action,
}: {
  label: string;
  hidden?: boolean;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="sb-chatsection">
      <span aria-hidden={hidden ? "true" : undefined}>{label}</span>
      {action && (
        <button
          type="button"
          className="sb-chatsection-add"
          aria-label={action.label}
          title={action.label}
          onClick={action.onClick}
        >
          <PlusGlyph size={13} />
        </button>
      )}
    </div>
  );
}
