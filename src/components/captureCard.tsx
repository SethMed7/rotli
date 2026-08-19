// Quick capture — the one-breath card (r2 frame C, CSS transfers): one field;
// first line becomes the title; footer = '→ Captures' chip · ⏎ save ·
// Esc dismiss (⌘⏎ save-and-open still works but is demoted to the palette —
// the r2 dedup call). Lives in its own frameless always-on-top
// transparent-edged window (?window=capture); renders standalone in a plain
// browser for review. The keys route through the registry's capture.* actions
// via the capture handle — the textarea only handles its own typing
// (Shift+⏎ = newline).

import { useEffect, useRef, useState } from "react";

import { setCaptureHandle } from "../keys/handles";
import {
  emitCaptureSave,
  finishCapture,
  hideCaptureWindow,
  isTauri,
  onCaptureAck,
  onCaptureShow,
  showMainWindow,
} from "../lib/tauri";
import { DEST } from "../services/destinations";
import { invalidateNotes } from "../services/hooks";
import { notesService, ulid } from "../services/notes";

const MAX_ROWS = 4;

export function CaptureCard() {
  const [text, setText] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const pendingRef = useRef<{ id: string; sent: string } | null>(null);

  const dismiss = () => {
    // hide the card + return focus where you were; the draft stays (re-summon resumes it)
    void finishCapture();
  };

  const save = (openAfter: boolean) => {
    const body = text.trim();
    if (!body) {
      dismiss(); // an empty ⏎ is a dismissal, quietly
      return;
    }
    if (isTauri()) {
      // the main webview owns the in-memory corpus; it saves + (maybe) opens.
      // The draft is NOT cleared here — only the main window's ack clears it,
      // so a capture emitted while that webview isn't listening (just after
      // launch, mid-reload) is never lost: re-summoning resumes the draft.
      const id = ulid();
      pendingRef.current = { id, sent: text };
      emitCaptureSave(id, body, openAfter);
      if (openAfter) {
        // ⌘⏎ — jump to the Board to see the card (the main window opens it)
        void hideCaptureWindow();
        void showMainWindow();
      } else {
        // ⏎ — drop the card and return to where you were; never surface the app
        void finishCapture();
      }
    } else {
      // browser review: save through the local service (onto the Board)
      setText("");
      void notesService.createNote(DEST.board, body, { secure: true }).then(() => invalidateNotes());
    }
  };

  // the saved capture landed in the corpus — clear the draft (unless the user
  // re-summoned and kept typing in the meantime)
  useEffect(
    () =>
      onCaptureAck((id) => {
        const pending = pendingRef.current;
        if (pending?.id !== id) return;
        pendingRef.current = null;
        setText((t) => (t === pending.sent ? "" : t));
      }),
    [],
  );

  // the registry's capture.save / capture.saveAndOpen / capture.dismiss route here
  useEffect(() => {
    setCaptureHandle({ save, dismiss });
    return () => setCaptureHandle(null);
  });

  // re-summoned: put the caret back in the field
  useEffect(() => onCaptureShow(() => taRef.current?.focus()), []);

  const rows = Math.min(MAX_ROWS, text.split("\n").length);

  return (
    <div className="capture-stage">
      <div className="capture" role="dialog" aria-label="Quick capture">
        <div className="cap-in">
          <textarea
            ref={taRef}
            autoFocus
            value={text}
            rows={rows}
            spellCheck={false}
            placeholder="Keep typing, or ⏎ to save…"
            aria-label="Quick capture"
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <div className="cap-foot">
          <span className="chip">→ Captures</span>
          <span className="grow" />
          <span>
            <kbd>⏎</kbd> save
          </span>
          <span>
            <kbd>Esc</kbd> dismiss
          </span>
        </div>
      </div>
    </div>
  );
}
