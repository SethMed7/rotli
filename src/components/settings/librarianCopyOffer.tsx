// Settings → Librarian for a folder opened in place
// (docs/design/vault-copy-and-obsidian-compatibility.md). The Librarian moves
// and renames notes, so it never runs on a person's original; the way to it is
// a copy Rotli makes, with the Librarian on at Suggest.

import { useState } from "react";

import { copyAndOpen } from "../../services/vaultImport";
import { useUiStore } from "../../state/ui";
import { WhyCopy } from "../whyCopy";

export const IN_PLACE_LIBRARIAN_LINE =
  "This folder is connected in place, so the Librarian never organizes it: nothing here is moved or renamed.";

export function LibrarianCopyOffer({ root, label }: { root: string; label: string }) {
  const [busy, setBusy] = useState(false);
  const connectCopy = () => {
    setBusy(true);
    // the copy's progress and result show in their own dialog
    useUiStore.getState().setSettingsOpen(false);
    void copyAndOpen(root, label).finally(() => setBusy(false));
  };
  return (
    <>
      <p className="setnote">{IN_PLACE_LIBRARIAN_LINE}</p>
      <p className="setnote">
        To use the Librarian, connect a copy: Rotli copies “{label}” beside your vaults, and the Librarian
        organizes the copy, suggesting each change first. Your original stays exactly as it is.
      </p>
      <WhyCopy />
      <div className="memex-actions">
        <button type="button" className="ghostbtn" disabled={busy} onClick={connectCopy}>
          Connect a copy with the Librarian…
        </button>
      </div>
    </>
  );
}
