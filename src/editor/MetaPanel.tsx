// The metadata panel (sits right of the Aa chip): the per-note AI LOCK + SECURE
// toggles and the Brain filing surface. The old k:v field editor is gone (Seth,
// 2026-07-01) — metadata now shows IN the note as the raw frontmatter block at
// the top of the file ("Show file metadata"); this panel keeps the switches and
// points there.

import { type RefObject, useEffect, useRef, useState } from "react";
import { useTransientPopover } from "../lib/popover";
import {
  type FrontmatterView,
  corpusFrontmatter,
  corpusNotePath,
  corpusSetLocked,
  corpusSetSecure,
} from "../lib/tauri";
import { fileNoteToArea, isStagedNote } from "../services/brainFiling";
import { invalidateNotes, useBrainAreas } from "../services/hooks";
import { usePanesStore } from "../state/panes";
import { useUiStore } from "../state/ui";
import { LockGlyph, MetaGlyph, ShieldGlyph } from "../components/glyphs";

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
  const fileMetadata = useUiStore((s) => s.fileMetadata);
  const setFileMetadata = useUiStore((s) => s.setFileMetadata);

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
  // is shared with the right-click drill (useBrainAreas).
  const staged = relPath != null && isStagedNote(relPath);
  const filedArea = relPath ? (/(?:^|\/)wiki\/([^/_][^/]*)\//.exec(relPath)?.[1] ?? null) : null;
  const areas = useBrainAreas();

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
      {err && <p className="metaempty">⚠ {err}</p>}
      {/* the raw view replaced the field list (Seth, 2026-07-01): metadata is
          the top of the FILE now — this is just the switch + the pointer */}
      <button
        type="button"
        className={fileMetadata === "show" ? "metalock on" : "metalock"}
        role="switch"
        aria-checked={fileMetadata === "show"}
        onClick={() => setFileMetadata(fileMetadata === "show" ? "hide" : "show")}
      >
        <MetaGlyph size={15} />
        <span>
          {fileMetadata === "show" ? "Metadata shown in the note" : "Show metadata in the note"}
        </span>
      </button>
      <p className="metaempty">
        The raw frontmatter appears at the top of the file, editable as plain text — also in
        Settings → General → Writing.
      </p>
    </div>
  );
}
