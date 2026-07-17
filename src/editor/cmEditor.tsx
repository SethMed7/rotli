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

import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { Compartment, EditorSelection, EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { useUiStore } from "../state/ui";
import { rotliKeymap } from "./cmKeymap";
import {
  type EditorHandle,
  applyBlockToggle,
  applyHeading,
  registerEditor,
  toggleInlineMark,
  unregisterEditor,
} from "./commands";
import { blockRender } from "./blockRender";
import { fmBlock } from "./fmBlock";
import { addBlockBelow, blockHandles, deleteBlock, moveBlock } from "./blockHandles";
import { tableRender } from "./tableRender";
import { focusDim } from "./focusMode";
import { linkOpener, livePreview } from "./livePreview";
import { stripMarkdown } from "./stripMarkdown";
import { ensureDocument, getDocumentText, onDocumentChange, setDocumentText } from "./model";
import { type SlashItem, type SlashPickerMode, SlashMenu, filterSlashItems, slashPlacement, slashQueryAtCaret } from "./slashMenu";

/** Rough height of the 4-item block-action menu — the bottom-edge clamp bound. */
const BLOCK_MENU_ESTIMATE = 160;
import { SlashPicker } from "./slashPicker";
import { pickerFence, slashInsertion } from "./slashActions";
import { buildTitleCounts, wikilinkLabel } from "./wikilink";
import { setWikilinkNotes } from "./wikilinkIndex";
import { useSearchableNotes } from "../services/hooks";
import type { NoteSummary } from "../types";

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
}

/** The floating format bar (bottom-center, ~42px tall, sitting 16px up) covers
 * the scroller's bottom strip. CM keeps the caret at least this many px above
 * the scroller's bottom edge when scrolling it into view, so typing on the last
 * line pushes the text UP instead of sliding behind the bar (Seth, 2026-06-24).
 * Matches the content's 90px bottom padding reserve. */
const FORMAT_BAR_SCROLL_MARGIN = 88;

export function CmEditor({
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
  // the open block-action menu (anchored at a clicked handle), or null.
  const [blockMenu, setBlockMenu] = useState<{ pos: number; x: number; y: number } | null>(null);
  const openBlockMenu = useCallback((_view: EditorView, pos: number, rect: DOMRect) => {
    const host = hostRef.current?.getBoundingClientRect();
    // clamp so the 4-item menu never renders past the window's bottom edge
    // (the short Quick Note window clipped it)
    const maxY = window.innerHeight - (host?.top ?? 0) - BLOCK_MENU_ESTIMATE;
    setBlockMenu({
      pos,
      x: rect.right - (host?.left ?? 0) + 4,
      y: Math.min(rect.top - (host?.top ?? 0), maxY),
    });
  }, []);

  const spellComp = useRef(new Compartment()).current;
  const focusComp = useRef(new Compartment()).current;
  const viewModeComp = useRef(new Compartment()).current;
  const blockComp = useRef(new Compartment()).current;
  const fmComp = useRef(new Compartment()).current;

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

  const [slash, setSlash] = useState<SlashState>({ open: false, query: "", index: 0, left: 0, top: 0, up: false });
  const [picker, setPicker] = useState<PickerState | null>(null);
  const pickerRef = useRef<PickerState | null>(null);
  pickerRef.current = picker;
  const { notes: searchableNotes } = useSearchableNotes();

  useEffect(() => {
    setWikilinkNotes(searchableNotes);
  }, [searchableNotes]);
  // the slash key-handler reads live state through this ref (the CM dom handler
  // is created once, but it must see the current query/index)
  const slashRef = useRef<{ open: boolean; handle: (e: KeyboardEvent) => boolean }>({
    open: false,
    handle: () => false,
  });

  // the format-command seam — operate on the live view's selection/line, reusing
  // the same pure transforms the old editor used (commands.ts)
  const handleRef = useRef<EditorHandle>({
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
      const col = Math.max(0, Math.min(r.head - line.from + res.delta, res.line.length));
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
      const line = view.state.doc.lineAt(r.head);
      const res = applyBlockToggle(line.text, kind);
      const col = Math.max(0, Math.min(r.head - line.from + res.delta, res.line.length));
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
    (mode: SlashPickerMode, insertAt: number, left: number, top: number, up: boolean) => {
      setSlash((s) => ({ ...s, open: false }));
      setPicker({ mode, index: 0, left, top, up, insertAt });
    },
    [],
  );

  const pickSlash = useCallback(
    (item: SlashItem) => {
      const view = viewRef.current;
      if (!view) return;
      const line = view.state.doc.lineAt(view.state.selection.main.head);
      if (item.op.kind === "picker") {
        const coords = view.coordsAtPos(line.from);
        const host = hostRef.current?.getBoundingClientRect();
        const up =
          coords != null &&
          slashPlacement(coords.top, window.innerHeight - coords.bottom) === "up";
        const left = (coords?.left ?? 0) - (host?.left ?? 0);
        const top = up
          ? (coords?.top ?? 0) - (host?.top ?? 0) - 4
          : (coords?.bottom ?? 0) - (host?.top ?? 0) + 4;
        view.dispatch({
          changes: { from: line.from, to: line.to, insert: "" },
          selection: EditorSelection.cursor(line.from),
        });
        openPicker(item.op.mode, line.from, left, top, up);
        return;
      }
      const insertion = slashInsertion(item.op);
      if (!insertion) return;
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: insertion.insert },
        selection: EditorSelection.cursor(line.from + insertion.caret),
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
      if (pickerRef.current) return;
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
      const up =
        coords != null &&
        slashPlacement(coords.top, window.innerHeight - coords.bottom) === "up";
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
        // ⌘-click opens a markdown link (raw AND beautified — it reads the text,
        // not the decorations), so it sits outside the view-mode compartment
        linkOpener,
        viewModeComp.of(rawEditorRef.current ? [] : [livePreview, blockRender, tableRender]),
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

  // beautified ⇄ raw markdown: swap the live-preview decorations on/off
  useEffect(() => {
    rawEditorRef.current = rawEditor;
    viewRef.current?.dispatch({
      effects: viewModeComp.reconfigure(rawEditor ? [] : [livePreview, blockRender, tableRender]),
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
    if (!blockHandlesOn) setBlockMenu(null);
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

  const items = filterSlashItems(slash.query);
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
      {slash.open && !picker && (
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
      {blockMenu && (
        <>
          <div className="rotli-block-backdrop" onMouseDown={() => setBlockMenu(null)} />
          <div className="rotli-block-menu" style={{ left: blockMenu.x, top: blockMenu.y }} role="menu">
            {(
              [
                ["Add below", () => addBlockBelow(viewRef.current!, blockMenu.pos)],
                ["Move up", () => moveBlock(viewRef.current!, blockMenu.pos, -1)],
                ["Move down", () => moveBlock(viewRef.current!, blockMenu.pos, 1)],
                ["Delete", () => deleteBlock(viewRef.current!, blockMenu.pos)],
              ] as const
            ).map(([label, run]) => (
              <button
                type="button"
                key={label}
                role="menuitem"
                className={label === "Delete" ? "rotli-block-item danger" : "rotli-block-item"}
                onClick={() => {
                  if (viewRef.current) run();
                  setBlockMenu(null);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
