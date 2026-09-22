// Rotli Web: Change vault. A connected editor always has exactly one vault,
// so "connect" from the sidebar or Settings means: close this one here and
// choose again. Nothing in the vault changes; the browser only forgets which
// folder it opens, and setup asks.

import { useState } from "react";

import { leaveVault } from "../services/vaultBinding";
import { connectedFolderName, webVaultMode } from "../services/webNotes";
import { useWebVaultConnect } from "../state/webVaultConnect";
import { WebDialogFrame } from "./webDialogFrame";

/** What to say when the browser's picker (or its permission prompt) fails;
 * null when the user simply closed it. Pure; exported for setup. */
export function pickerFailure(reason: unknown): string | null {
  const message = reason instanceof Error ? reason.message : String(reason);
  return /abort/i.test(message) ? null : message;
}

export function WebVaultConnectDialog() {
  const open = useWebVaultConnect((s) => s.open);
  const hide = useWebVaultConnect((s) => s.hide);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) return null;
  const vault = connectedFolderName() ?? "this vault";
  const close = () => {
    setError(null);
    hide();
  };
  const change = () => {
    setBusy(true);
    setError(null);
    leaveVault().catch((reason) => {
      setBusy(false);
      setError(reason instanceof Error ? reason.message : String(reason));
    });
  };
  return (
    <WebDialogFrame
      id="web-connect"
      title="Change vault"
      busy={busy}
      onClose={close}
      actions={
        <>
          <button type="button" className="rename-btn" disabled={busy} onClick={close}>
            Cancel
          </button>
          <button type="button" className="rename-btn primary" disabled={busy} onClick={change}>
            Choose another vault…
          </button>
        </>
      }
    >
      <p className="web-connect-line">
        This browser opens “{vault}”{webVaultMode() === "helper" ? " through Rotli Helper" : ""}. Rotli will
        close it here and ask which vault to open. Nothing in the vault changes, and it stays on your
        computer.
      </p>
      {error && (
        <p role="alert" className="rename-error">
          {error}
        </p>
      )}
    </WebDialogFrame>
  );
}
