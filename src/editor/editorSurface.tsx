// The editor shell (Phase 1d). The body is now a CodeMirror WYSIWYG surface
// (CmEditor) — this component keeps the chrome around it: the header-inline
// status (dot · chars · updated · where), the Aa typography panel, the focus-
// mode word count, and the bottom-center format bar. The shared model.ts buffer
// is still the source of truth (debounced save, dirty dot); CmEditor edits it.

import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ChatGlyph, ChevronRight, MetaGlyph } from "../components/glyphs";
import { useNoteMenu } from "../components/useNoteMenu";
import { dispatch } from "../keys/registry";
import { relativeLabel } from "../lib/dateLabels";
import { LAUNCH_FEATURES } from "../lib/featurePolicy";
import { hotkeyHint } from "../lib/hotkeyHint";
import { brainLocationLabel, noteDiskFolder, noteLocationLabel } from "../lib/noteLocation";
import { corpusNoteAbsolutePath, corpusRawFrontmatter, corpusWriteFrontmatterRaw } from "../lib/tauri";
import { useNow } from "../lib/useNow";
import { listChatsForNote, openChatForNote, openNoteChat } from "../noteChat/composition";
import { isSink } from "../services/destinations";
import { invalidateNotes, useNote, useNoteIndex, useRestoreNote } from "../services/hooks";
import { restoreSinkItem } from "../services/itemLifecycle";
import { mainHasNote } from "../services/mainTree";
import { markNoteDraftChanged } from "../services/noteDrafts";
import { useChatSetupGuide } from "../state/chatSetupGuide";
import { type MenuSpec, useContextMenu } from "../state/contextMenu";
import { useHelperLink } from "../state/helperLink";
import { useMainStore } from "../state/main";
import { backId, forwardId, useNavHistory } from "../state/navHistory";
import { MEASURE_MAX_WIDTH, useNoteStyle } from "../state/noteStyle";
import { usePanesStore } from "../state/panes";
import { useUiStore } from "../state/ui";
import type { Note } from "../types";
import { AaPanel } from "./aaPanel";
import { BottomSlot } from "./bottomSlot";
import { CmEditor } from "./cmEditor";
import { FormatBar } from "./formatBar";
import {
  ensureDocument,
  flushNoteAfterPaint,
  reloadDocumentIfClean,
  useDocumentDirty,
  useDocumentSaveError,
  useDocumentLines,
} from "./model";

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
 * tick keeps the relative time honest without re-rendering the editor.
 *
 * The tick skips hidden windows: rotli lives in the menu bar, so this would
 * otherwise re-render every open editor pane twice a minute for hours nobody is
 * looking at. Coming back re-ticks immediately, so the label is fresh on sight
 * instead of up to 30s stale — the guard is also the better behavior. */
function UpdatedAt({ ts }: { ts: number }) {
  const now = useNow();
  return <>{relativeLabel(ts, now)}</>;
}

function NoteHistoryTrail({ compact }: { compact: boolean }) {
  const previousId = useNavHistory(backId);
  const nextId = useNavHistory(forwardId);
  const noteIndex = useNoteIndex();
  const previousTitle = previousId ? noteIndex.get(previousId)?.title || "Previous note" : null;
  const nextTitle = nextId ? noteIndex.get(nextId)?.title || "Next note" : null;

  if (!previousTitle && !nextTitle) return null;
  return (
    <nav className={compact ? "ed-trail compact" : "ed-trail"} aria-label="Note history">
      {previousTitle && (
        <button
          type="button"
          className="ed-trail-link"
          aria-label={`Back to ${previousTitle}`}
          title={`Back to ${previousTitle}${hotkeyHint(" — ⌘[")}`}
          onClick={() => dispatch("nav.back")}
        >
          <ChevronRight size={11} className="ed-trail-back" />
          {!compact && <span>{previousTitle}</span>}
        </button>
      )}
      {previousTitle && nextTitle && <span className="ed-trail-sep" aria-hidden="true" />}
      {nextTitle && (
        <button
          type="button"
          className="ed-trail-link"
          aria-label={`Forward to ${nextTitle}`}
          title={`Forward to ${nextTitle}${hotkeyHint(" — ⌘]")}`}
          onClick={() => dispatch("nav.forward")}
        >
          {!compact && <span>{nextTitle}</span>}
          <ChevronRight size={11} />
        </button>
      )}
    </nav>
  );
}

export function EditorSurface({
  noteId,
  paneId,
  autoFocus = false,
  focusOnMount = false,
  pending = false,
}: {
  noteId: string;
  paneId: string;
  /** Quick Note: land a typing caret on open (the main editor is click-to-edit). */
  autoFocus?: boolean;
  /** Keep focus across an optimistic pending → durable note handoff without
   * inheriting Quick Note's reduced chrome. */
  focusOnMount?: boolean;
  /** Command-T's durable file is still being created; a session-only shared
   * buffer already owns the real editor surface. */
  pending?: boolean;
}) {
  const [pendingCreatedAt] = useState(() => Date.now());
  const pendingNote = useMemo<Note>(
    () => ({
      id: noteId,
      title: "Untitled",
      snippet: "",
      folderId: "Inbox",
      diskFolderId: "wiki/_inbox",
      createdAt: pendingCreatedAt,
      updatedAt: pendingCreatedAt,
      pinned: false,
      body: "",
      revision: "pending",
    }),
    [noteId, pendingCreatedAt],
  );
  const storedNote = useNote(noteId, { enabled: !pending }).data;
  const note = pending ? pendingNote : storedNote;
  const dirty = useDocumentDirty(noteId);
  const saveError = useDocumentSaveError(noteId);

  const [aaOpen, setAaOpen] = useState(false);
  // Restore for a sink-resident note (declared up here: hooks before the
  // early return below). Files and boards go back by path, notes through
  // the lifecycle mutation — the split useNoteMenu makes (restoreSinkItem).
  const restoreNote = useRestoreNote();
  const [restoring, setRestoring] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [headerCompact, setHeaderCompact] = useState(false);
  // the caret's line + column, reported by CmEditor — the format bar's active
  // states read it (bold-on, heading level, list-on)
  const [ctx, setCtx] = useState<{ line: string | null; selStart: number }>({ line: null, selStart: 0 });

  const rootRef = useRef<HTMLDivElement>(null);
  const aaChipRef = useRef<HTMLButtonElement>(null);
  const chatChipRef = useRef<HTMLButtonElement>(null);
  // Rotli Web: paired with Rotli Helper, the chip opens chats like the app
  const chatReady = useHelperLink((s) => LAUNCH_FEATURES.chat || s.link !== null);

  /** The chat chip: a note owns MANY chats (the maintainer, 2026-07-30). No chats yet →
   * create the first directly; otherwise a picker menu lists them (newest work
   * first) + "New chat". ⌥-click skips the picker and continues the latest. */
  const chatChipError = (error: unknown) =>
    useUiStore
      .getState()
      .setRowActionError(
        `Couldn’t open a chat for “${note?.title || "this note"}” — ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
  const openChatChip = (continueLatest: boolean) => {
    if (!note) return;
    const openedNote = note;
    setChatBusy(true);
    useUiStore.getState().setRowActionError(null);
    const run = continueLatest
      ? openChatForNote(openedNote)
      : listChatsForNote(openedNote).then((chats) => {
          if (chats.length === 0) return openChatForNote(openedNote);
          const items: MenuSpec[] = [
            ...chats.map((chat) => ({
              kind: "action" as const,
              label: `${chat.title || chat.slug}${
                chat.modifiedMs ? ` — ${relativeLabel(chat.modifiedMs)}` : ""
              }`,
              onClick: () => openNoteChat(openedNote, chat.slug),
            })),
            { kind: "sep" as const },
            {
              kind: "action" as const,
              label: "New chat about this note",
              onClick: () => {
                setChatBusy(true);
                void openChatForNote(openedNote, { create: true })
                  .catch(chatChipError)
                  .finally(() => setChatBusy(false));
              },
            },
          ];
          const rect = chatChipRef.current?.getBoundingClientRect();
          useContextMenu.getState().open(rect?.left ?? 0, (rect?.bottom ?? 0) + 4, items);
        });
    void run.catch(chatChipError).finally(() => setChatBusy(false));
  };

  const style = useNoteStyle(noteId);
  const formatBarVisible = useUiStore((s) => s.formatBarVisible);
  const focusMode = useUiStore((s) => s.focusMode);
  const setFileMetadata = useUiStore((s) => s.setFileMetadata);
  const revealFocusedNote = useUiStore((s) => s.revealFocusedNote);
  const focusedPane = usePanesStore((s) => s.focusedPaneId === paneId);
  // "In Main" indicator + the note's right-click menu (the maintainer #23, 2026-07-03: the
  // metadata popover is gone — the ≡ chip toggles metadata instantly, while
  // lifecycle and security actions live in the right-click menu.
  const inMain = useMainStore((s) => mainHasNote(s.manifest.tree, noteId));
  const shownInMain = pending || inMain;
  const openNoteMenu = useNoteMenu();

  // the note's real home — its Brain folder + corpus-relative path — shown
  // on the location chip so "where is this file?" is answerable (the maintainer, 2026-07-07).
  const [diskPath, setDiskPath] = useState<string | null>(null);
  useEffect(() => {
    if (pending) return;
    let alive = true;
    corpusNoteAbsolutePath(noteId)
      .then((p) => alive && setDiskPath(p))
      .catch(() => alive && setDiskPath(null));
    return () => {
      alive = false;
    };
  }, [noteId, pending]);

  // "Show file metadata" (the maintainer, 2026-07-01): the raw frontmatter block, verbatim
  // from disk, rendered as an editable banner above the body. Fetched only while
  // the setting is on; null keeps the banner out of the CM view entirely.
  const fileMetadata = useUiStore((s) => s.fileMetadata);
  const previousFileMetadata = useRef(fileMetadata);
  const [scrollToTopSignal, setScrollToTopSignal] = useState(0);
  const [fmRaw, setFmRaw] = useState<string | null>(null);
  const fmRevision = useRef("");
  // commit counter + refusal message: a refused (or no-op) commit re-reads the
  // SAME block string, and both React's setState and the widget's eq() bail on
  // identical values — the user's unsaved text would sit in the banner looking
  // saved. Bumping the gen forces the banner to rebuild from disk truth, and
  // the error renders inside it (a console.warn is not feedback).
  const [fmGen, setFmGen] = useState(0);
  const [fmErr, setFmErr] = useState<string | null>(null);
  useEffect(() => {
    if (fileMetadata === "show" && previousFileMetadata.current !== "show" && focusedPane) {
      setScrollToTopSignal((signal) => signal + 1);
    }
    previousFileMetadata.current = fileMetadata;
  }, [fileMetadata, focusedPane]);
  useEffect(() => {
    setFmErr(null); // a refusal never follows the note to another tab
    fmRevision.current = "";
    if (pending || fileMetadata !== "show") {
      setFmRaw(null);
      return;
    }
    let alive = true;
    corpusRawFrontmatter(noteId)
      .then((opened) => {
        if (alive) {
          fmRevision.current = opened.revision;
          setFmRaw(opened.contents);
        }
      })
      .catch(() => {
        if (alive) setFmRaw(null); // unreadable (browser demo, race) → no banner
      });
    return () => {
      alive = false;
    };
  }, [noteId, fileMetadata, pending]);

  const commitFm = useCallback(
    (text: string) => {
      void (async () => {
        try {
          fmRevision.current = await corpusWriteFrontmatterRaw(noteId, text, fmRevision.current);
          markNoteDraftChanged(noteId); // an explicit fm edit = intent to keep
          setFmErr(null);
        } catch (e) {
          // refused (read-only note, stray --- line) — the re-read below
          // reverts the banner and the message renders inside it
          setFmErr(e instanceof Error ? e.message : String(e));
        }
        // re-read either way: a commit shows what Rust actually wrote (reserved
        // keys restored), a refusal snaps the banner back to the file
        try {
          const opened = await corpusRawFrontmatter(noteId);
          fmRevision.current = opened.revision;
          setFmRaw(opened.contents);
        } catch {
          /* keep the current banner */
        }
        setFmGen((g) => g + 1); // rebuild even when the block string is identical
        await invalidateNotes(); // pinned/secure/shelf may have moved
      })();
    },
    [noteId],
  );

  // Stable identities so the memoized CmEditor ignores parent re-renders
  // (caret ctx, header measurements) — the keystroke path no longer re-renders
  // this surface at all (perf audit 2026-07-30, finding 8).
  const onCmContext = useCallback((line: string | null, selStart: number) => setCtx({ line, selStart }), []);
  const onFmRead = useCallback(async () => {
    const opened = await corpusRawFrontmatter(noteId);
    fmRevision.current = opened.revision;
    return opened.contents;
  }, [noteId]);

  // the buffer exists as soon as the note loads — edits always hit one buffer.
  // When disk changes UNDER us (agent / another editor) and this buffer is
  // clean, adopt the new body so Main and Captures never show two versions of
  // the same file (the maintainer, 2026-07-09). Dirty local edits still win.
  useEffect(() => {
    if (!note || pending) return;
    ensureDocument(note.id, note.body, note.revision);
    reloadDocumentIfClean(note.id, note.body, note.revision);
  }, [note, pending]);

  // Closing/switching paints first; the existing debounce and quit/visibility
  // flushes still guarantee durability while the eager save advances after
  // that paint. Joining a very large note during React cleanup beachballed ⌘W.
  useEffect(
    () => () => {
      flushNoteAfterPaint(noteId);
    },
    [noteId],
  );

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setNarrow(el.clientWidth < FORMAT_BAR_COLLAPSE_PX);
      setHeaderCompact(el.clientWidth < 760);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!note) return <div className="editor" ref={rootRef} />;

  const fontSize = focusMode ? FOCUS_SIZE : style.size;
  const measureWidth = focusMode ? FOCUS_MEASURE : MEASURE_MAX_WIDTH[style.measure];
  const brainFolder = noteDiskFolder(note);
  const brainLocation = brainLocationLabel(brainFolder);

  const inSink = isSink(note.folderId);
  const restoreFromSink = async () => {
    setRestoring(true);
    try {
      await restoreSinkItem(note, restoreNote.mutateAsync);
    } catch (error) {
      useUiStore
        .getState()
        .setRowActionError(
          `Couldn’t restore “${note.title || "this note"}” — ${error instanceof Error ? error.message : String(error)}`,
        );
    } finally {
      setRestoring(false);
    }
  };
  const shelfLocation = brainLocationLabel(note.folderId);

  return (
    <div className="editor" ref={rootRef} style={{ "--cm-measure": `${measureWidth}px` } as CSSProperties}>
      {/* right-click the header chrome (never the text body — that keeps
          selection/spellcheck) → the note's lifecycle/security menu. Gated to
          the main editor: the Quick window
          has no context-menu host, so it keeps its native menu. */}
      <div
        className="ed-head"
        onContextMenu={autoFocus || pending ? undefined : (e) => openNoteMenu(e, note)}
      >
        <div className="ed-context">
          <span className="ed-date">{createdLabel(note.createdAt)}</span>
          {!autoFocus && focusedPane && <NoteHistoryTrail compact={headerCompact} />}
        </div>
        <div className="slot">
          {/* header-inline status (r5): dot · chars · updated · where · Main. The
              dot is the whole save grammar: muted while edits are in flight, olive
              once the corpus confirmed them. No spinners. */}
          <div className="status-inline">
            <span className={dirty ? "dot-ok dirty" : "dot-ok"} />
            <CharCount noteId={noteId} fallbackBody={note.body} />
            <span className="sep" />
            <UpdatedAt ts={note.updatedAt} />
            <span className="sep" />
            On this Mac
            <span className="sep" />
            {/* where this note lives — click to reveal + scroll to it in the
                sidebar (the maintainer, 2026-07-03). ★ Main shows when it's in Main. */}
            <button
              type="button"
              className={shownInMain ? "ed-loc in-main" : "ed-loc"}
              title={`In the Library: ${brainLocation}${
                shelfLocation !== brainLocation ? `\nShelf: ${shelfLocation}` : ""
              }${diskPath ? `\nOn disk: ${diskPath}` : ""}\nClick to reveal in the Library`}
              onClick={() => {
                if (!pending) revealFocusedNote("brain", noteId);
              }}
            >
              {noteLocationLabel(brainFolder, shownInMain)}
            </button>
          </div>
          {inSink && (
            // a note opened from Trash or Archive (2026-09-16): the one way
            // back is right here, the same branch the row menu dispatches
            <button
              type="button"
              className="aachip"
              disabled={pending || restoring}
              aria-label="Restore this note"
              title={`Restore — back to ${brainLocation === "Trash" || brainLocation === "Archive" ? "where it was" : brainLocation}`}
              onClick={() => void restoreFromSink()}
            >
              Restore
            </button>
          )}
          {
            <button
              type="button"
              ref={chatChipRef}
              className="aachip"
              disabled={chatBusy || pending}
              aria-label="Chats on this note"
              aria-haspopup="menu"
              title={
                chatReady
                  ? "Chats on this note — ⌥-click continues the latest"
                  : "Chats on this note — not set up on the web yet, click to see how"
              }
              onClick={(event) =>
                chatReady ? openChatChip(event.altKey) : useChatSetupGuide.getState().show()
              }
              onContextMenu={(event) => {
                event.preventDefault();
                if (chatReady) openChatChip(false);
                else useChatSetupGuide.getState().show();
              }}
            >
              <ChatGlyph size={15} />
            </button>
          }
          <button
            type="button"
            ref={aaChipRef}
            className={aaOpen ? "aachip on" : "aachip"}
            data-tour="typography"
            aria-haspopup="dialog"
            aria-expanded={aaOpen}
            onClick={() => setAaOpen(!aaOpen)}
          >
            Aa
          </button>
          <button
            type="button"
            data-hotkey="editor.toggleMetadata"
            className={fileMetadata === "show" ? "aachip on" : "aachip"}
            disabled={pending}
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
      {saveError && (
        <div className="ed-saveerr" role="alert">
          ⚠ This note isn’t saving — {saveError}. Your text is kept here and rotli keeps retrying.
        </div>
      )}
      <CmEditor
        key={noteId}
        noteId={noteId}
        paneId={paneId}
        autoFocus={autoFocus || focusOnMount || pending}
        focusMode={focusMode}
        fontSize={fontSize}
        measureWidth={measureWidth}
        initialText={note.body}
        initialRevision={note.revision}
        onContext={onCmContext}
        fmRaw={focusMode ? null : fmRaw}
        fmPath={diskPath}
        fmGen={fmGen}
        fmErr={fmErr}
        scrollToTopSignal={scrollToTopSignal}
        onFmCommit={commitFm}
        onFmRead={onFmRead}
      />
      {focusMode && <FocusWordCount noteId={noteId} fallbackBody={note.body} />}
      {formatBarVisible && (
        <BottomSlot>
          <FormatBar ctx={ctx} narrow={narrow} />
        </BottomSlot>
      )}
    </div>
  );
}

/** Focus mode's word count, isolated: it is the ONLY consumer of the live
 * buffer at this level, so per-keystroke recomputes stay inside this leaf
 * instead of re-rendering the whole editor shell (finding 8: the shell did
 * join + split + a word-count regex over the full document per keystroke,
 * with the count displayed only in focus mode). */
function FocusWordCount({ noteId, fallbackBody }: { noteId: string; fallbackBody: string }) {
  const lines = useDocumentLines(noteId);
  const wordCount = useMemo(() => {
    let words = 0;
    for (const line of lines ?? fallbackBody.split("\n")) {
      words += line.split(/\s+/).filter(Boolean).length;
    }
    return words;
  }, [lines, fallbackBody]);
  return (
    <div className="fwc" aria-hidden="true">
      {wordCount.toLocaleString()} words
    </div>
  );
}

/** The header's live char count — the other always-on buffer consumer. Same
 * isolation as FocusWordCount: per-keystroke recomputes re-render this span,
 * not the editor shell. */
function CharCount({ noteId, fallbackBody }: { noteId: string; fallbackBody: string }) {
  const lines = useDocumentLines(noteId);
  const chars = useMemo(() => {
    if (!lines) return fallbackBody.length;
    let total = lines.length ? lines.length - 1 : 0; // the joining newlines
    for (const line of lines) total += line.length;
    return total;
  }, [lines, fallbackBody]);
  return <>{chars.toLocaleString()} chars</>;
}
