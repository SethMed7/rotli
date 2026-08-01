// Rename dialog — a small centered modal opened from the right-click menu's
// "Rename…". Seeds with the note's current title; Enter saves, Esc / click-away
// cancels. Renames via useRenameNote (rewrites the note's first line).

import { useEffect, useRef, useState } from "react";

import { useRenameNote } from "../services/hooks";
import { useUiStore } from "../state/ui";

export function RenameDialog() {
  const target = useUiStore((s) => s.renameTarget);
  const setTarget = useUiStore((s) => s.setRenameTarget);
  const rename = useRenameNote();
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (target) {
      setValue(target.current);
      // focus + select on open
      queueMicrotask(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [target]);

  if (!target) return null;

  const commit = () => {
    const t = value.trim();
    if (t && t !== target.current) rename.mutate({ id: target.id, title: t });
    setTarget(null);
  };

  return (
    <div className="rename-overlay" onMouseDown={() => setTarget(null)}>
      <div className="rename-card" onMouseDown={(e) => e.stopPropagation()}>
        <label className="rename-label" htmlFor="rename-input">
          Rename note
        </label>
        <input
          id="rename-input"
          ref={inputRef}
          className="rename-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") commit();
            else if (e.key === "Escape") setTarget(null);
          }}
        />
        <div className="rename-actions">
          <button type="button" className="rename-btn" onClick={() => setTarget(null)}>
            Cancel
          </button>
          <button type="button" className="rename-btn primary" onClick={commit}>
            Rename
          </button>
        </div>
      </div>
    </div>
  );
}
