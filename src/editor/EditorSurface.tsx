// The hybrid markdown editor (phase 1b). Live render with a RAW ACTIVE LINE:
// the line holding the caret shows its raw markdown, syntax characters tinted
// clay-deep (r4, approved); every other line renders (r1 frame A). The active
// row is an auto-height textarea overlaid on an identically-metriced tinted
// <pre> twin — transparent text over the styled twin, so the caret never
// drifts. One shared document buffer per noteId across panes (model.ts);
// typing is local + synchronous, the service sync is debounced.

import {
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNote } from "../services/hooks";
import { MEASURE_MAX_WIDTH, useNoteStyle } from "../state/noteStyle";
import { useUiStore } from "../state/ui";
import { AaPanel } from "./AaPanel";
import { BottomSlot } from "./BottomSlot";
import {
  type EditorHandle,
  applyBlockToggle,
  applyHeading,
  releaseActiveEditor,
  setActiveEditor,
  toggleInlineMark,
} from "./commands";
import { FormatBar } from "./FormatBar";
import { editDocument, ensureDocument, useDocumentLines } from "./model";
import { RenderedLine, hasSyntax, parseBlock, rawSegments } from "./render";

/** Below this pane width the format bar collapses its end groups into ⋯.
 * The full 11-control bar measures ~392px — r5 approved the ⋯ only for
 * genuinely narrow panes, so the default three-pane (~524px editor) must
 * show all controls. */
const FORMAT_BAR_COLLAPSE_PX = 440;

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

/** Raw-text caret offset for a click point, measured against the twin
 * (identical metrics to the textarea), so the caret lands ~where clicked. */
function caretOffsetFromPoint(twin: HTMLElement, x: number, y: number): number | null {
  const doc = twin.ownerDocument;
  if (typeof doc.caretRangeFromPoint !== "function") return null;
  const range = doc.caretRangeFromPoint(x, y);
  if (!range || !twin.contains(range.startContainer)) return null;
  let offset = 0;
  const walker = doc.createTreeWalker(twin, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node === range.startContainer) return offset + range.startOffset;
    offset += node.textContent?.length ?? 0;
  }
  return null;
}

interface Selection {
  start: number;
  end: number;
}

export function EditorSurface({ noteId }: { noteId: string }) {
  const note = useNote(noteId).data;
  const docLines = useDocumentLines(noteId);
  const queryLines = useMemo(() => note?.body.split("\n"), [note?.body]);
  const lines = docLines ?? queryLines;

  const [active, setActiveState] = useState<number | null>(null);
  const [sel, setSel] = useState<Selection>({ start: 0, end: 0 });
  const [aaOpen, setAaOpen] = useState(false);
  const [narrow, setNarrow] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const twinRef = useRef<HTMLPreElement>(null);
  const aaChipRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rawRowRef = useRef<HTMLDivElement>(null);
  const pendingCaretRef = useRef<Selection | null>(null);
  const clickPointRef = useRef<{ x: number; y: number } | null>(null);

  const style = useNoteStyle(noteId);
  const formatBarVisible = useUiStore((s) => s.formatBarVisible);
  const focusMode = useUiStore((s) => s.focusMode);

  // word count idles back in after typing pauses (r3 frame E judge note)
  const [typing, setTyping] = useState(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markTyping = () => {
    setTyping(true);
    if (typingTimer.current !== null) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => setTyping(false), 1000);
  };
  useEffect(
    () => () => {
      if (typingTimer.current !== null) clearTimeout(typingTimer.current);
    },
    [],
  );

  // the buffer exists as soon as the note loads — edits always hit one buffer
  useEffect(() => {
    if (note) ensureDocument(note.id, note.body);
  }, [note]);

  // a fresh surface target = fresh edit state (tabs keep only view state)
  useEffect(() => {
    setActiveState(null);
    setAaOpen(false);
  }, [noteId]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setNarrow(el.clientWidth < FORMAT_BAR_COLLAPSE_PX));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const updateSel = (start: number, end: number) =>
    setSel((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));

  // ——— mutations (shared buffer; service sync is debounced inside) ———

  const ensure = () => {
    if (note) ensureDocument(note.id, note.body);
  };

  const setLine = (index: number, text: string) => {
    ensure();
    editDocument(noteId, (ls) => ls.map((l, i) => (i === index ? text : l)));
  };

  const moveTo = (index: number, col: number) => {
    const target = lines?.[index] ?? "";
    const c = Math.min(col, target.length);
    pendingCaretRef.current = { start: c, end: c };
    setActiveState(index);
  };

  const splitAt = (index: number, at: number) => {
    ensure();
    pendingCaretRef.current = { start: 0, end: 0 };
    setActiveState(index + 1);
    editDocument(noteId, (ls) => {
      const l = ls[index] ?? "";
      return [...ls.slice(0, index), l.slice(0, at), l.slice(at), ...ls.slice(index + 1)];
    });
  };

  /** List continuation (the standard editors' grammar, Seth 2026-06-12):
   * Enter inside a list item carries the marker onto the new line (numbered
   * lists count up); Enter on an EMPTY item clears it — the exit ramp. */
  const splitAtWithPrefix = (index: number, at: number, prefix: string) => {
    ensure();
    pendingCaretRef.current = { start: prefix.length, end: prefix.length };
    setActiveState(index + 1);
    editDocument(noteId, (ls) => {
      const l = ls[index] ?? "";
      return [...ls.slice(0, index), l.slice(0, at), prefix + l.slice(at), ...ls.slice(index + 1)];
    });
  };

  const joinWithPrevious = (index: number) => {
    if (!lines) return;
    ensure();
    const prevLen = (lines[index - 1] ?? "").length;
    pendingCaretRef.current = { start: prevLen, end: prevLen };
    setActiveState(index - 1);
    editDocument(noteId, (ls) => [
      ...ls.slice(0, index - 1),
      (ls[index - 1] ?? "") + (ls[index] ?? ""),
      ...ls.slice(index + 1),
    ]);
  };

  const joinWithNext = (index: number) => {
    ensure();
    editDocument(noteId, (ls) => [
      ...ls.slice(0, index),
      (ls[index] ?? "") + (ls[index + 1] ?? ""),
      ...ls.slice(index + 2),
    ]);
  };

  const toggleTask = (index: number) => () => {
    ensure();
    editDocument(noteId, (ls) =>
      ls.map((l, i) => {
        if (i !== index) return l;
        if (l.startsWith("- [ ] ")) return `- [x] ${l.slice(6)}`;
        if (l.startsWith("- [x] ")) return `- [ ] ${l.slice(6)}`;
        return l;
      }),
    );
  };

  // ——— registry seam: the focused editor handles editor.* actions ———

  const stateRef = useRef<{ lines: string[]; active: number | null; sel: Selection }>({
    lines: [],
    active: null,
    sel,
  });
  stateRef.current = { lines: lines ?? [], active, sel };

  const commandsRef = useRef<EditorHandle | null>(null);
  commandsRef.current = {
    toggleMark: (mark) => {
      const s = stateRef.current;
      if (s.active === null) return;
      const line = s.lines[s.active];
      if (line === undefined) return;
      const r = toggleInlineMark(line, s.sel.start, s.sel.end, mark);
      pendingCaretRef.current = { start: r.selStart, end: r.selEnd };
      setLine(s.active, r.line);
    },
    setHeading: (level) => {
      const s = stateRef.current;
      if (s.active === null) return;
      const line = s.lines[s.active];
      if (line === undefined) return;
      const r = applyHeading(line, level);
      const clamp = (n: number) => Math.max(0, Math.min(n + r.delta, r.line.length));
      pendingCaretRef.current = { start: clamp(s.sel.start), end: clamp(s.sel.end) };
      setLine(s.active, r.line);
    },
    toggleBlock: (kind) => {
      const s = stateRef.current;
      if (s.active === null) return;
      const line = s.lines[s.active];
      if (line === undefined) return;
      const r = applyBlockToggle(line, kind);
      const clamp = (n: number) => Math.max(0, Math.min(n + r.delta, r.line.length));
      pendingCaretRef.current = { start: clamp(s.sel.start), end: clamp(s.sel.end) };
      setLine(s.active, r.line);
    },
  };

  const handle = useMemo<EditorHandle>(
    () => ({
      toggleMark: (m) => commandsRef.current?.toggleMark(m),
      setHeading: (l) => commandsRef.current?.setHeading(l),
      toggleBlock: (k) => commandsRef.current?.toggleBlock(k),
    }),
    [],
  );

  useEffect(() => {
    setActiveEditor(handle);
    return () => releaseActiveEditor(handle);
  }, [handle]);

  // ——— caret application (after activation / programmatic edits) ———

  useLayoutEffect(() => {
    if (active === null) return;
    const ta = taRef.current;
    if (!ta) return;
    const pending = pendingCaretRef.current;
    const point = clickPointRef.current;
    if (document.activeElement !== ta && (pending || point || document.activeElement === document.body)) {
      ta.focus();
    }
    if (pending) {
      pendingCaretRef.current = null;
      ta.setSelectionRange(pending.start, pending.end);
      updateSel(pending.start, pending.end);
    } else if (point) {
      clickPointRef.current = null;
      const line = lines?.[active] ?? "";
      const twin = twinRef.current;
      // hit-test the twin, not the textarea sitting over it
      ta.style.pointerEvents = "none";
      const offset = twin ? caretOffsetFromPoint(twin, point.x, point.y) : null;
      ta.style.pointerEvents = "";
      const o = Math.min(offset ?? line.length, line.length);
      ta.setSelectionRange(o, o);
      updateSel(o, o);
    }
  });

  // ——— focus mode (r3 frame E): typewriter scroll + paragraph dimming ———

  const activeLineText = active !== null ? (lines?.[active] ?? null) : null;

  // hold the active line vertically centered while writing (typewriter)
  useLayoutEffect(() => {
    if (!focusMode || active === null) return;
    const scroller = scrollRef.current;
    const row = rawRowRef.current;
    if (!scroller || !row) return;
    const scrollerRect = scroller.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const top =
      scroller.scrollTop +
      (rowRect.top - scrollerRect.top) -
      (scrollerRect.height / 2 - rowRect.height / 2);
    scroller.scrollTop = Math.max(0, top);
  }, [focusMode, active, activeLineText]);

  // the active PARAGRAPH (contiguous non-blank block) stays lit; the rest dims
  const dimRange = useMemo<readonly [number, number] | null>(() => {
    if (!focusMode || active === null || !lines) return null;
    let start = active;
    let end = active;
    while (start > 0 && (lines[start - 1] ?? "").trim() !== "") start--;
    while (end < lines.length - 1 && (lines[end + 1] ?? "").trim() !== "") end++;
    return [start, end];
  }, [focusMode, active, lines]);

  // the title line never dims (r3 frame E shows it at full strength)
  const lineClass = (i: number): string =>
    dimRange && i > 0 && (i < dimRange[0] || i > dimRange[1]) ? "ed-line dim" : "ed-line";

  // ——— active-line keys (text editing only — command chords stay in the registry) ———

  /** Parse a list marker: bullets, numbered, tasks, quotes. Returns the marker
   * length, the marker for the NEXT line (numbers count up, tasks reset to
   * unchecked), and whether the item is empty (the exit-the-list signal). */
  const listPrefixOf = (
    line: string,
  ): { prefixLen: number; next: string; empty: boolean } | null => {
    const m = line.match(/^(\s*(?:- \[[ xX]\] |[-*] |\d+\. |> ))(.*)$/);
    if (!m) return null;
    const prefix = m[1] ?? "";
    const content = m[2] ?? "";
    const num = prefix.match(/^(\s*)(\d+)\. $/);
    const next = num
      ? `${num[1] ?? ""}${Number(num[2]) + 1}. `
      : prefix.replace(/\[[xX]\]/, "[ ]");
    return { prefixLen: prefix.length, next, empty: content.trim() === "" };
  };

  const singleVisualRow = (): boolean => {
    const twin = twinRef.current;
    if (!twin) return true;
    const lh = Number.parseFloat(getComputedStyle(twin).lineHeight) || 24;
    return twin.clientHeight < lh * 1.5;
  };

  const onTaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (active === null || !lines) return;
    if (event.metaKey || event.ctrlKey) return; // chords belong to the dispatcher
    const ta = event.currentTarget;
    const line = lines[active] ?? "";
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    const collapsed = start === end;
    const lastIndex = lines.length - 1;

    switch (event.key) {
      case "Enter": {
        event.preventDefault();
        const list = listPrefixOf(line);
        if (list && collapsed) {
          if (list.empty) {
            // Enter on an empty item exits the list (clears the marker)
            pendingCaretRef.current = { start: 0, end: 0 };
            setLine(active, "");
            break;
          }
          if (start >= list.prefixLen) {
            splitAtWithPrefix(active, start, list.next);
            break;
          }
        }
        splitAt(active, start);
        break;
      }
      case " ": {
        // "[ ]" (or "[]") + space at the start of a line becomes a task
        const before = line.slice(0, start);
        const box = before.match(/^(\s*)\[ ?\]$/);
        if (box && collapsed) {
          event.preventDefault();
          const indent = box[1] ?? "";
          const prefix = `${indent}- [ ] `;
          pendingCaretRef.current = { start: prefix.length, end: prefix.length };
          setLine(active, prefix + line.slice(start));
        }
        break;
      }
      case "Backspace":
        if (collapsed && start === 0 && active > 0) {
          event.preventDefault();
          joinWithPrevious(active);
        }
        break;
      case "Delete":
        if (collapsed && start === line.length && active < lastIndex) {
          event.preventDefault();
          joinWithNext(active);
        }
        break;
      case "ArrowUp":
        if (active > 0 && (start === 0 || singleVisualRow())) {
          event.preventDefault();
          moveTo(active - 1, start);
        }
        break;
      case "ArrowDown":
        if (active < lastIndex && (end === line.length || singleVisualRow())) {
          event.preventDefault();
          moveTo(active + 1, end);
        }
        break;
      case "ArrowLeft":
        if (collapsed && start === 0 && active > 0) {
          event.preventDefault();
          moveTo(active - 1, Number.MAX_SAFE_INTEGER);
        }
        break;
      case "ArrowRight":
        if (collapsed && start === line.length && active < lastIndex) {
          event.preventDefault();
          moveTo(active + 1, 0);
        }
        break;
    }
  };

  const onRowMouseDown = (index: number) => (event: MouseEvent) => {
    if (event.button !== 0) return;
    // keep focus continuity — the layout effect focuses the new textarea
    event.preventDefault();
    pendingCaretRef.current = null;
    clickPointRef.current = { x: event.clientX, y: event.clientY };
    setActiveState(index);
  };

  if (!note || !lines) return <div className="editor" ref={rootRef} />;

  const text = lines.join("\n");
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  // focus mode locks the column: ~65ch (the gate's 620px) at the gate's 15.5px —
  // the Aa layer resumes when focus ends
  const bodyStyle = focusMode
    ? { fontSize: "15.5px", maxWidth: 620 }
    : { fontSize: `${style.size}px`, maxWidth: MEASURE_MAX_WIDTH[style.measure] };

  return (
    <div className="editor" ref={rootRef} onMouseDownCapture={() => setActiveEditor(handle)}>
      <div className="ed-head">
        {createdLabel(note.createdAt)}
        <div className="slot">
          {/* header-inline status (r5): dot · chars · updated · where */}
          <div className="status-inline">
            <span className="dot-ok" />
            {text.length.toLocaleString()} chars
            <span className="sep" />
            {updatedLabel(note.updatedAt)}
            <span className="sep" />
            On this Mac
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
        </div>
      </div>
      {aaOpen && <AaPanel noteId={noteId} anchorRef={aaChipRef} onClose={() => setAaOpen(false)} />}
      <div className="ed-scroll" ref={scrollRef}>
        <div className="ed-body" style={bodyStyle}>
          {lines.map((line, i) =>
            i === active ? (
              <div
                className={hasSyntax(line) ? "ed-line raw" : "ed-line raw plain"}
                data-kind={parseBlock(line).kind}
                ref={rawRowRef}
                // biome-ignore lint: line index is the identity here
                key={i}
              >
                <pre className="raw-twin" ref={twinRef} aria-hidden="true">
                  {rawSegments(line)}
                  {"\u200B"}
                </pre>
                <textarea
                  ref={taRef}
                  className="raw-input"
                  value={line}
                  rows={1}
                  spellCheck={false}
                  aria-label={`Line ${i + 1}`}
                  onChange={(e) => {
                    markTyping();
                    setLine(i, e.target.value);
                  }}
                  onKeyDown={onTaKeyDown}
                  onSelect={(e) =>
                    updateSel(e.currentTarget.selectionStart ?? 0, e.currentTarget.selectionEnd ?? 0)
                  }
                  onBlur={() => setActiveState((a) => (a === i ? null : a))}
                />
              </div>
            ) : (
              <div
                className={lineClass(i)}
                data-kind={parseBlock(line).kind}
                // biome-ignore lint: line index is the identity here
                key={i}
                onMouseDown={onRowMouseDown(i)}
              >
                <RenderedLine line={line} onToggleTask={toggleTask(i)} />
              </div>
            ),
          )}
        </div>
      </div>
      {focusMode && (
        <div className={typing ? "fwc typing" : "fwc"} aria-hidden="true">
          {wordCount.toLocaleString()} words
        </div>
      )}
      {formatBarVisible && (
        <BottomSlot>
          <FormatBar ctx={{ line: activeLineText, selStart: sel.start }} narrow={narrow} />
        </BottomSlot>
      )}
    </div>
  );
}
