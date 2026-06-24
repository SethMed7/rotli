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
import { focusDim } from "./focusMode";
import { livePreview } from "./livePreview";
import { ensureDocument, getDocumentText, onDocumentChange, setDocumentText } from "./model";
import { type SlashItem, SlashMenu, filterSlashItems } from "./SlashMenu";

interface SlashState {
  open: boolean;
  query: string;
  index: number;
  left: number;
  top: number;
}

export function CmEditor({
  noteId,
  paneId,
  autoFocus = false,
  focusMode,
  fontSize,
  measureWidth,
  initialText,
  onContext,
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

  const spellComp = useRef(new Compartment()).current;
  const focusComp = useRef(new Compartment()).current;

  const [slash, setSlash] = useState<SlashState>({ open: false, query: "", index: 0, left: 0, top: 0 });
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

  const pickSlash = useCallback((item: SlashItem) => {
    const view = viewRef.current;
    if (!view) return;
    const line = view.state.doc.lineAt(view.state.selection.main.head);
    let insert: string;
    let caret: number;
    if (item.op.kind === "code") {
      insert = "``"; // inline code on the cleared line, caret between the ticks
      caret = 1;
    } else if (item.op.kind === "heading") {
      const r = applyHeading("", item.op.level);
      insert = r.line;
      caret = r.line.length;
    } else {
      const r = applyBlockToggle("", item.op.block);
      insert = r.line;
      caret = r.line.length;
    }
    view.dispatch({
      changes: { from: line.from, to: line.to, insert },
      selection: EditorSelection.cursor(line.from + caret),
    });
    setSlash((s) => ({ ...s, open: false }));
    view.focus();
  }, []);

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
      const r = view.state.selection.main;
      if (!r.empty) {
        setSlash((s) => (s.open ? { ...s, open: false } : s));
        return;
      }
      const line = view.state.doc.lineAt(r.head);
      const m = /^\/(\w*)$/.exec(line.text);
      if (!m) {
        setSlash((s) => (s.open ? { ...s, open: false } : s));
        return;
      }
      const coords = view.coordsAtPos(line.from);
      const rect = view.dom.getBoundingClientRect();
      setSlash({
        open: true,
        query: m[1] ?? "",
        index: 0,
        left: coords ? coords.left - rect.left : 0,
        top: coords ? coords.bottom - rect.top : 0,
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
        livePreview,
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
    // reuse the existing scroller styling + glass paper-canvas theming, which
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

    registerEditor(paneId, handleRef.current);
    reportContext(view);

    if (autoFocus) {
      view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length), scrollIntoView: true });
      view.focus();
    }

    return () => {
      unsub();
      unregisterEditor(paneId, handleRef.current);
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
          stop();
          if (items.length) setSlash((s) => ({ ...s, index: (s.index + 1) % items.length }));
          return true;
        case "ArrowUp":
          stop();
          if (items.length) setSlash((s) => ({ ...s, index: (s.index - 1 + items.length) % items.length }));
          return true;
        case "Enter": {
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
      {slash.open && items.length > 0 && (
        <div className="rotli-slash-anchor" style={{ left: slash.left, top: slash.top }}>
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
