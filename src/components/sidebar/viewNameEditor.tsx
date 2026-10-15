// The small card under the MAIN header that names a new view or renames the
// current one (split from sidebarHome.tsx, 2026-10-15). It is a transient
// popover like the others (the owner, 2026-10-15: "it has no way to
// dismiss"): a close button, Esc, and a click outside all put it away.

import { useRef } from "react";

import { useTransientPopover } from "../../lib/popover";
import { XGlyph } from "../glyphs";

export function ViewNameEditor({
  mode,
  initialName,
  error,
  onCommit,
  onEdit,
  onClose,
}: {
  mode: "create" | "rename";
  initialName: string;
  error: string | null;
  onCommit: (name: string) => void;
  /** Typing clears a shown error. */
  onEdit: () => void;
  onClose: () => void;
}) {
  const card = useRef<HTMLDivElement | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  useTransientPopover([card], true, onClose);
  const label = mode === "rename" ? "Rename view" : "New view";
  return (
    <div ref={card} className="view-editor" role="group" aria-label={label}>
      <div className="view-editor-head">
        <label htmlFor="new-view-name">{label}</label>
        <button
          type="button"
          className="view-editor-close"
          aria-label="Close"
          title="Close"
          onClick={onClose}
        >
          <XGlyph size={12} />
        </button>
      </div>
      <div className="view-editor-row">
        <input
          ref={input}
          id="new-view-name"
          autoFocus
          type="text"
          defaultValue={initialName}
          placeholder="View name"
          aria-invalid={!!error}
          aria-describedby={error ? "view-name-error" : undefined}
          onChange={onEdit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onCommit(event.currentTarget.value);
            } else if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            }
          }}
        />
        <button
          type="button"
          className="view-editor-save"
          onClick={() => {
            if (input.current) onCommit(input.current.value);
          }}
        >
          Save
        </button>
      </div>
      {error && (
        <p id="view-name-error" className="view-editor-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
