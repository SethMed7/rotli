// The editing surface (Phase 1d): a CodeMirror 6 view wired to rotli. CM edits
// the note's markdown TEXT directly — the .md stays the source of truth — and
// livePreview.ts renders it WYSIWYG. This wrapper:
//   • mirrors CM ⇄ the shared model.ts buffer (so the debounced save, the dirty
//     dot, and multi-pane same-note sync are unchanged — model.ts still owns the
//     buffer; CM is just the surface over it),
//   • registers the format-command handle (⌘B / headings / lists reach here
//     through activeEditor()), so the format bar + chords keep working,
//   • carries the "/" slash menu, focus-mode typewriter + dimming, the Aa
//     font/size/measure, and the spell-check toggle.
// One view per (noteId, pane); EditorSurface keys it by noteId so it remounts on
// a note switch (fresh caret/scroll, no bleed).

import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { Compartment, EditorSelection, EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { type CSSProperties, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { clamp } from "../lib/clamp";
import { DEST } from "../services/destinations";
import { useNotes, useSearchableNotes } from "../services/hooks";
import { type MenuSpec, useContextMenu } from "../state/contextMenu";
import { useUiStore } from "../state/ui";
import type { NoteSummary } from "../types";
import { addBlockBelow, blockHandles, deleteBlock, moveBlock } from "./blockHandles";
import { blockRender } from "./blockRender";
import { rotliKeymap } from "./cmKeymap";
import { codeHighlight } from "./codeHighlight";
import {
  type EditorHandle,
  applyBlockToggle,
  applyBlockToggleAll,
  applyHeading,
  registerEditor,
  toggleInlineMark,
  unregisterEditor,
} from "./commands";
import { fmBlock } from "./fmBlock";
import { focusDim } from "./focusMode";
import { headingFolding, toggleHeadingFold } from "./headingFold";
import { ImageGenPopover } from "./imageGenPopover";
import { linkOpener, livePreview, noteIdFacet } from "./livePreview";
import { ensureDocument, getDocumentText, onDocumentChange, setDocumentText } from "./model";
import { rawMarkdown } from "./rawMarkdown";
import { pickerFence, slashInsertion } from "./slashActions";
import {
  type SlashItem,
  type SlashPickerMode,
  SlashMenu,
  adaptSlashInsertion,
  filterSlashItems,
  slashLineTarget,
  slashPlacement,
  slashQueryAtCaret,
} from "./slashMenu";
import { SlashPicker } from "./slashPicker";
import { stripMarkdown } from "./stripMarkdown";
import { tableRender } from "./tableRender";
import { buildTitleCounts, wikilinkLabel } from "./wikilink";
import { setWikilinkNotes } from "./wikilinkIndex";

interface SlashState {
  open: boolean;
  query: string;
  index: number;
  left: number;
  top: number;
  /** Opens upward when the caret row is too close to the window's bottom edge. */
  up: boolean;
}

interface PickerState {
  mode: SlashPickerMode;
  index: number;
  left: number;
  top: number;
  up: boolean;
  insertAt: number;
  continuation: string;
}

/** The /image-gen popover's anchor (engine + prompt → PNG in storage/images). */
interface ImageGenState {
  left: number;
  top: number;
  up: boolean;
  insertAt: number;
  continuation: string;
}

/** The floating format bar (bottom-center, ~42px tall, sitting 16px up) covers
 * the scroller's bottom strip. CM keeps the caret at least this many px above
 * the scroller's bottom edge when scrolling it into view, so typing on the last
 * line pushes the text UP instead of sliding behind the bar (Seth, 2026-06-24).
 * Matches the content's 90px bottom padding reserve. */
const FORMAT_BAR_SCROLL_MARGIN = 88;

// memo: the parent editor shell re-renders on caret ctx + header measurement
// state; with stable props this CM host must not re-render per caret move
// (perf audit 2026-07-30, finding 8).
export const CmEditor = memo(CmEditorImpl);

function CmEditorImpl({
  noteId,
  paneId,
  autoFocus = false,
  focusMode,
  fontSize,
  measureWidth,
  initialText,
  onContext,
  fmRaw = null,
  fmPath = null,
  fmGen = 0,
  fmErr = null,
  onFmCommit,
  onFmRead,
}: {
  noteId: string;
  paneId: string;
  autoFocus?: boolean;
  focusMode: boolean;
  fontSize: number;
  measureWidth: number;
  initialText: string;
  /** Report the caret's line + column up to the format bar (active states). */
  onContext: (line: string | null, selStart: number) => void;
  /** The note's RAW frontmatter block ("Show file metadata") — rendered as an
   * editable banner above the body; null hides it. Disk truth, verbatim. */
  fmRaw?: string | null;
  /** Absolute disk truth shown read-only above editable frontmatter. */
  fmPath?: string | null;
  /** Commit counter — bumped after every write attempt, so a refused/no-op
   * commit still rebuilds the banner from disk truth (same block string). */
  fmGen?: number;
  /** Why the last commit was refused (rendered inside the banner), or null. */
  fmErr?: string | null;
  /** Commit the user-typed block (blur / ⌘S) — the owner writes + re-reads. */
  onFmCommit?: (text: string) => void;
  /** Fresh disk truth on demand (the banner re-pulls it when editing starts). */
  onFmRead?: () => Promise<string>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const applyingExternal = useRef(false);
  const focusModeRef = useRef(focusMode);
  const onContextRef = useRef(onContext);
  onContextRef.current = onContext;

  const spellcheck = useUiStore((s) => s.spellcheck);
  const spellcheckRef = useRef(spellcheck);
  spellcheckRef.current = spellcheck;

  // the format bar overlaps the bottom of the scroller — keep the scroll margin
  // in step with whether it's showing (a Settings toggle). Read via a ref so the
  // facet picks up the live value without rebuilding the view.
  const formatBarVisible = useUiStore((s) => s.formatBarVisible);
  const formatBarRef = useRef(formatBarVisible);
  formatBarRef.current = formatBarVisible;

  // beautified (live WYSIWYG) vs raw markdown source — a view toggle (Aa panel).
  const rawEditor = useUiStore((s) => s.rawEditor);
  const rawEditorRef = useRef(rawEditor);
  rawEditorRef.current = rawEditor;

  // block handles (⠿ drag/add/remove) — a toggle (Aa panel); ON by default.
  const blockHandlesOn = useUiStore((s) => s.blockHandles);
  const blockHandlesRef = useRef(blockHandlesOn);
  blockHandlesRef.current = blockHandlesOn;
  // a grip click opens the SHARED context-menu host (remediation Batch 3, F13):
  // it clamps to the viewport itself (the short Quick Note window used to need
  // manual bottom-edge math) and brings Esc + arrow-key nav for free. The item
  // closures re-read viewRef at click time — the view can remount under an open
  // menu — and every close path hands focus back to the editor.
  const openBlockMenu = useCallback((_view: EditorView, pos: number, rect: DOMRect) => {
    const run = (fn: (view: EditorView, pos: number) => unknown) => () => {
      const view = viewRef.current;
      if (view) fn(view, pos);
    };
    const items: MenuSpec[] = [
      { kind: "action", label: "Add below", onClick: run(addBlockBelow) },
      { kind: "action", label: "Move up", onClick: run((v, p) => moveBlock(v, p, -1)) },
      { kind: "action", label: "Move down", onClick: run((v, p) => moveBlock(v, p, 1)) },
      { kind: "action", label: "Delete", danger: true, onClick: run(deleteBlock) },
    ];
    useContextMenu.getState().open(rect.right + 4, rect.top, items, {
      returnFocus: () => viewRef.current?.focus(),
    });
  }, []);

  // the reconfigurable slots, built once for the view's life — lazy init, not
  // `useRef(new Compartment())`: a ref's argument is evaluated on every render,
  // so that idiom constructed five throwaway Compartments per keystroke
  // (perf audit 2026-07-30, finding 24)
  const [comps] = useState(() => ({
    spell: new Compartment(),
    focus: new Compartment(),
    viewMode: new Compartment(),
    block: new Compartment(),
    fm: new Compartment(),
  }));
  const { spell: spellComp, focus: focusComp, viewMode: viewModeComp, block: blockComp, fm: fmComp } = comps;

  // the raw-metadata banner reads live values through refs (the view is built
  // once; the compartment effect below swaps the widget when disk truth moves)
  const fmRawRef = useRef(fmRaw);
  fmRawRef.current = fmRaw;
  const fmGenRef = useRef(fmGen);
  fmGenRef.current = fmGen;
  const fmErrRef = useRef(fmErr);
  fmErrRef.current = fmErr;
  const onFmCommitRef = useRef(onFmCommit);
  onFmCommitRef.current = onFmCommit;
  const onFmReadRef = useRef(onFmRead);
  onFmReadRef.current = onFmRead;
  const fmExt = useCallback(
    (block: string | null, gen: number, error: string | null) =>
      block == null
        ? []
        : fmBlock(
            block,
            fmPath,
            gen,
            error,
            (text) => onFmCommitRef.current?.(text),
            () => onFmReadRef.current?.() ?? Promise.resolve(block),
          ),
    [fmPath],
  );

  const [slash, setSlash] = useState<SlashState>({
    open: false,
    query: "",
    index: 0,
    left: 0,
    top: 0,
    up: false,
  });
  const [picker, setPicker] = useState<PickerState | null>(null);
  const pickerRef = useRef<PickerState | null>(null);
  pickerRef.current = picker;
  const [imageGen, setImageGen] = useState<ImageGenState | null>(null);
  const imageGenRef = useRef<ImageGenState | null>(null);
  imageGenRef.current = imageGen;
  const { notes: searchableNotes } = useSearchableNotes();
  // ARCHIVED notes still exist — their wikilinks must keep resolving (and
  // opening); only Trash reads as deleted → the missing look (Seth, 2026-07-28:
  // "if I delete then it should show like that")
  const archivedNotes = useNotes(DEST.archive).data;

  // Resolution reads only id + title + aliases, so the rebuild-and-redecorate
  // effect keys on THAT fingerprint — not on array identity, which churns per
  // save cycle while typing (snippet/updatedAt change) and used to force a
  // whole-document wikilink decoration recompute each time (perf audit
  // 2026-07-30, finding 9).
  const wikilinkSource = useMemo(() => {
    const archived = (archivedNotes ?? []).filter((n) => n.kind !== "file");
    const list = archived.length ? [...searchableNotes, ...archived] : searchableNotes;
    const key = list.map((n) => `${n.id} ${n.title} ${(n.aliases ?? []).join("")}`).join("\n");
    return { list, key };
  }, [searchableNotes, archivedNotes]);
  const wikilinkSourceRef = useRef(wikilinkSource);
  wikilinkSourceRef.current = wikilinkSource;
  useEffect(() => {
    setWikilinkNotes(wikilinkSourceRef.current.list);
    // re-decorate: the resolved-vs-missing wikilink look reads this index,
    // which lands async after the view first painted — an explicit (no-move)
    // selection transaction is the cheapest "selectionSet" rebuild trigger
    const view = viewRef.current;
    if (view) view.dispatch({ selection: view.state.selection });
  }, [wikilinkSource.key]);
  // the slash key-handler reads live state through this ref (the CM dom handler
  // is created once, but it must see the current query/index)
  const slashRef = useRef<{ open: boolean; handle: (e: KeyboardEvent) => boolean }>({
    open: false,
    handle: () => false,
  });

  // the format-command seam — operate on the live view's selection/line, reusing
  // the same pure transforms the old editor used (commands.ts)
  const handleRef = useRef<EditorHandle>({
    toggleFold: () => {
      const view = viewRef.current;
      if (view) {
        toggleHeadingFold(view);
        view.focus();
      }
    },
    toggleMark: (mark) => {
      const view = viewRef.current;
      if (!view) return;
      const r = view.state.selection.main;
      const line = view.state.doc.lineAt(r.head);
      const from = Math.max(r.from, line.from);
      const to = Math.min(r.to, line.to);
      const res = toggleInlineMark(line.text, from - line.from, to - line.from, mark);
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: res.line },
        selection: EditorSelection.range(line.from + res.selStart, line.from + res.selEnd),
        scrollIntoView: true,
      });
      view.focus();
    },
    setHeading: (level) => {
      const view = viewRef.current;
      if (!view) return;
      const r = view.state.selection.main;
      const line = view.state.doc.lineAt(r.head);
      const res = applyHeading(line.text, level);
      const col = clamp(r.head - line.from + res.delta, 0, res.line.length);
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: res.line },
        selection: EditorSelection.cursor(line.from + col),
        scrollIntoView: true,
      });
      view.focus();
    },
    toggleBlock: (kind) => {
      const view = viewRef.current;
      if (!view) return;
      const r = view.state.selection.main;
      const startLine = view.state.doc.lineAt(r.from);
      const endLine = view.state.doc.lineAt(r.to);
      // a multi-line selection toggles every spanned line (mixed → all on,
      // uniformly on → all off) and KEEPS the selection
      if (startLine.number !== endLine.number) {
        const lines = [];
        for (let n = startLine.number; n <= endLine.number; n++) lines.push(view.state.doc.line(n));
        const next = applyBlockToggleAll(
          lines.map((l) => l.text),
          kind,
        );
        const changes = lines.flatMap((l, i) => {
          const insert = next[i];
          return insert == null ? [] : [{ from: l.from, to: l.to, insert }];
        });
        if (changes.length === 0) return;
        const set = view.state.changes(changes);
        view.dispatch({
          changes: set,
          selection: EditorSelection.range(set.mapPos(r.anchor), set.mapPos(r.head)),
          scrollIntoView: true,
        });
        view.focus();
        return;
      }
      const line = startLine;
      const res = applyBlockToggle(line.text, kind);
      const col = clamp(r.head - line.from + res.delta, 0, res.line.length);
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: res.line },
        selection: EditorSelection.cursor(line.from + col),
        scrollIntoView: true,
      });
      view.focus();
    },
  });

  const pickPicker = useCallback(
    (mode: SlashPickerMode, note: NoteSummary) => {
      const view = viewRef.current;
      if (!view || picker == null) return;
      const at = picker.insertAt;
      let insert: string;
      let caret: number;
      if (mode === "linkNote") {
        const label = wikilinkLabel(note, buildTitleCounts(searchableNotes));
        insert = `[[${label}]]`;
        caret = insert.length;
      } else {
        insert = pickerFence(mode, note.id);
        caret = insert.length;
      }
      ({ insert, caret } = adaptSlashInsertion(insert, caret, picker.continuation));
      view.dispatch({
        changes: { from: at, to: at, insert },
        selection: EditorSelection.cursor(at + caret),
      });
      setPicker(null);
      view.focus();
    },
    [picker, searchableNotes],
  );

  const openPicker = useCallback(
    (
      mode: SlashPickerMode,
      insertAt: number,
      continuation: string,
      left: number,
      top: number,
      up: boolean,
    ) => {
      setSlash((s) => ({ ...s, open: false }));
      setPicker({ mode, index: 0, left, top, up, insertAt, continuation });
    },
    [],
  );

  const pickSlash = useCallback(
    (item: SlashItem) => {
      const view = viewRef.current;
      if (!view) return;
      const line = view.state.doc.lineAt(view.state.selection.main.head);
      const target = slashLineTarget(line.text);
      const contentFrom = line.from + target.from;
      if (item.op.kind === "picker" || item.op.kind === "imageGen") {
        const coords = view.coordsAtPos(contentFrom);
        const host = hostRef.current?.getBoundingClientRect();
        const up = coords != null && slashPlacement(coords.top, window.innerHeight - coords.bottom) === "up";
        const left = (coords?.left ?? 0) - (host?.left ?? 0);
        const top = up
          ? (coords?.top ?? 0) - (host?.top ?? 0) - 4
          : (coords?.bottom ?? 0) - (host?.top ?? 0) + 4;
        view.dispatch({
          changes: { from: contentFrom, to: line.to, insert: "" },
          selection: EditorSelection.cursor(contentFrom),
        });
        if (item.op.kind === "imageGen") {
          setSlash((s) => ({ ...s, open: false }));
          setImageGen({ insertAt: contentFrom, continuation: target.continuation, left, top, up });
          return;
        }
        openPicker(item.op.mode, contentFrom, target.continuation, left, top, up);
        return;
      }
      const insertion = slashInsertion(item.op);
      if (!insertion) return;
      const adapted = adaptSlashInsertion(insertion.insert, insertion.caret, target.continuation);
      view.dispatch({
        changes: { from: contentFrom, to: line.to, insert: adapted.insert },
        selection: EditorSelection.cursor(contentFrom + adapted.caret),
      });
      setSlash((s) => ({ ...s, open: false }));
      view.focus();
    },
    [openPicker],
  );

  // create the view ONCE per note/pane
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    ensureDocument(noteId, initialText);
    const startText = getDocumentText(noteId) ?? initialText;

    const reportContext = (view: EditorView) => {
      const r = view.state.selection.main;
      const line = view.state.doc.lineAt(r.head);
      onContextRef.current(line.text, r.head - line.from);
    };
    const detectSlash = (view: EditorView) => {
      if (pickerRef.current || imageGenRef.current) return;
      const r = view.state.selection.main;
      if (!r.empty) {
        setSlash((s) => (s.open ? { ...s, open: false } : s));
        return;
      }
      const line = view.state.doc.lineAt(r.head);
      const query = slashQueryAtCaret(line.text, r.head - line.from);
      if (query == null) {
        setSlash((s) => (s.open ? { ...s, open: false } : s));
        return;
      }
      const coords = view.coordsAtPos(line.from);
      const rect = view.dom.getBoundingClientRect();
      const up = coords != null && slashPlacement(coords.top, window.innerHeight - coords.bottom) === "up";
      setSlash({
        open: true,
        query,
        index: 0,
        left: coords ? coords.left - rect.left : 0,
        // anchored under the row when down, at the row's top edge when up —
        // the CSS `.up` variant opens the menu bottom-up from that anchor
        top: coords ? (up ? coords.top - rect.top : coords.bottom - rect.top) : 0,
        up,
      });
    };
    let typewriterQueued = false;
    const scheduleTypewriter = (view: EditorView) => {
      if (typewriterQueued) return;
      typewriterQueued = true;
      queueMicrotask(() => {
        typewriterQueued = false;
        if (!focusModeRef.current) return;
        view.dispatch({
          effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: "center" }),
        });
      });
    };

    // beautified copy: strip markdown markers from the selection so a copy reads
    // like what you see (no ** around a bold word). Raw mode copies verbatim.
    const copyStripped = (event: ClipboardEvent, v: EditorView, isCut: boolean): boolean => {
      if (rawEditorRef.current) return false;
      const r = v.state.selection.main;
      if (r.empty) return false;
      event.clipboardData?.setData("text/plain", stripMarkdown(v.state.sliceDoc(r.from, r.to)));
      event.preventDefault();
      if (isCut) {
        v.dispatch({
          changes: { from: r.from, to: r.to },
          selection: EditorSelection.cursor(r.from),
          userEvent: "delete.cut",
        });
      }
      return true;
    };

    const state = EditorState.create({
      doc: startText,
      extensions: [
        history(),
        // the slash menu owns ↑/↓/Enter/Esc while open — highest precedence so
        // it wins before the keymaps; stops propagation so Esc closes the menu
        // and never also hides the window (the old stopImmediatePropagation)
        Prec.highest(
          EditorView.domEventHandlers({
            keydown: (e) => (slashRef.current.open ? slashRef.current.handle(e) : false),
          }),
        ),
        Prec.high(keymap.of(rotliKeymap)),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        // never let the caret slide behind the floating format bar: CM treats
        // the bottom strip as invisible when scrolling the caret into view, so
        // typing the last line pushes the text up instead (Seth, 2026-06-24)
        EditorView.scrollMargins.of(() =>
          formatBarRef.current ? { bottom: FORMAT_BAR_SCROLL_MARGIN } : null,
        ),
        // A visible wikilink opens on click; ⌘-click opens an external Markdown
        // URL. Both read source text in raw and beautified modes, so this sits
        // outside the view-mode compartment.
        linkOpener,
        // heading folding (2026-08-04): sits OUTSIDE the view-mode compartment
        // so an outline survives toggling raw ⇄ beautified — the fold is a
        // property of the document you're reading, not of one rendering of it.
        headingFolding(),
        // per-note widget context: image srcs resolve against THIS note's
        // corpus root; table widgets key persisted column widths by the id
        noteIdFacet.of(noteId),
        viewModeComp.of(
          rawEditorRef.current ? rawMarkdown : [livePreview, blockRender, tableRender, codeHighlight],
        ),
        blockComp.of(blockHandlesRef.current ? blockHandles(openBlockMenu) : []),
        fmComp.of(fmExt(fmRawRef.current, fmGenRef.current, fmErrRef.current)),
        EditorView.domEventHandlers({
          copy: (e, v) => copyStripped(e, v, false),
          cut: (e, v) => copyStripped(e, v, true),
        }),
        spellComp.of(EditorView.contentAttributes.of({ spellcheck: String(spellcheckRef.current) })),
        focusComp.of(focusModeRef.current ? focusDim : []),
        placeholder("Write…"),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !applyingExternal.current) {
            setDocumentText(noteId, u.state.doc.toString());
          }
          if (u.docChanged || u.selectionSet || u.focusChanged) {
            reportContext(u.view);
            detectSlash(u.view);
            if (focusModeRef.current && u.selectionSet) scheduleTypewriter(u.view);
          }
        }),
      ],
    });
    const view = new EditorView({ state, parent: host });
    viewRef.current = view;
    // Reuse the existing scroller styling and shared paper-canvas theming, which
    // all targets .ed-scroll (themes.css) — the CM scroller becomes the canvas
    view.scrollDOM.classList.add("ed-scroll");

    // model → CM: another pane editing this same note pushes its text in here
    const unsub = onDocumentChange(noteId, () => {
      const text = getDocumentText(noteId);
      if (text == null) return;
      const cur = view.state.doc.toString();
      if (text === cur) return;
      applyingExternal.current = true;
      const head = Math.min(view.state.selection.main.head, text.length);
      view.dispatch({
        changes: { from: 0, to: cur.length, insert: text },
        selection: EditorSelection.cursor(head),
      });
      applyingExternal.current = false;
    });

    // captured once here — handleRef.current is set at construction and never
    // reassigned, but the cleanup below must read the SAME object it registered,
    // not whatever handleRef.current happens to be by the time it runs
    const handle = handleRef.current;
    registerEditor(paneId, handle);
    reportContext(view);

    if (autoFocus) {
      view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length), scrollIntoView: true });
      view.focus();
    }

    return () => {
      unsub();
      unregisterEditor(paneId, handle);
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, paneId]);

  // live spell-check toggle (default on; a Settings switch)
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: spellComp.reconfigure(EditorView.contentAttributes.of({ spellcheck: String(spellcheck) })),
    });
  }, [spellcheck, spellComp]);

  // focus mode on/off → add/remove the paragraph-dim plugin
  useEffect(() => {
    focusModeRef.current = focusMode;
    viewRef.current?.dispatch({ effects: focusComp.reconfigure(focusMode ? focusDim : []) });
  }, [focusMode, focusComp]);

  // beautified ⇄ raw markdown: swap WYSIWYG rendering for the IDE-like source
  // theme. Both modes edit the same Markdown text; only presentation changes.
  useEffect(() => {
    rawEditorRef.current = rawEditor;
    viewRef.current?.dispatch({
      effects: viewModeComp.reconfigure(
        rawEditor ? rawMarkdown : [livePreview, blockRender, tableRender, codeHighlight],
      ),
    });
  }, [rawEditor, viewModeComp]);

  // the raw-metadata banner: show/hide, swap in fresh disk truth after a commit,
  // and rebuild after a refused/no-op commit (fmGen bumps, block unchanged)
  useEffect(() => {
    viewRef.current?.dispatch({ effects: fmComp.reconfigure(fmExt(fmRaw, fmGen, fmErr)) });
  }, [fmRaw, fmGen, fmErr, fmComp, fmExt]);

  // block handles on/off → add/remove the gutter + drop handlers
  useEffect(() => {
    blockHandlesRef.current = blockHandlesOn;
    viewRef.current?.dispatch({
      effects: blockComp.reconfigure(blockHandlesOn ? blockHandles(openBlockMenu) : []),
    });
  }, [blockHandlesOn, blockComp, openBlockMenu]);

  // keep the slash key-handler bound to the current query + index
  useEffect(() => {
    slashRef.current.open = slash.open;
    slashRef.current.handle = (e: KeyboardEvent) => {
      const items = filterSlashItems(slash.query);
      const stop = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      switch (e.key) {
        case "ArrowDown":
          if (!items.length) return false;
          stop();
          setSlash((s) => ({ ...s, index: (s.index + 1) % items.length }));
          return true;
        case "ArrowUp":
          if (!items.length) return false;
          stop();
          setSlash((s) => ({ ...s, index: (s.index - 1 + items.length) % items.length }));
          return true;
        case "Enter": {
          if (!items.length) return false;
          stop();
          const it = items[slash.index] ?? items[0];
          if (it) pickSlash(it);
          return true;
        }
        case "Escape":
          stop();
          e.stopImmediatePropagation(); // never let Esc also reach app.hide
          setSlash((s) => ({ ...s, open: false }));
          return true;
        default:
          return false;
      }
    };
  }, [slash, pickSlash]);

  // only the query narrows the menu — re-filtering on every editor render was
  // pure churn (perf audit 2026-07-30, finding 24)
  const items = useMemo(() => filterSlashItems(slash.query), [slash.query]);
  return (
    <div className="rotli-cm-wrap" style={{ fontSize: `${fontSize}px` }}>
      <div
        className="rotli-cm-host"
        ref={hostRef}
        style={{ "--cm-measure": `${measureWidth}px` } as CSSProperties}
      />
      {picker && (
        <div
          className={picker.up ? "rotli-slash-anchor up" : "rotli-slash-anchor"}
          style={{ left: picker.left, top: picker.top }}
        >
          <SlashPicker
            mode={picker.mode}
            selectedIndex={picker.index}
            onHover={(i) => setPicker((p) => (p ? { ...p, index: i } : p))}
            onPick={(note) => pickPicker(picker.mode, note)}
            onClose={() => setPicker(null)}
          />
        </div>
      )}
      {imageGen && (
        <div
          className={imageGen.up ? "rotli-slash-anchor up" : "rotli-slash-anchor"}
          style={{ left: imageGen.left, top: imageGen.top }}
        >
          <ImageGenPopover
            onDone={(markdown) => {
              const view = viewRef.current;
              const at = imageGen.insertAt;
              setImageGen(null);
              if (!view) return;
              const clamped = Math.min(at, view.state.doc.length);
              const adapted = adaptSlashInsertion(markdown, markdown.length, imageGen.continuation);
              view.dispatch({
                changes: { from: clamped, to: clamped, insert: adapted.insert },
                selection: EditorSelection.cursor(clamped + adapted.caret),
              });
              view.focus();
            }}
            onClose={() => {
              setImageGen(null);
              viewRef.current?.focus();
            }}
          />
        </div>
      )}
      {slash.open && !picker && !imageGen && (
        <div
          className={slash.up ? "rotli-slash-anchor up" : "rotli-slash-anchor"}
          style={{ left: slash.left, top: slash.top }}
        >
          <SlashMenu
            query={slash.query}
            selectedIndex={Math.min(slash.index, items.length - 1)}
            onHover={(i) => setSlash((s) => ({ ...s, index: i }))}
            onPick={pickSlash}
          />
        </div>
      )}
    </div>
  );
}
