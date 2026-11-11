// The Librarian's introduction: what it may and may not do, and where files go.
// Split from activitySurface.tsx (its size ceiling) when it gained focus handling.

import { useRef } from "react";

import { containDialogFocus, useDialogFocus } from "../../lib/dialogFocus";
import { useTransientPopover } from "../../lib/popover";

/** The first-visit explainer — everything the Librarian may and may NOT do,
 * in one card. Re-openable any time from the header's help button. */
export function LibrarianIntro({
  onClose,
  onOpenSettings,
}: {
  onClose: () => void;
  onOpenSettings: (pane: "brain" | "security") => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const gotItRef = useRef<HTMLButtonElement>(null);
  useTransientPopover([cardRef], true, onClose);
  useDialogFocus(gotItRef);
  return (
    <div className="lib-intro-overlay" onKeyDown={containDialogFocus}>
      <div
        className="lib-intro"
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label="About the Librarian"
      >
        <h3>Meet the Librarian</h3>
        <p>
          Your vault is a folder of plain files. The Librarian keeps it tidy: it files new captures into the
          Library&rsquo;s areas and fills in organizational metadata, so you never have to.
        </p>
        <ul className="lib-intro-rules">
          <li>
            <strong>It only moves files and edits metadata</strong> — summary, tags, links, area. It never
            rewrites a single word inside your notes.
          </li>
          <li>
            <strong>It always skips</strong> locked notes, secure notes, and your hand-arranged Main. Those
            are yours alone.
          </li>
          <li>
            <strong>Secrets are found by patterns, not AI.</strong> The secret detector is on-device pattern
            matching (key shapes, card numbers, SSNs) — no model reads your notes to find them. A model only
            reads a note to organize it, and only the model you chose in Settings.
          </li>
          <li>
            <strong>Recorded actions stay reviewable</strong> — undo rechecks the current note and refuses if
            it changed.
          </li>
        </ul>
        <h4>Where your files go</h4>
        <ul className="lib-intro-rules">
          <li>
            <strong>New captures wait in intake</strong> until the quiet window passes and the Librarian can
            place them in a Library area.
          </li>
          <li>
            <strong>Library areas are ordinary folders</strong> under <code>wiki/</code>. The Markdown files
            remain readable and editable without Rotli.
          </li>
          <li>
            <strong>Main and named views are references</strong> stored in <code>.rotli/</code>, never extra
            copies of your notes. Reorganizing a view does not move the file.
          </li>
          <li>
            <strong>Archive, Trash, assets, and chats stay separate</strong> so lifecycle state and app data
            do not get mixed into your note folders.
          </li>
        </ul>
        <h4>Why this structure</h4>
        <p>
          One durable file has one physical home. Views can change freely around it, and the journal can
          reverse the Librarian&rsquo;s moves without reconciling duplicate content. That keeps the vault
          portable, inspectable, and useful when Rotli is closed.
        </p>
        <p className="lib-intro-trust">
          <strong>How much may it do?</strong> That&rsquo;s the ladder in Settings → Librarian:
          <br />
          <em>Suggest</em> — nothing happens until you approve it here. · <em>Tidy</em> — files new captures
          and fills metadata by itself; area overview pages still wait for your OK. · <em>Organize</em> — Tidy
          plus keeps each area&rsquo;s overview page fresh, all on its own; metadata suggestions never pile
          up. Only one thing always waits for you at every rung: filing a note it isn&rsquo;t sure about.
        </p>
        <div className="lib-intro-links" aria-label="Learn more">
          <button type="button" className="ghostbtn" onClick={() => onOpenSettings("brain")}>
            Librarian settings
          </button>
          <button type="button" className="ghostbtn" onClick={() => onOpenSettings("security")}>
            Security &amp; privacy
          </button>
          <button type="button" className="ghostbtn primary lib-intro-ok" ref={gotItRef} onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
