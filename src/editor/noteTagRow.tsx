// The note's tags under its header (2026-11-24): each tag a chip the person
// can remove, and one quiet control to add more. The person's own lane, so it
// works on locked and secure notes too. A refused tag says why, in place.

import { type KeyboardEvent, useRef, useState } from "react";

import type { NoteTagChange } from "../lib/corpusTags";
import { splitTagInput } from "../lib/noteTags";
import { changeNoteTags, useNoteTags } from "../services/noteTags";

export function NoteTagRow({ noteId, disabled }: { noteId: string; disabled: boolean }) {
  const tags = useNoteTags(noteId, !disabled).data ?? [];
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Enter and Escape end the field themselves; the blur their unmount fires
  // must not add the draft a second time (or at all, after Escape)
  const settled = useRef(false);

  const apply = async (change: NoteTagChange): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await changeNoteTags(noteId, change);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setAdding(false);
    setDraft("");
  };

  const commit = async () => {
    if (settled.current) return;
    settled.current = true;
    const add = splitTagInput(draft);
    if (add.length === 0) return close();
    if (await apply({ add })) close();
    else settled.current = false;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      settled.current = true;
      setError(null);
      close();
    }
  };

  return (
    <div className="ed-tags" role="group" aria-label="Tags">
      {tags.length > 0 && (
        <ul className="ed-tag-list">
          {tags.map((tag) => (
            <li key={tag} className="tag-chip">
              <span className="tag-chip-name">#{tag}</span>
              <button
                type="button"
                className="tag-chip-remove"
                aria-label={`Remove tag ${tag}`}
                title={`Remove #${tag}`}
                disabled={busy || disabled}
                onClick={() => void apply({ remove: [tag] })}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <input
          className="ed-tag-input"
          // the person asked to type a tag: focus follows their click
          autoFocus
          type="text"
          value={draft}
          placeholder="tag, another-tag"
          aria-label="New tags"
          aria-invalid={error ? true : undefined}
          aria-busy={busy || undefined}
          // read-only, never disabled, while saving: a disabled field drops
          // focus, and the person's next Escape or edit would go elsewhere
          readOnly={busy}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => void commit()}
        />
      ) : (
        <button
          type="button"
          className="ed-tag-add"
          disabled={disabled}
          onClick={() => {
            settled.current = false;
            setError(null);
            setAdding(true);
          }}
        >
          {tags.length > 0 ? "+ Tag" : "+ Add tag"}
        </button>
      )}
      {error && (
        <span className="ed-tag-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
