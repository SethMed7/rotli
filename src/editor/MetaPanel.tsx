// The metadata panel (sits right of the Aa chip): shows the note's frontmatter
// and the per-note AI LOCK. The lock writes a `locked: true` frontmatter line the
// eventual AI filer must respect ("don't touch this note"). Read-only display of
// the rest for now — id/created/updated + the foreign lines the AI fills later.

import { Fragment, type RefObject, useEffect, useRef, useState } from "react";
import { useTransientPopover } from "../lib/popover";
import { type FrontmatterView, corpusFrontmatter, corpusSetLocked } from "../lib/tauri";
import { invalidateNotes } from "../services/hooks";
import { LockGlyph } from "../components/glyphs";

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

  useEffect(() => {
    let alive = true;
    void corpusFrontmatter(noteId).then((f) => {
      if (alive) setFm(f);
    });
    return () => {
      alive = false;
    };
  }, [noteId]);

  const toggleLock = async () => {
    if (!fm) return;
    setBusy(true);
    try {
      await corpusSetLocked(noteId, !fm.locked);
      setFm(await corpusFrontmatter(noteId));
      await invalidateNotes();
    } finally {
      setBusy(false);
    }
  };

  const rows: [string, string][] = [];
  if (fm) {
    if (fm.created) rows.push(["created", fm.created]);
    if (fm.updated) rows.push(["updated", fm.updated]);
    for (const line of fm.fields) {
      const i = line.indexOf(":");
      if (i > 0) rows.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]);
    }
  }

  return (
    <div className="aapanel metapanel" ref={ref} role="dialog" aria-label="Metadata">
      <button
        type="button"
        className={fm?.locked ? "metalock on" : "metalock"}
        disabled={busy || !fm}
        onClick={() => void toggleLock()}
      >
        <LockGlyph size={15} open={!fm?.locked} />
        <span>{fm?.locked ? "Locked — the AI won't touch this note" : "Lock from the AI"}</span>
      </button>
      <div className="aalabel">Metadata</div>
      {rows.length > 0 ? (
        <dl className="metafields">
          {rows.map(([k, v], i) => (
            <Fragment key={`${k}-${i}`}>
              <dt>{k}</dt>
              <dd>{v || "—"}</dd>
            </Fragment>
          ))}
        </dl>
      ) : (
        <p className="metaempty">
          {fm ? "No metadata yet — the AI fills shelf, area, tags… later." : "Reading…"}
        </p>
      )}
    </div>
  );
}
