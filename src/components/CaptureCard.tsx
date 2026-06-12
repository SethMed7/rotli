// Quick capture — the one-breath card (r2 frame C, CSS transfers): r-mark +
// one field; first line becomes the title; footer = '→ Inbox' chip · ⏎ save ·
// Esc dismiss (⌘⏎ save-and-open still works but is demoted to the palette —
// the r2 dedup call). Lives in its own frameless always-on-top
// transparent-edged window (?window=capture); renders standalone in a plain
// browser for review. The keys route through the registry's capture.* actions
// via the capture handle — the textarea only handles its own typing
// (Shift+⏎ = newline).

import { useEffect, useRef, useState } from "react";
import rMark from "../brand/logo/r-mark.svg";
import { setCaptureHandle } from "../lib/captureHandle";
import {
  emitCaptureSave,
  hideCaptureWindow,
  isTauri,
  onCaptureShow,
  showMainWindow,
} from "../lib/tauri";
import { invalidateNotes } from "../services/hooks";
import { inboxFolder, notesService } from "../services/notes";

const MAX_ROWS = 4;

export function CaptureCard() {
  const [text, setText] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);

  const dismiss = () => {
    void hideCaptureWindow(); // the draft stays — summoning again resumes it
  };

  const save = (openAfter: boolean) => {
    const body = text.trim();
    if (!body) {
      dismiss(); // an empty ⏎ is a dismissal, quietly
      return;
    }
    setText("");
    if (isTauri()) {
      // the main webview owns the in-memory corpus; it saves + (maybe) opens
      emitCaptureSave(body, openAfter);
      void hideCaptureWindow();
      if (openAfter) void showMainWindow();
    } else {
      // browser review: save through the local service
      void notesService.createNote(inboxFolder.id, body).then(() => invalidateNotes());
    }
  };

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
          <img src={rMark} alt="" width={22} height={22} />
          <textarea
            ref={taRef}
            // biome-ignore lint: the card exists to type into
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
          <span className="chip">→ Inbox</span>
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
