// The hybrid markdown editor (phase 1b). Live render with a RAW ACTIVE LINE:
// the line holding the caret shows its raw markdown, syntax characters tinted
// clay-deep (r4, approved); every other line renders (r1 frame A). The active
// row is an auto-height textarea overlaid on an identically-metriced tinted
// <pre> twin — transparent text over the styled twin, so the caret never
// drifts. One shared document buffer per noteId across panes (model.ts);
// typing is local + synchronous, the service sync is debounced.
//
// SELECTION — click vs drag on the rendered lines (Seth 2026-06-13). A
// mousedown on a static (non-active) line does NOT activate immediately:
// we record the point + index and watch window mousemove. A plain CLICK
// (pointer never travels past ~4px) activates the line and drops the caret
// at the click point — the old behavior. A DRAG lets the browser run NATIVE
// selection across the static rendered lines; if a line was active we set
// active=null FIRST so its textarea becomes static and the selection can flow
// across that row too. Native selection can't cross the textarea<->div seam,
// so the active line drops out the instant a multi-line drag begins. Copying
// a multi-line selection yields the rendered VISIBLE text (markdown syntax is
// stripped) — acceptable for Stage 1; in-line copy on the active line is
// verbatim raw text.

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
  registerEditor,
  toggleInlineMark,
  unregisterEditor,
} from "./commands";
import { FormatBar } from "./FormatBar";
import {
  editDocument,
  ensureDocument,
  flushNote,
  useDocumentDirty,
  useDocumentLines,
} from "./model";
import { type SlashItem, SlashMenu, filterSlashItems } from "./SlashMenu";
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

export function EditorSurface({
  noteId,
  paneId,
  autoFocus = false,
}: {
  noteId: string;
  paneId: string;
  /** Quick Note: land an active typing caret on open (the main editor stays
   * click-to-edit). */
  autoFocus?: boolean;
}) {
  const note = useNote(noteId).data;
  const docLines = useDocumentLines(noteId);
  const dirty = useDocumentDirty(noteId);
  const queryLines = useMemo(() => note?.body.split("\n"), [note?.body]);
  const lines = docLines ?? queryLines;

  const [active, setActiveState] = useState<number | null>(null);
  const [sel, setSel] = useState<Selection>({ start: 0, end: 0 });
  const [aaOpen, setAaOpen] = useState(false);
  const [narrow, setNarrow] = useState(false);

  // — the "/" slash menu (Seth 2026-06-13): a LOCAL editor affordance, never a
  //   global key surface. Opens when the active line is exactly "/" + word chars
  //   (so "/" must lead the line — mid-text "/" has text before it and can't
  //   match). onTaKeyDown intercepts ↑/↓/Enter/Esc while open; everything else
  //   (typing, Backspace emptying the "/") closes it through the onChange test. —
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const [slashIndex, setSlashIndex] = useState(0);
  const closeSlash = () => {
    setSlashOpen(false);
    setSlashQuery("");
    setSlashIndex(0);
  };

  const rootRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const twinRef = useRef<HTMLPreElement>(null);
  const aaChipRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rawRowRef = useRef<HTMLDivElement>(null);
  const edBodyRef = useRef<HTMLDivElement>(null);
  const pendingCaretRef = useRef<Selection | null>(null);
  const clickPointRef = useRef<{ x: number; y: number } | null>(null);
  // ⌘A defers one frame: deactivate the line first (so the textarea isn't the
  // selection island), then select the whole rendered body (Seth, 2026-06-15).
  const pendingSelectAllRef = useRef(false);

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

  // a fresh surface target = fresh edit state (tabs keep only view state) —
  // and a fresh scroll: the previous note's position must not bleed over
  useEffect(() => {
    setActiveState(null);
    setAaOpen(false);
    closeSlash();
    scrollRef.current?.scrollTo({ top: 0 });
  }, [noteId]);

  // autoFocus (Quick Note, #7): the moment the note loads, drop an active typing
  // caret at the END of the content — opening the window lands you straight in
  // writing where you left off. Fires once per mount; the quick window remounts
  // on each show (a key nonce) so re-opens refocus. Placed AFTER the reset above
  // so it wins on mount.
  const didAutoFocusRef = useRef(false);
  useEffect(() => {
    if (!autoFocus || didAutoFocusRef.current || !lines) return;
    didAutoFocusRef.current = true;
    const last = Math.max(0, lines.length - 1);
    const end = (lines[last] ?? "").length;
    pendingCaretRef.current = { start: end, end };
    setActiveState(last);
  }, [autoFocus, lines]);

  // leaving a note (tab switch, pane close, note switch) flushes its pending
  // debounced save — keystrokes are never parked in a timer behind your back
  useEffect(() => () => flushNote(noteId), [noteId]);

  // ⌘A select-all: the ⌘A branch in onTaKeyDown drops the active line, then this
  // selects the whole rendered body (the drag-select model — copy yields the
  // visible text). Runs every render but no-ops unless the flag is armed.
  useEffect(() => {
    if (!pendingSelectAllRef.current) return;
    pendingSelectAllRef.current = false;
    const el = edBodyRef.current;
    const selection = window.getSelection();
    if (!el || !selection) return;
    selection.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(el);
    selection.addRange(range);
  });

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
        if (l.startsWith("- [x] ") || l.startsWith("- [X] ")) return `- [ ] ${l.slice(6)}`;
        return l;
      }),
    );
  };

  /** Pick a slash item: clear the "/query" the user typed FIRST (so the block
   * mutator sees an empty line — toggleBlock("bullet") on "" → "- " etc.), set
   * the caret to the new prefix end, then run the item. setLine + setHeading/
   * toggleBlock/toggleMark all flow through the same buffer, so the command
   * reads the cleared line. pendingCaretRef is overwritten by the mutator's own
   * caret (which is correct — it lands after the inserted prefix). */
  // Apply a slash item to the active line. We compute the result DIRECTLY from an
  // empty line via the canonical block functions — NOT through activeEditor(),
  // whose handle reads stateRef (still the stale "/query" this same tick) and
  // would compose "- /bul" instead of "- ". (Seth 2026-06-13)
  const applySlash = (item: SlashItem) => {
    if (active === null) return;
    const op = item.op;
    if (op.kind === "code") {
      // inline code on the now-empty line: "``" with the caret between the ticks
      pendingCaretRef.current = { start: 1, end: 1 };
      setLine(active, "``");
    } else {
      const r = op.kind === "heading" ? applyHeading("", op.level) : applyBlockToggle("", op.block);
      pendingCaretRef.current = { start: r.line.length, end: r.line.length };
      setLine(active, r.line);
    }
    closeSlash();
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
    registerEditor(paneId, handle);
    return () => unregisterEditor(paneId, handle);
  }, [paneId, handle]);

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
   * unchecked), and whether the item is empty (the exit-the-list signal).
   * The grammar is EXACTLY parseBlock's (column 0, `- ` bullets): continuation
   * must never produce a line the renderer reads as a plain paragraph. */
  const listPrefixOf = (
    line: string,
  ): { prefixLen: number; next: string; empty: boolean } | null => {
    // capture any leading indent so a nested item continues at the SAME depth
    const m = line.match(/^( *)((?:- \[[ xX]\] |- |\d+\. |> ))(.*)$/);
    if (!m) return null;
    const indent = m[1] ?? "";
    const prefix = m[2] ?? "";
    const content = m[3] ?? "";
    const num = prefix.match(/^(\d+)\. $/);
    const marker = num ? `${Number(num[1]) + 1}. ` : prefix.replace(/\[[xX]\]/, "[ ]");
    return { prefixLen: indent.length + prefix.length, next: indent + marker, empty: content.trim() === "" };
  };

  const singleVisualRow = (): boolean => {
    const twin = twinRef.current;
    if (!twin) return true;
    const lh = Number.parseFloat(getComputedStyle(twin).lineHeight) || 24;
    return twin.clientHeight < lh * 1.5;
  };

  const onTaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (active === null || !lines) return;

    // — slash menu owns ↑/↓/Enter/Esc while open (Seth 2026-06-13). Each branch
    //   preventDefaults + returns so the normal line-edit grammar is skipped.
    //   Esc also stops propagation so the editor's allowed-bare-Esc does NOT
    //   also reach the registry and hide the window. —
    if (slashOpen && !event.metaKey && !event.ctrlKey) {
      const matches = filterSlashItems(slashQuery);
      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          if (matches.length > 0) setSlashIndex((i) => (i + 1) % matches.length);
          return;
        case "ArrowUp":
          event.preventDefault();
          if (matches.length > 0) setSlashIndex((i) => (i - 1 + matches.length) % matches.length);
          return;
        case "Enter": {
          event.preventDefault();
          const item = matches[slashIndex] ?? matches[0];
          if (item) applySlash(item);
          return;
        }
        case "Escape":
          event.preventDefault();
          event.stopPropagation();
          // the registry Esc (app.hide) is a SEPARATE native window listener;
          // a synthetic stopPropagation won't reach it, so stop the native event
          // too — closing the menu must not also unwind the transient stack /
          // hide the window (Seth 2026-06-13).
          event.nativeEvent.stopImmediatePropagation();
          closeSlash();
          return;
      }
    }

    // ⌘A / ⌃A: select the WHOLE note (not just this line). Drop the active line
    // so the body is one selectable block, then the effect selects it.
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      setActiveState(null);
      pendingSelectAllRef.current = true;
      return;
    }
    if (event.metaKey || event.ctrlKey) return; // other chords belong to the dispatcher
    const ta = event.currentTarget;
    const line = lines[active] ?? "";
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    const collapsed = start === end;
    const lastIndex = lines.length - 1;

    switch (event.key) {
      case "Enter": {
        event.preventDefault();
        if (!collapsed) {
          // the selection is replaced by the line break (the standard grammar)
          setLine(active, line.slice(0, start) + line.slice(end));
          splitAt(active, start);
          break;
        }
        const list = listPrefixOf(line);
        if (list) {
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
      case "Tab": {
        // Tab works in your typing — indent (nest a list) instead of moving
        // focus to the format bar. Shift+Tab outdents. 2 spaces per level.
        if (event.shiftKey) {
          const removed = line.startsWith("  ") ? 2 : line.startsWith(" ") ? 1 : 0;
          // nothing to outdent → let Shift+Tab move focus natively (no trap)
          if (removed === 0) break;
          event.preventDefault();
          pendingCaretRef.current = {
            start: Math.max(0, start - removed),
            end: Math.max(0, end - removed),
          };
          setLine(active, line.slice(removed));
        } else {
          event.preventDefault();
          pendingCaretRef.current = { start: start + 2, end: end + 2 };
          setLine(active, `  ${line}`);
        }
        break;
      }
      case " ": {
        // "[ ]" (or "[]") + space at the start of a line becomes a task —
        // column 0 only, the renderer's task grammar
        const before = line.slice(0, start);
        if (/^\[ ?\]$/.test(before) && collapsed) {
          event.preventDefault();
          const prefix = "- [ ] ";
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

  /** Click vs drag on a static rendered line (Seth 2026-06-13). We do NOT
   * preventDefault on mousedown — that would kill the browser's native
   * selection before a drag could start. Instead we record the point and watch
   * window mousemove: travel past DRAG_THRESHOLD_PX = a DRAG (leave it to the
   * browser; drop the active line first so selection can flow across that row),
   * no travel by mouseup = a CLICK (activate the line, caret at the point). */
  const DRAG_THRESHOLD_PX = 4;
  const onRowMouseDown = (index: number) => (event: MouseEvent) => {
    if (event.button !== 0) return;
    const downX = event.clientX;
    const downY = event.clientY;
    let dragged = false;

    const onMove = (e: globalThis.MouseEvent) => {
      if (dragged) return;
      if (Math.abs(e.clientX - downX) > DRAG_THRESHOLD_PX || Math.abs(e.clientY - downY) > DRAG_THRESHOLD_PX) {
        dragged = true;
        // a textarea can't be the selection anchor for the static lines — let
        // the active line fall back to a rendered div so the drag spans it too
        setActiveState(null);
      }
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (dragged) return; // the browser owns the native selection on a drag
      // a plain click — activate the line and drop the caret at the click point
      // (the layout effect focuses the new textarea + hit-tests the twin)
      pendingCaretRef.current = null;
      clickPointRef.current = { x: downX, y: downY };
      setActiveState(index);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  /** autoFocus (#7): a click in the empty area BELOW the lines (not on a line)
   * lands the caret at the end of the content — "click anywhere to type". Gated
   * to autoFocus so the main editor's click/drag-select grammar is untouched. */
  const onBodyMouseDown = (event: MouseEvent) => {
    if (!autoFocus || event.button !== 0) return;
    if ((event.target as HTMLElement).closest(".ed-line")) return; // a line owns its click
    if (!lines || lines.length === 0) return;
    // CRITICAL: stop the native mousedown from moving focus to <body> — without
    // this it blurs the textarea we focus below, so clicking the empty area did
    // nothing and you couldn't type (#4).
    event.preventDefault();
    const last = lines.length - 1;
    const end = (lines[last] ?? "").length;
    pendingCaretRef.current = { start: end, end };
    setActiveState(last);
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
    <div className="editor" ref={rootRef}>
      <div className="ed-head">
        {createdLabel(note.createdAt)}
        <div className="slot">
          {/* header-inline status (r5): dot · chars · updated · where.
              The dot is the whole save grammar: muted while edits are in
              flight, olive once the corpus confirmed them. No spinners. */}
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
            onClick={() => setAaOpen(!aaOpen)}
          >
            Aa
          </button>
        </div>
      </div>
      {aaOpen && <AaPanel noteId={noteId} anchorRef={aaChipRef} onClose={() => setAaOpen(false)} />}
      <div className="ed-scroll" ref={scrollRef} onMouseDown={onBodyMouseDown}>
        <div className="ed-body" style={bodyStyle} ref={edBodyRef}>
          {lines.map((line, i) =>
            i === active ? (
              <div
                className={hasSyntax(line) ? "ed-line raw" : "ed-line raw plain"}
                data-kind={parseBlock(line).kind}
                ref={rawRowRef}
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
                    const v = e.target.value;
                    setLine(i, v);
                    // open on a leading "/" + word chars only — mid-text "/" has
                    // text before it and never matches. Backspace that empties
                    // the "/" fails the test → closes the menu here (no special
                    // case in onTaKeyDown). slashIndex resets so a new query
                    // always starts at the top item.
                    const m = /^\/(\w*)$/.exec(v);
                    if (m) {
                      setSlashOpen(true);
                      setSlashQuery(m[1] ?? "");
                      setSlashIndex(0);
                    } else if (slashOpen) {
                      closeSlash();
                    }
                  }}
                  onKeyDown={onTaKeyDown}
                  onSelect={(e) =>
                    updateSel(e.currentTarget.selectionStart ?? 0, e.currentTarget.selectionEnd ?? 0)
                  }
                  onBlur={() => setActiveState((a) => (a === i ? null : a))}
                />
                {slashOpen && (
                  <SlashMenu
                    query={slashQuery}
                    selectedIndex={slashIndex}
                    onHover={setSlashIndex}
                    onPick={applySlash}
                    anchorRef={rawRowRef}
                  />
                )}
              </div>
            ) : (
              <div
                className={lineClass(i)}
                data-kind={parseBlock(line).kind}
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
