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
import { GLASS_CANVASES, useUiStore } from "../state/ui";

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
  const themeFamily = useUiStore((s) => s.themeFamily);
  const glassCanvas = useUiStore((s) => s.glassCanvas);
  const setGlassCanvas = useUiStore((s) => s.setGlassCanvas);

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
      {themeFamily === "glass" && (
        <>
          <div className="aalabel">Canvas</div>
          <div className="aarow">
            {GLASS_CANVASES.map((c) => (
              <button
                type="button"
                key={c.value}
                className={glassCanvas === c.value ? "aaseg sel" : "aaseg"}
                onClick={() => setGlassCanvas(c.value)}
              >
                {c.label}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="aanote">
        Styling lives with the editor, saved for this note — the note itself never changes. Marks
        (bold, highlight…) are real markdown via the format bar.
      </div>
    </div>
  );
}
