// Rotli Web, folder mode: Chromium asks for the folder's permission again on
// a new visit, and until the user says yes the app boots on the older copy in
// browser storage — stale chats, and none of the per-chat models the Mac app
// keeps in the folder's settings (the owner, 2026-09-17: "web still isn't
// showing the model logo … if I cross reference with app"). A toast said so
// and vanished. This bar stays until the folder is back: one click, the
// browser's prompt, a reload from the real files.
//
// An IMPORTED copy is the other way to be stale: it never follows the vault
// (the owner, 2026-09-17: the app rewrote every chat, the web kept showing the
// copy from before). The same bar says what it is, how old it is, and offers
// the import again.

import { useEffect, useState } from "react";

import { isWebVault } from "../../lib/browserVault";
import { relativeLabel } from "../../lib/dateLabels";
import { connectedFolderName, importedCopyAge } from "../../services/webNotes";
import {
  type FolderVaultStatus,
  folderVaultStatus,
  reconnectFolderVault,
} from "../../services/webVaultFolder";
import { showFileNotice } from "../../state/fileNotice";
import { useWebVaultConnect } from "../../state/webVaultConnect";

export function FolderReconnectBar() {
  const [status, setStatus] = useState<FolderVaultStatus | null>(null);
  useEffect(() => {
    if (!isWebVault()) return;
    void folderVaultStatus().then(setStatus);
  }, []);
  const copy = isWebVault() ? importedCopyAge() : null;
  if (copy) {
    // subtle, and only when it matters (the owner, 2026-09-17): a copy taken
    // a while ago — or one from before the stamp existed — gets one muted
    // line; a fresh copy says nothing (Reconnect also lives in the vault menu)
    if (!copy.old) return null;
    const at = copy.at;
    return (
      <div className="sb-copy-age" role="status">
        <span>
          Copy of <strong>{connectedFolderName() ?? "your vault"}</strong>
          {at ? ` taken ${relativeLabel(at)} ago.` : "."}
        </span>{" "}
        <button
          type="button"
          className="sb-copy-reconnect"
          onClick={() => useWebVaultConnect.getState().show()}
        >
          Reconnect
        </button>
      </div>
    );
  }
  if (status?.kind !== "prompt") return null;
  const reconnect = () => {
    void reconnectFolderVault().then((granted) => {
      // a refusal keeps the bar — the folder is still the vault you meant
      if (!granted) showFileNotice(`“${status.name}” still needs permission — Reconnect asks again`);
    });
  };
  return (
    <div className="sb-reconnect" role="status">
      <span className="sb-reconnect-text">
        Your vault <strong>{status.name}</strong> needs permission again. Until then this is the last copy.
      </span>
      <button type="button" className="sb-reconnect-btn" onClick={reconnect}>
        Reconnect
      </button>
    </div>
  );
}
