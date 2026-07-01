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
  corpusNotePath,
  corpusSetField,
  corpusSetLocked,
  corpusSetSecure,
} from "../lib/tauri";
import { fileNoteToArea, isStagedNote } from "../services/brainFiling";
import { invalidateNotes, useFolders } from "../services/hooks";
import { usePanesStore } from "../state/panes";
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
  // the note's REL PATH (wire id = ULID for .md notes) — staged-detection and
  // the "Filed in <area>" line read the path, never the id (v0.18.1 bridge fix)
  const [relPath, setRelPath] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [newKey, setNewKey] = useState("");
  const [newVal, setNewVal] = useState("");

  useEffect(() => {
    let alive = true;
    corpusFrontmatter(noteId)
      .then((f) => {
        if (alive) setFm(f);
      })
      .catch((e: unknown) => {
        // never leave the panel stuck on "Reading…" — show why it failed
        console.warn("metadata read failed", e);
        if (alive) setErr(e instanceof Error ? e.message : String(e));
      });
    corpusNotePath(noteId)
      .then((rel) => {
        if (alive) setRelPath(rel);
      })
      .catch(() => {
        if (alive) setRelPath(null); // no path (browser review) → no filing UI
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
    setErr(null);
    try {
      await fn();
      setFm(await corpusFrontmatter(noteId));
      await invalidateNotes();
    } catch (e) {
      console.warn("metadata update failed", e);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Brain filing (v3.7 Filer, manual): a STAGED note (wiki/_inbox) can be filed into
  // an area; a note already under wiki/<area> shows where it landed. Both read the
  // resolved REL PATH — the wire id is a ULID and matches neither. The area vocab
  // is the wiki areas (People/Projects/…), minus the internal underscore folders.
  const staged = relPath != null && isStagedNote(relPath);
  const filedArea = relPath ? (/(?:^|\/)wiki\/([^/_][^/]*)\//.exec(relPath)?.[1] ?? null) : null;
  const areas = (useFolders().data ?? [])
    .filter((f) => f.parentId === "wiki" && !f.name.startsWith("_"))
    .map((f) => f.name);

  const fileToArea = async (area: string) => {
    setBusy(true);
    setErr(null);
    try {
      await fileNoteToArea(noteId, area);
      onClose();
    } catch (e) {
      console.warn("file to brain failed", e);
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const openActivity = () => {
    usePanesStore.getState().openActivity();
    onClose();
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

      {/* — the Brain (v3.7): file a staged note into an area, or show where it landed — */}
      {staged && areas.length > 0 && (
        <div className="metabrain">
          <div className="aalabel">File to the Brain</div>
          <div className="metafile-areas">
            {areas.map((area) => (
              <button
                key={area}
                type="button"
                className="metafile-area"
                disabled={busy}
                onClick={() => void fileToArea(area)}
              >
                {area}
              </button>
            ))}
          </div>
        </div>
      )}
      {filedArea && (
        <div className="metabrain">
          <span className="metafiled">🧠 Filed in {filedArea}</span>
        </div>
      )}
      <button type="button" className="meta-activity" onClick={openActivity}>
        Brain Activity →
      </button>

      <div className="aalabel">Metadata</div>
      {err ? (
        <p className="metaempty">⚠ {err}</p>
      ) : !fm ? (
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
