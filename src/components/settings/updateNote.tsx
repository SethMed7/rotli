// An update you can't miss (the owner, 2026-10-10: "some note to drop down and
// say so and then the settings icon to have a badge … something clear"). The
// Settings button wears a badge while an update waits, and a note drops down
// from it once per version per launch: Update opens Settings → General, where
// the install runs; Later closes the note and leaves the badge.

import { type RefObject, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { dispatch } from "../../keys/registry";
import { useAnchoredPopoverBox } from "../../lib/popover";
import { useUiStore } from "../../state/ui";

export function UpdateBadge({ badgeRef }: { badgeRef: RefObject<HTMLSpanElement | null> }) {
  return (
    <span ref={badgeRef} className="tb-update-badge" aria-hidden="true">
      <svg viewBox="0 0 10 10" width="8" height="8">
        <path
          d="M5 8.2V2M2.2 4.6 5 1.8l2.8 2.8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export function UpdateNote({ anchorRef }: { anchorRef: RefObject<HTMLSpanElement | null> }) {
  const available = useUiStore((s) => s.updateAvailable);
  const version = useUiStore((s) => s.updateVersion);
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  // the version whose note was answered this launch (Update or Later)
  const [answered, setAnswered] = useState<string | null>(null);
  const key = version ?? "update";
  const open = available && !settingsOpen && answered !== key;
  const noteRef = useRef<HTMLDivElement>(null);
  const box = useAnchoredPopoverBox(open, anchorRef, noteRef, { prefer: "down", gap: 8 });
  if (!open) return null;
  return createPortal(
    <div
      ref={noteRef}
      className="update-note"
      role="status"
      style={box ? { left: box.left, top: box.top } : { visibility: "hidden" }}
    >
      <p className="update-note-title">Update available</p>
      <p className="update-note-body">
        {version ? `Rotli ${version} is ready to install.` : "A new version of Rotli is ready to install."}
      </p>
      <div className="update-note-actions">
        <button type="button" className="ghostbtn" onClick={() => setAnswered(key)}>
          Later
        </button>
        <button
          type="button"
          className="primarybtn"
          onClick={() => {
            setAnswered(key);
            useUiStore.getState().setSettingsPaneRequest("general");
            dispatch("app.settings");
          }}
        >
          Update…
        </button>
      </div>
    </div>,
    document.body,
  );
}
