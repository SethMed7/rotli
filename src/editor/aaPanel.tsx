// The Aa panel (r3 frame C, narrowed by r5): typography ONLY — text size
// stepper + measure. A styling layer over the note, per-note and in-memory;
// NEVER written into the document. Heading levels live on the format bar.

import { type RefObject, useRef } from "react";
import { useTransientPopover } from "../lib/popover";
import {
  MAX_TEXT_SIZE,
  MIN_TEXT_SIZE,
  type Measure,
  TEXT_SIZE_STEP,
  useNoteStyle,
  useNoteStyleStore,
} from "../state/noteStyle";
import { useUiStore } from "../state/ui";

const MEASURES: { id: Measure; label: string }[] = [
  { id: "narrow", label: "Narrow" },
  { id: "comfort", label: "Comfort" },
  { id: "wide", label: "Wide" },
];

export function AaPanel({
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
  const style = useNoteStyle(noteId);
  const setSize = useNoteStyleStore((s) => s.setSize);
  const setMeasure = useNoteStyleStore((s) => s.setMeasure);
  const rawEditor = useUiStore((s) => s.rawEditor);
  const setRawEditor = useUiStore((s) => s.setRawEditor);
  const blockHandles = useUiStore((s) => s.blockHandles);
  const setBlockHandles = useUiStore((s) => s.setBlockHandles);

  return (
    <div className="aapanel" ref={ref} role="dialog" aria-label="Typography">
      <div className="aalabel">Text size</div>
      <div className="aarow">
        <div className="stepper">
          <button
            type="button"
            aria-label="Smaller text"
            disabled={style.size <= MIN_TEXT_SIZE}
            onClick={() => setSize(noteId, style.size - TEXT_SIZE_STEP)}
          >
            −
          </button>
          <span className="val">{style.size}</span>
          <button
            type="button"
            aria-label="Larger text"
            disabled={style.size >= MAX_TEXT_SIZE}
            onClick={() => setSize(noteId, style.size + TEXT_SIZE_STEP)}
          >
            +
          </button>
        </div>
      </div>
      <div className="aalabel">Measure</div>
      <div className="aarow">
        {MEASURES.map((m) => (
          <button
            type="button"
            key={m.id}
            className={style.measure === m.id ? "aaseg sel" : "aaseg"}
            onClick={() => setMeasure(noteId, m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      {/* View / Blocks / Canvas are GLOBAL knobs (ui store) — say so instead of
          letting them ride the per-note footer promise (#52, audit 2026-07) */}
      <div className="aalabel">View · all notes</div>
      <div className="aarow">
        <button
          type="button"
          className={!rawEditor ? "aaseg sel" : "aaseg"}
          onClick={() => setRawEditor(false)}
        >
          Beautified
        </button>
        <button
          type="button"
          className={rawEditor ? "aaseg sel" : "aaseg"}
          onClick={() => setRawEditor(true)}
        >
          Raw markdown
        </button>
      </div>
      <div className="aalabel">Blocks · all notes</div>
      <div className="aarow">
        <button
          type="button"
          className={!blockHandles ? "aaseg sel" : "aaseg"}
          onClick={() => setBlockHandles(false)}
        >
          Off
        </button>
        <button
          type="button"
          className={blockHandles ? "aaseg sel" : "aaseg"}
          onClick={() => setBlockHandles(true)}
        >
          Handles
        </button>
      </div>
      <div className="aanote">
        Text size &amp; measure are saved for this note; the &ldquo;all notes&rdquo; rows apply
        everywhere. Either way the note itself never changes — marks (bold, highlight…) are real
        markdown via the format bar.
      </div>
    </div>
  );
}
