// The editor shell (Phase 1d). The body is now a CodeMirror WYSIWYG surface
// (CmEditor) — this component keeps the chrome around it: the header-inline
// status (dot · chars · updated · where), the Aa typography panel, the focus-
// mode word count, and the bottom-center format bar. The shared model.ts buffer
// is still the source of truth (debounced save, dirty dot); CmEditor edits it.

import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { useNote } from "../services/hooks";
import { MEASURE_MAX_WIDTH, useNoteStyle } from "../state/noteStyle";
import { useUiStore } from "../state/ui";
import { AaPanel } from "./AaPanel";
import { MetaPanel } from "./MetaPanel";
import { MetaGlyph } from "../components/glyphs";
import { BottomSlot } from "./BottomSlot";
import { CmEditor } from "./CmEditor";
import { FormatBar } from "./FormatBar";
import { ensureDocument, flushNote, useDocumentDirty, useDocumentLines } from "./model";

/** Below this pane width the format bar collapses its end groups into ⋯. */
const FORMAT_BAR_COLLAPSE_PX = 440;

/** Focus mode locks the column (~65ch) at a fixed size; the Aa layer resumes
 * when focus ends. Mirrors the old gate values. */
const FOCUS_SIZE = 15.5;
const FOCUS_MEASURE = 620;

function createdLabel(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function updatedLabel(ts: number): string {
  const mins = Math.round((Date.now() - ts) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/** "just now" must not read "just now" an hour later — a quiet half-minute
 * tick keeps the relative time honest without re-rendering the editor. */
function UpdatedAt({ ts }: { ts: number }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);
  return <>{updatedLabel(ts)}</>;
}

export function EditorSurface({
  noteId,
  paneId,
  autoFocus = false,
}: {
  noteId: string;
  paneId: string;
  /** Quick Note: land a typing caret on open (the main editor is click-to-edit). */
  autoFocus?: boolean;
}) {
  const note = useNote(noteId).data;
  const docLines = useDocumentLines(noteId);
  const dirty = useDocumentDirty(noteId);
  const queryLines = useMemo(() => note?.body.split("\n"), [note?.body]);
  const lines = docLines ?? queryLines;

  const [aaOpen, setAaOpen] = useState(false);
  const [metaOpen, setMetaOpen] = useState(false);
  const [narrow, setNarrow] = useState(false);
  // the caret's line + column, reported by CmEditor — the format bar's active
  // states read it (bold-on, heading level, list-on)
  const [ctx, setCtx] = useState<{ line: string | null; selStart: number }>({ line: null, selStart: 0 });

  const rootRef = useRef<HTMLDivElement>(null);
  const aaChipRef = useRef<HTMLButtonElement>(null);
  const metaChipRef = useRef<HTMLButtonElement>(null);

  const style = useNoteStyle(noteId);
  const formatBarVisible = useUiStore((s) => s.formatBarVisible);
  const focusMode = useUiStore((s) => s.focusMode);

  // the buffer exists as soon as the note loads — edits always hit one buffer
  useEffect(() => {
    if (note) ensureDocument(note.id, note.body);
  }, [note]);

  // leaving a note (tab switch, pane close, note switch) flushes its pending
  // debounced save — keystrokes are never parked in a timer behind your back
  useEffect(() => () => flushNote(noteId), [noteId]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setNarrow(el.clientWidth < FORMAT_BAR_COLLAPSE_PX));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!note || !lines) return <div className="editor" ref={rootRef} />;

  const text = lines.join("\n");
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const fontSize = focusMode ? FOCUS_SIZE : style.size;
  const measureWidth = focusMode ? FOCUS_MEASURE : MEASURE_MAX_WIDTH[style.measure];

  return (
    <div
      className="editor"
      ref={rootRef}
      style={{ "--cm-measure": `${measureWidth}px` } as CSSProperties}
    >
      <div className="ed-head">
        {createdLabel(note.createdAt)}
        <div className="slot">
          {/* header-inline status (r5): dot · chars · updated · where. The dot is
              the whole save grammar: muted while edits are in flight, olive once
              the corpus confirmed them. No spinners. */}
          <div className="status-inline">
            <span className={dirty ? "dot-ok dirty" : "dot-ok"} />
            {text.length.toLocaleString()} chars
            <span className="sep" />
            <UpdatedAt ts={note.updatedAt} />
            <span className="sep" />
            On this Mac
          </div>
          <button
            type="button"
            ref={aaChipRef}
            className={aaOpen ? "aachip on" : "aachip"}
            aria-haspopup="dialog"
            aria-expanded={aaOpen}
            onClick={() => {
              setMetaOpen(false);
              setAaOpen(!aaOpen);
            }}
          >
            Aa
          </button>
          <button
            type="button"
            ref={metaChipRef}
            className={metaOpen ? "aachip on" : "aachip"}
            aria-haspopup="dialog"
            aria-expanded={metaOpen}
            aria-label="Metadata & lock"
            title="Metadata & lock"
            onClick={() => {
              setAaOpen(false);
              setMetaOpen(!metaOpen);
            }}
          >
            <MetaGlyph size={15} />
          </button>
        </div>
      </div>
      {aaOpen && <AaPanel noteId={noteId} anchorRef={aaChipRef} onClose={() => setAaOpen(false)} />}
      {metaOpen && (
        <MetaPanel noteId={noteId} anchorRef={metaChipRef} onClose={() => setMetaOpen(false)} />
      )}
      <CmEditor
        key={noteId}
        noteId={noteId}
        paneId={paneId}
        autoFocus={autoFocus}
        focusMode={focusMode}
        fontSize={fontSize}
        measureWidth={measureWidth}
        initialText={note.body}
        onContext={(line, selStart) => setCtx({ line, selStart })}
      />
      {focusMode && (
        <div className="fwc" aria-hidden="true">
          {wordCount.toLocaleString()} words
        </div>
      )}
      {formatBarVisible && (
        <BottomSlot>
          <FormatBar ctx={ctx} narrow={narrow} />
        </BottomSlot>
      )}
    </div>
  );
}
