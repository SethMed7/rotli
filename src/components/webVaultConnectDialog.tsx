// Rotli Web: what happens before the browser's own folder picker opens. The
// browser's dialog uses its own words ("upload", the site's address) and
// cannot be restyled, so Rotli says first, in its own voice, exactly what is
// about to happen and what is not: nothing leaves this computer — the page's
// security policy refuses every outbound request.

import { useState } from "react";

import { importFolderAndReload } from "../services/importedVault";
import { type FolderSupport, browserFolderSupportSync, connectFolderVault } from "../services/webVaultFolder";
import { useWebVaultConnect } from "../state/webVaultConnect";

/** The dialog's explanation for this browser. Pure; exported for tests. */
export function connectDialogCopy(support: FolderSupport): {
  title: string;
  lines: string[];
  action: string;
} {
  const promise =
    "Nothing leaves your computer. This page cannot make network requests — its security policy forbids them — so the files are read by the page and go nowhere else.";
  if (support.kind === "live") {
    return {
      title: "Connect a folder",
      lines: [
        "Your browser will open its own folder picker and ask whether Rotli may view and save changes to the folder you choose.",
        promise,
        "The browser remembers only the folder. Next time it asks once more, with one click.",
      ],
      action: "Choose folder…",
    };
  }
  const first =
    support.kind === "brave-off"
      ? "Brave ships the folder API switched off, so it can read a folder you pick but cannot write to it. Turn on brave://flags/#file-system-access-api and relaunch for a live folder."
      : `${support.browser} can read a folder you pick but cannot write to it.`;
  return {
    title: "Import a folder",
    lines: [
      first,
      "Your browser will show its own picker and may say “upload”: that is the browser's word for letting this page read the files.",
      promise,
      "Rotli keeps a copy of the folder's notes in this browser. Export vault (.zip) gives the files back.",
    ],
    action: "Choose folder…",
  };
}

export function WebVaultConnectDialog() {
  const open = useWebVaultConnect((s) => s.open);
  const hide = useWebVaultConnect((s) => s.hide);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) return null;
  const support = browserFolderSupportSync();
  const copy = connectDialogCopy(support);
  const close = () => {
    setError(null); // a stale refusal never greets the next opening
    hide();
  };
  const choose = () => {
    // the picker must open inside this click, so no await before it
    setBusy(true);
    setError(null);
    const action = support.kind === "live" ? connectFolderVault() : importFolderAndReload();
    action
      .then(() => setBusy(false))
      .catch((reason) => {
        setBusy(false);
        const message = reason instanceof Error ? reason.message : String(reason);
        // the user closed the picker: nothing to report
        if (/abort/i.test(message)) return;
        setError(message);
      });
  };
  return (
    <div className="rename-overlay" onMouseDown={busy ? undefined : close}>
      <div
        className="rename-card web-connect-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="web-connect-title"
        aria-busy={busy}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          close();
        }}
      >
        <h2 id="web-connect-title" className="rename-label">
          {copy.title}
        </h2>
        {copy.lines.map((line) => (
          <p key={line} className="web-connect-line">
            {line}
          </p>
        ))}
        {error && (
          <p role="alert" className="rename-error">
            {error}
          </p>
        )}
        <div className="rename-actions">
          <button type="button" className="rename-btn" disabled={busy} onClick={close}>
            Cancel
          </button>
          <button type="button" className="rename-btn primary" disabled={busy} onClick={choose}>
            {busy ? "Waiting for the browser…" : copy.action}
          </button>
        </div>
      </div>
    </div>
  );
}
