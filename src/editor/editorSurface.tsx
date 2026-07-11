// The editor shell (Phase 1d). The body is now a CodeMirror WYSIWYG surface
// (CmEditor) — this component keeps the chrome around it: the header-inline
// status (dot · chars · updated · where), the Aa typography panel, the focus-
// mode word count, and the bottom-center format bar. The shared model.ts buffer
// is still the source of truth (debounced save, dirty dot); CmEditor edits it.

import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { relativeLabel } from "../lib/dateLabels";
import { corpusNotePath, corpusRawFrontmatter, corpusWriteFrontmatterRaw } from "../lib/tauri";
import { invalidateNotes, useNote } from "../services/hooks";
import { MEASURE_MAX_WIDTH, useNoteStyle } from "../state/noteStyle";
import { useUiStore } from "../state/ui";
import { AaPanel } from "./aaPanel";
import { MetaGlyph } from "../components/glyphs";
import { useNoteMenu } from "../components/useNoteMenu";
import { useMainStore } from "../state/main";
import { mainHasNote } from "../services/mainTree";
import { brainLocationLabel, noteDiskFolder, noteLocationLabel } from "../lib/noteLocation";
import { BottomSlot } from "./bottomSlot";
import { CmEditor } from "./cmEditor";
import { FormatBar } from "./formatBar";
import { ensureDocument, flushNote, reloadDocumentIfClean, useDocumentDirty, useDocumentLines } from "./model";

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

/** "just now" must not read "just now" an hour later — a quiet half-minute
 * tick keeps the relative time honest without re-rendering the editor. */
function UpdatedAt({ ts }: { ts: number }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);
  return <>{relativeLabel(ts)}</>;
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
  const [narrow, setNarrow] = useState(false);
  // the caret's line + column, reported by CmEditor — the format bar's active
  // states read it (bold-on, heading level, list-on)
  const [ctx, setCtx] = useState<{ line: string | null; selStart: number }>({ line: null, selStart: 0 });

  const rootRef = useRef<HTMLDivElement>(null);
  const aaChipRef = useRef<HTMLButtonElement>(null);

  const style = useNoteStyle(noteId);
  const formatBarVisible = useUiStore((s) => s.formatBarVisible);
  const focusMode = useUiStore((s) => s.focusMode);
  const setFileMetadata = useUiStore((s) => s.setFileMetadata);
  const revealFocusedNote = useUiStore((s) => s.revealFocusedNote);
  // "In Main" indicator + the note's right-click menu (Seth #23, 2026-07-03: the
  // metadata popover is gone — the ≡ chip toggles metadata instantly, and Lock /
  // Secure / File-to-Brain / Add-to-Main live in the right-click menu).
  const inMain = useMainStore((s) => mainHasNote(s.manifest.tree, noteId));
  const openNoteMenu = useNoteMenu();

  // the note's real home — its Brain folder + corpus-relative path — shown
  // on the location chip so "where is this file?" is answerable (Seth, 2026-07-07).
  const [diskPath, setDiskPath] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    corpusNotePath(noteId)
      .then((p) => alive && setDiskPath(p))
      .catch(() => alive && setDiskPath(null));
    return () => {
      alive = false;
    };
  }, [noteId]);

  // "Show file metadata" (Seth, 2026-07-01): the raw frontmatter block, verbatim
  // from disk, rendered as an editable banner above the body. Fetched only while
  // the setting is on; null keeps the banner out of the CM view entirely.
  const fileMetadata = useUiStore((s) => s.fileMetadata);
  const [fmRaw, setFmRaw] = useState<string | null>(null);
  // commit counter + refusal message: a refused (or no-op) commit re-reads the
  // SAME block string, and both React's setState and the widget's eq() bail on
  // identical values — the user's unsaved text would sit in the banner looking
  // saved. Bumping the gen forces the banner to rebuild from disk truth, and
  // the error renders inside it (a console.warn is not feedback).
  const [fmGen, setFmGen] = useState(0);
  const [fmErr, setFmErr] = useState<string | null>(null);
  useEffect(() => {
    setFmErr(null); // a refusal never follows the note to another tab
    if (fileMetadata !== "show") {
      setFmRaw(null);
      return;
    }
    let alive = true;
    corpusRawFrontmatter(noteId)
      .then((block) => {
        if (alive) setFmRaw(block);
      })
      .catch(() => {
        if (alive) setFmRaw(null); // unreadable (browser demo, race) → no banner
      });
    return () => {
      alive = false;
    };
  }, [noteId, fileMetadata]);

  const commitFm = useCallback(
    (text: string) => {
      void (async () => {
        try {
          await corpusWriteFrontmatterRaw(noteId, text);
          setFmErr(null);
        } catch (e) {
          // refused (read-only note, stray --- line) — the re-read below
          // reverts the banner and the message renders inside it
          setFmErr(e instanceof Error ? e.message : String(e));
        }
        // re-read either way: a commit shows what Rust actually wrote (reserved
        // keys restored), a refusal snaps the banner back to the file
        try {
          setFmRaw(await corpusRawFrontmatter(noteId));
        } catch {
          /* keep the current banner */
        }
        setFmGen((g) => g + 1); // rebuild even when the block string is identical
        await invalidateNotes(); // pinned/secure/shelf may have moved
      })();
    },
    [noteId],
  );

  // the buffer exists as soon as the note loads — edits always hit one buffer.
  // When disk changes UNDER us (agent / another editor) and this buffer is
  // clean, adopt the new body so Main and Captures never show two versions of
  // the same file (Seth, 2026-07-09). Dirty local edits still win.
  useEffect(() => {
    if (!note) return;
    ensureDocument(note.id, note.body);
    reloadDocumentIfClean(note.id, note.body);
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
  const brainFolder = noteDiskFolder(note);
  const brainLocation = brainLocationLabel(brainFolder);
  const shelfLocation = brainLocationLabel(note.folderId);

  return (
    <div
      className="editor"
      ref={rootRef}
      style={{ "--cm-measure": `${measureWidth}px` } as CSSProperties}
    >
      {/* right-click the header chrome (never the text body — that keeps
          selection/spellcheck) → the note's menu: Lock · Secure · File to Brain ·
          Add to Main · … (Seth #23). Gated to the main editor: the Quick window
          has no context-menu host, so it keeps its native menu. */}
      <div
        className="ed-head"
        onContextMenu={autoFocus ? undefined : (e) => openNoteMenu(e, note)}
      >
        {createdLabel(note.createdAt)}
        <div className="slot">
          {/* header-inline status (r5): dot · chars · updated · where · Main. The
              dot is the whole save grammar: muted while edits are in flight, olive
              once the corpus confirmed them. No spinners. */}
          <div className="status-inline">
            <span className={dirty ? "dot-ok dirty" : "dot-ok"} />
            {text.length.toLocaleString()} chars
            <span className="sep" />
            <UpdatedAt ts={note.updatedAt} />
            <span className="sep" />
            On this Mac
            <span className="sep" />
            {/* where this note lives — click to reveal + scroll to it in the
                sidebar (Seth, 2026-07-03). ★ Main shows when it's in Main. */}
            <button
              type="button"
              className={inMain ? "ed-loc in-main" : "ed-loc"}
              title={`In the Brain: ${brainLocation}${
                shelfLocation !== brainLocation ? `\nShelf: ${shelfLocation}` : ""
              }${diskPath ? `\nOn disk: ${diskPath}` : ""}\nClick to reveal in the Brain`}
              onClick={() => revealFocusedNote("brain")}
            >
              {noteLocationLabel(brainFolder, inMain)}
            </button>
          </div>
          <button
            type="button"
            ref={aaChipRef}
            className={aaOpen ? "aachip on" : "aachip"}
            aria-haspopup="dialog"
            aria-expanded={aaOpen}
            onClick={() => setAaOpen(!aaOpen)}
          >
            Aa
          </button>
          <button
            type="button"
            className={fileMetadata === "show" ? "aachip on" : "aachip"}
            aria-pressed={fileMetadata === "show"}
            aria-label={fileMetadata === "show" ? "Hide metadata" : "Show metadata"}
            title={fileMetadata === "show" ? "Hide metadata" : "Show metadata"}
            onClick={() => setFileMetadata(fileMetadata === "show" ? "hide" : "show")}
          >
            <MetaGlyph size={15} />
          </button>
        </div>
      </div>
      {aaOpen && <AaPanel noteId={noteId} anchorRef={aaChipRef} onClose={() => setAaOpen(false)} />}
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
        fmRaw={focusMode ? null : fmRaw}
        fmGen={fmGen}
        fmErr={fmErr}
        onFmCommit={commitFm}
        onFmRead={() => corpusRawFrontmatter(noteId)}
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
