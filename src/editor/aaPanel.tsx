// The Aa panel (r3 frame C, narrowed by r5): text size stepper + measure, a
// styling layer over the note, per-note and in-memory, NEVER written into the
// document. Heading levels live on the format bar. One row is about the NOTE
// rather than its look: Secure (the owner, 2026-09-18: "in the Aa area I need a
// toggle … and a little note of the hotkey"). It is a real frontmatter change
// through keys/noteProtectionActions, the same path the chord takes.

import { type RefObject, useEffect, useRef, useState } from "react";

import { formatChord } from "../keys/chords";
import { TOGGLE_SECURE_ACTION, toggleNoteSecure } from "../keys/noteProtectionActions";
import { currentChord } from "../keys/registry";
import { useTransientPopover } from "../lib/popover";
import { corpusFrontmatter, isTauri } from "../lib/tauri";
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
  // the note's own flag, read when the panel opens (null while unknown). Secure
  // is a Mac-app feature: the web has no frontmatter writer, so no dead switch.
  const [secure, setSecure] = useState<boolean | null>(null);
  const [secureErr, setSecureErr] = useState<string | null>(null);
  useEffect(() => {
    if (!isTauri()) return;
    let live = true;
    void corpusFrontmatter(noteId).then((fm) => live && setSecure(!!fm?.secure));
    return () => {
      live = false;
    };
  }, [noteId]);
  const chord = currentChord(TOGGLE_SECURE_ACTION);
  const pickSecure = (want: boolean) => {
    if (secure === null || secure === want) return;
    setSecureErr(null);
    toggleNoteSecure(noteId).then(setSecure, (error: unknown) =>
      setSecureErr(error instanceof Error ? error.message : String(error)),
    );
  };

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
      {isTauri() && (
        <>
          <div className="aalabel">
            Secure · this note{chord && <span className="aakey">{formatChord(chord)}</span>}
          </div>
          <div className="aarow" role="group" aria-label="Secure note">
            <button
              type="button"
              className={secure === false ? "aaseg sel" : "aaseg"}
              aria-pressed={secure === false}
              disabled={secure === null}
              onClick={() => pickSecure(false)}
            >
              Off
            </button>
            <button
              type="button"
              className={secure === true ? "aaseg sel" : "aaseg"}
              aria-pressed={secure === true}
              disabled={secure === null}
              onClick={() => pickSecure(true)}
            >
              Secure
            </button>
          </div>
          <div className="aahint">
            {secureErr ?? "A secure note is never sent to remote AI. On-device models can still read it."}
          </div>
        </>
      )}
      <div className="aanote">
        Text size &amp; measure are saved for this note; the &ldquo;all notes&rdquo; rows apply everywhere.
        Either way the note itself never changes — marks (bold, highlight…) are real markdown via the format
        bar.
      </div>
    </div>
  );
}
