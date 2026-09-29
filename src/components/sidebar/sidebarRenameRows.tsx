// Rename in place (the owner, 2026-09-28: "rename happen in line like how it
// happens in an IDE"). Rename… on a Main folder or note turns just that row
// into a text field of the same size: the folder's contents stay where they
// are, Enter saves, Esc or clicking away keeps the old name, and a file's
// field holds its name without the extension.

import { type CSSProperties, useState } from "react";

import { extOf } from "../../lib/fileKind";
import { renameTargetFor } from "../../services/itemRename";
import type { NoteSummary } from "../../types";
import { ChevronRight, FolderGlyph, glyphForNote } from "../glyphs";
import { InlineRenameInput } from "../inlineRenameInput";
import { useCommitRename } from "../renameDialog";

export function FolderRenameRow({
  name,
  open,
  style,
  onCommit,
  onCancel,
}: {
  name: string;
  open: boolean;
  style: CSSProperties;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  return (
    <div className="frow child main-row renaming" style={style}>
      <span className={`fchev${open ? " open" : ""}`} aria-hidden="true">
        <ChevronRight size={10} />
      </span>
      <FolderGlyph size={14} />
      <InlineRenameInput
        className="sb-rename-input"
        defaultValue={name}
        placeholder="Folder name…"
        ariaLabel="Rename Main folder"
        onCommit={onCommit}
        onCancel={onCancel}
      />
    </div>
  );
}

export function NoteRenameRow({
  note,
  style,
  onDone,
}: {
  note: NoteSummary;
  style: CSSProperties;
  onDone: () => void;
}) {
  const commit = useCommitRename();
  const [state, setState] = useState({ busy: false, error: "" });
  const target = renameTargetFor(note);
  if (!target) return null;
  const noun =
    target.lane === "title"
      ? "note"
      : target.lane === "board"
        ? "board"
        : extOf(target.id) === "xlsx"
          ? "sheet"
          : "document";
  // the row closes only once the name is saved; a refused name keeps the
  // field open with what was typed and the reason under it, as the dialog does
  const save = async (value: string) => {
    const name = value.trim();
    if (!name || name === target.current) return onDone();
    if (state.busy) return;
    setState({ busy: true, error: "" });
    try {
      await commit(target, name);
      onDone();
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      setState({ busy: false, error: `Couldn’t rename the ${noun} — ${reason}` });
    }
  };
  return (
    <>
      <div className="snrow main-row renaming" style={style}>
        {glyphForNote(note, { size: 14, className: "snicon" })}
        <InlineRenameInput
          className="sb-rename-input"
          defaultValue={target.current}
          ariaLabel={`Rename ${noun}`}
          onCommit={save}
          onCancel={() => {
            if (!state.busy) onDone();
          }}
        />
      </div>
      {state.error && (
        <p className="sb-rename-error" role="alert" style={style}>
          {state.error}
        </p>
      )}
    </>
  );
}
