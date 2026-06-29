// The metadata panel (sits right of the Aa chip): the per-note AI LOCK plus an
// editor for the note's frontmatter. The lock writes `locked: true` (the AI filer
// must skip the note). The fields edit the FOREIGN frontmatter (shelf/reach/area/
// tags/…) — blur or Enter saves, × removes, the bottom row adds. id/created/updated
// are shown read-only. All of it rides in the preserved frontmatter; the editor
// body never sees it.

import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import { useTransientPopover } from "../lib/popover";
import {
  type FrontmatterView,
  corpusFrontmatter,
  corpusSetField,
  corpusSetLocked,
  corpusSetSecure,
} from "../lib/tauri";
import { invalidateNotes } from "../services/hooks";
import { LockGlyph, ShieldGlyph } from "../components/glyphs";

export function MetaPanel({
  noteId,
  anchorRef,
  onClose,
}: {
  noteId: string;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useTransientPopover([ref, anchorRef], true, onClose);
  const [fm, setFm] = useState<FrontmatterView | null>(null);
  const [busy, setBusy] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newVal, setNewVal] = useState("");

  useEffect(() => {
    let alive = true;
    void corpusFrontmatter(noteId).then((f) => {
      if (alive) setFm(f);
    });
    return () => {
      alive = false;
    };
  }, [noteId]);

  const fields = useMemo(() => {
    return (fm?.fields ?? []).map((line) => {
      const i = line.indexOf(":");
      return i > 0
        ? { key: line.slice(0, i).trim(), value: line.slice(i + 1).trim() }
        : { key: line.trim(), value: "" };
    });
  }, [fm]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      setFm(await corpusFrontmatter(noteId));
      await invalidateNotes();
    } finally {
      setBusy(false);
    }
  };

  const toggleLock = () => {
    if (fm) void run(() => corpusSetLocked(noteId, !fm.locked));
  };
  const toggleSecure = () => {
    if (fm) void run(() => corpusSetSecure(noteId, !fm.secure));
  };
  const saveField = (key: string, value: string) => run(() => corpusSetField(noteId, key, value));
  const addField = () => {
    if (!newKey.trim()) return;
    void run(() => corpusSetField(noteId, newKey.trim(), newVal.trim())).then(() => {
      setNewKey("");
      setNewVal("");
    });
  };

  return (
    <div className="aapanel metapanel" ref={ref} role="dialog" aria-label="Metadata">
      <button
        type="button"
        className={fm?.locked ? "metalock on" : "metalock"}
        disabled={busy || !fm}
        onClick={toggleLock}
      >
        <LockGlyph size={15} open={!fm?.locked} />
        <span>{fm?.locked ? "Locked — the AI won't touch this note" : "Lock from the AI"}</span>
      </button>
      <button
        type="button"
        className={fm?.secure ? "metalock on" : "metalock"}
        disabled={busy || !fm}
        onClick={toggleSecure}
        title="A secure note's content is never sent to a remote model, and its file is gitignored."
      >
        <ShieldGlyph size={15} />
        <span>
          {fm?.secure
            ? "Secure — secrets detected · on-device only · gitignored"
            : "Mark secure (keep off remote AI)"}
        </span>
      </button>
      <div className="aalabel">Metadata</div>
      {!fm ? (
        <p className="metaempty">Reading…</p>
      ) : (
        <div className="metaedit">
          {fm.created && (
            <div className="metaro">
              <span className="mk">created</span>
              <span className="mv">{fm.created}</span>
            </div>
          )}
          {fm.updated && (
            <div className="metaro">
              <span className="mk">updated</span>
              <span className="mv">{fm.updated}</span>
            </div>
          )}
          {fields.map((f) => (
            <div className="metarow" key={f.key}>
              <span className="mk" title={f.key}>
                {f.key}
              </span>
              <input
                className="mv-input"
                defaultValue={f.value}
                disabled={busy}
                aria-label={`${f.key} value`}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                onBlur={(e) => {
                  if (e.target.value !== f.value) saveField(f.key, e.target.value);
                }}
              />
              <button
                type="button"
                className="mx"
                disabled={busy}
                title={`Remove ${f.key}`}
                onClick={() => saveField(f.key, "")}
              >
                ×
              </button>
            </div>
          ))}
          <div className="metarow add">
            <input
              className="mk-input"
              placeholder="field"
              value={newKey}
              disabled={busy}
              aria-label="New field name"
              onChange={(e) => setNewKey(e.target.value)}
            />
            <input
              className="mv-input"
              placeholder="value"
              value={newVal}
              disabled={busy}
              aria-label="New field value"
              onChange={(e) => setNewVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addField();
              }}
            />
            <button
              type="button"
              className="madd"
              disabled={busy || !newKey.trim()}
              onClick={addField}
            >
              +
            </button>
          </div>
          {fields.length === 0 && (
            <p className="metaempty">No fields yet — add one, or let the AI fill shelf/area/tags later.</p>
          )}
        </div>
      )}
    </div>
  );
}
