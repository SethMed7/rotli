import { useEffect, useState } from "react";

import { isWebVault } from "../../lib/browserVault";
import { connectedFolderName } from "../../services/webNotes";
import {
  type FolderVaultStatus,
  connectFolderVault,
  disconnectFolderVault,
  folderVaultStatus,
  reconnectFolderVault,
} from "../../services/webVaultFolder";

/** Settings → General in Rotli Web only: where the notes live, what that
 * means, and the way to a real folder on this computer (Chromium browsers).
 * Renders nothing in the desktop shell and in the browser twin. */
export function WebVaultSettings() {
  const web = isWebVault();
  const [status, setStatus] = useState<FolderVaultStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!web) return;
    void folderVaultStatus().then(setStatus);
  }, [web]);
  if (!web) return null;
  const folder = connectedFolderName();
  const run = (action: () => Promise<unknown>) => () => {
    setError(null);
    void action().catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  };
  return (
    <>
      <h4 className="sethead">Rotli Web</h4>
      <p className="lead">
        {folder ? (
          <>
            Your vault is the folder <strong>{folder}</strong> on this computer: every note is a file there,
            and the browser remembers only the folder. The same folder opens in Rotli for Mac.
          </>
        ) : (
          <>Your vault lives in this browser, on this device. Clearing this site&rsquo;s data removes it.</>
        )}{" "}
        Nothing is sent anywhere: the page&rsquo;s security policy forbids every outbound request.
      </p>
      {status?.kind === "unsupported" && (
        <p className="setnote">
          This browser can&rsquo;t open folders. Chrome, Edge, or Arc can; here, notes stay in browser
          storage.
        </p>
      )}
      {status?.kind === "none" && (
        <button type="button" className="ghostbtn" onClick={run(connectFolderVault)}>
          Open a folder on this computer…
        </button>
      )}
      {status?.kind === "prompt" && (
        <button type="button" className="ghostbtn" onClick={run(reconnectFolderVault)}>
          Reconnect &ldquo;{status.name}&rdquo;
        </button>
      )}
      {(status?.kind === "granted" || status?.kind === "prompt") && (
        <button type="button" className="ghostbtn" onClick={run(disconnectFolderVault)}>
          Use browser storage instead
        </button>
      )}
      {error && (
        <p className="setnote err" role="alert" aria-live="polite">
          {error}
        </p>
      )}
      <p className="setnote">
        Chat and every model, the Librarian, Breve, Word and sheet files, and Finder drops are in{" "}
        <a href="/" rel="noopener">
          Rotli for Mac
        </a>
        .
      </p>
    </>
  );
}
