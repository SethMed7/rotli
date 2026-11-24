// The chat project page's LOOK, and nothing else: props in, intents out. The
// wiring (which project, its chats, saving, errors) lives in
// ../projectSurface.tsx, so a redesign of the page replaces this file alone.
// Classes are the board grammar plus project-* rules in styles/board.css.

import { FolderGlyph, PlusGlyph } from "../glyphs";
import { InlineRenameInput } from "../inlineRenameInput";

export interface ProjectPageChat {
  slug: string;
  title: string;
  /** Compact age of the newest reply ("now", "4h", "8d"). */
  age: string;
}

/** The Instructions section: the project's linked note, as the page shows it. */
export type ProjectInstructionsView =
  | { state: "none" }
  | { state: "loading" }
  | { state: "missing"; message: string }
  | { state: "ready"; preview: string; secure: boolean; locked: boolean };

export interface ProjectPageProps {
  projectId: string;
  name: string;
  /** null while the vault's chats are still being read. */
  chats: ProjectPageChat[] | null;
  renaming: boolean;
  instructions: ProjectInstructionsView;
  /** A create or unlink is running. */
  busy: boolean;
  error: string | null;
  onStartRename: () => void;
  onRename: (name: string) => void;
  onCancelRename: () => void;
  onNewChat: () => void;
  onOpenChat: (slug: string) => void;
  onAddInstructions: () => void;
  onEditInstructions: () => void;
  onUnlinkInstructions: () => void;
}

/** The page's quiet message for a project that cannot be shown (loading,
 * missing, another vault) — with an optional action. */
export function ProjectNotice({
  title,
  detail,
  alert = false,
  action,
}: {
  title: string;
  detail: string;
  alert?: boolean;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="board project-page">
      <div className="list-empty" role={alert ? "alert" : "status"}>
        <p className="be-title">{title}</p>
        <p className="be-sub">{detail}</p>
        {action && (
          <button type="button" className="ghostbtn" onClick={action.onClick}>
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}

export function ProjectPage(p: ProjectPageProps) {
  const chatsId = `project-chats-${p.projectId}`;
  const instrId = `project-instr-${p.projectId}`;
  return (
    <div className="board project-page">
      <header className="board-head project-head">
        <FolderGlyph size={18} className="project-glyph" />
        {p.renaming ? (
          <InlineRenameInput
            className="project-rename"
            defaultValue={p.name}
            ariaLabel="Rename project"
            onCommit={p.onRename}
            onCancel={p.onCancelRename}
          />
        ) : (
          <h2 className="board-title project-title">
            <button
              type="button"
              className="project-name"
              title="Rename project"
              aria-label={`${p.name} — rename project`}
              onClick={p.onStartRename}
            >
              {p.name}
            </button>
          </h2>
        )}
        {p.chats && (
          <span className="board-count" aria-label={`${p.chats.length} chats`}>
            {p.chats.length}
          </span>
        )}
        <button type="button" className="btn project-newchat" onClick={p.onNewChat}>
          <PlusGlyph size={14} />
          <span>New chat in this project</span>
        </button>
      </header>

      <div className="board-scroll project-body">
        <section className="project-chats" aria-labelledby={chatsId}>
          <h3 className="project-section" id={chatsId}>
            Chats
          </h3>
          {p.chats === null ? (
            <p className="project-quiet" role="status">
              Reading chats…
            </p>
          ) : p.chats.length === 0 ? (
            <div className="project-empty">
              <p className="be-title">No chats in this project yet</p>
              <p className="be-sub">
                Start one with New chat in this project, or add a chat from its menu in the sidebar.
              </p>
            </div>
          ) : (
            <ul className="recent-list">
              {p.chats.map((chat) => (
                <li key={chat.slug}>
                  <button
                    type="button"
                    className="project-chatrow"
                    title={chat.title}
                    onClick={() => p.onOpenChat(chat.slug)}
                  >
                    <span className="project-chattitle">{chat.title}</span>
                    <span className="project-chatage">{chat.age}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="project-instructions" aria-labelledby={instrId}>
          <h3 className="project-section" id={instrId}>
            Instructions
          </h3>
          <ProjectInstructions {...p} />
          {p.error && (
            <p className="file-err" role="alert">
              ⚠ {p.error}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

/** The Instructions section's body. They are an ordinary note: edited in the
 * note editor, where it can be marked secure or locked like any other. */
function ProjectInstructions(p: ProjectPageProps) {
  const view = p.instructions;
  if (view.state === "none") {
    return (
      <>
        <p className="project-hint">
          Instructions are sent with every chat in this project. They live in a note of their own, so you can
          edit, search, and mark them secure like any note. They never give the AI more access.
        </p>
        <div className="project-instr-foot">
          <button type="button" className="ghostbtn" disabled={p.busy} onClick={p.onAddInstructions}>
            {p.busy ? "Adding…" : "Add instructions"}
          </button>
        </div>
      </>
    );
  }
  if (view.state === "loading") {
    return (
      <p className="project-quiet" role="status">
        Reading the instructions…
      </p>
    );
  }
  if (view.state === "missing") {
    return (
      <>
        <p className="project-warn" role="alert">
          Couldn’t read the instructions note — {view.message}. Chats in this project won’t send until it’s
          fixed or unlinked.
        </p>
        <div className="project-instr-foot">
          <button type="button" className="ghostbtn" disabled={p.busy} onClick={p.onUnlinkInstructions}>
            Unlink
          </button>
        </div>
      </>
    );
  }
  return (
    <>
      {(view.secure || view.locked) && (
        <p className="project-badges">
          {view.secure && <span className="project-badge">Secure — on-device models only</span>}
          {view.locked && <span className="project-badge">Locked — AI can’t edit it</span>}
        </p>
      )}
      <div className="project-instr-preview">
        {view.preview || <span className="project-quiet">Empty — open the note to write them.</span>}
      </div>
      <div className="project-instr-foot">
        <button type="button" className="ghostbtn" onClick={p.onEditInstructions}>
          Edit instructions
        </button>
        <button type="button" className="ghostbtn" disabled={p.busy} onClick={p.onUnlinkInstructions}>
          Unlink
        </button>
      </div>
    </>
  );
}
