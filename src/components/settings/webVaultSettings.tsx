import { useEffect, useState } from "react";

import { isWebVault } from "../../lib/browserVault";
import { forgetImportedVault } from "../../services/importedVault";
import { connectedFolderName, exportWebVault, webVaultMode } from "../../services/webNotes";
import {
  type FolderSupport,
  type FolderVaultStatus,
  browserFolderSupport,
  disconnectFolderVault,
  folderVaultStatus,
  reconnectFolderVault,
} from "../../services/webVaultFolder";
import { useWebVaultConnect } from "../../state/webVaultConnect";

async function forgetImport(): Promise<void> {
  await forgetImportedVault();
  window.location.reload();
}

/** Settings → General in Rotli Web only: where the notes live, what that
 * means, and the way to a real folder on this computer — live where the
 * browser can (Chrome, Edge, Arc), a one-time import plus Export elsewhere.
 * Renders nothing in the desktop shell and in the browser twin. */
export function WebVaultSettings() {
  const web = isWebVault();
  const [status, setStatus] = useState<FolderVaultStatus | null>(null);
  const [support, setSupport] = useState<FolderSupport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const openConnect = useWebVaultConnect((s) => s.show);
  useEffect(() => {
    if (!web) return;
    void folderVaultStatus().then(setStatus);
    void browserFolderSupport().then(setSupport);
  }, [web]);
  if (!web) return null;
  const mode = webVaultMode();
  const folder = connectedFolderName();
  const run = (action: () => Promise<unknown>) => () => {
    setError(null);
    void action().catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  };
  return (
    <>
      <h4 className="sethead">Rotli Web</h4>
      <p className="lead">
        {mode === "folder" && (
          <>
            Your vault is the folder <strong>{folder}</strong> on this computer: every note is a file there,
            and the browser remembers only the folder. The same folder opens in Rotli for Mac.
          </>
        )}
        {mode === "imported" && (
          <>
            Your vault is a copy of the folder <strong>{folder}</strong>, kept in this browser. This browser
            can read a folder you pick but cannot write to it, so changes stay here until you export them.
          </>
        )}
        {mode === "browser" && (
          <>Your vault lives in this browser, on this device. Clearing this site&rsquo;s data removes it.</>
        )}{" "}
        Nothing is sent anywhere: the page&rsquo;s security policy forbids every outbound request.
      </p>
      {support?.kind === "brave-off" && (
        <p className="setnote">
          Brave ships the folder API switched off. Turn on <code>brave://flags/#file-system-access-api</code>,
          relaunch, and a real folder can be the vault. Until then, a folder can be imported as a copy.
        </p>
      )}
      {support?.kind === "import-only" && (
        <p className="setnote">
          {support.browser} can read a folder you pick but cannot write to it. Chrome, Edge, or Arc open a
          folder live; here, Import keeps a copy and Export gives it back as a zip.
        </p>
      )}
      {support?.kind === "live" && status?.kind === "none" && (
        <button type="button" className="ghostbtn" onClick={openConnect}>
          Open a folder on this computer…
        </button>
      )}
      {support?.kind === "live" && status?.kind === "prompt" && (
        <button type="button" className="ghostbtn" onClick={run(reconnectFolderVault)}>
          Reconnect &ldquo;{status.name}&rdquo;
        </button>
      )}
      {support && support.kind !== "live" && (
        <button type="button" className="ghostbtn" onClick={openConnect}>
          {mode === "imported" ? "Import a folder again…" : "Import a folder…"}
        </button>
      )}
      {mode !== "browser" && (
        <button type="button" className="ghostbtn" onClick={run(exportWebVault)}>
          Export vault (.zip)
        </button>
      )}
      {(status?.kind === "granted" || status?.kind === "prompt") && (
        <button type="button" className="ghostbtn" onClick={run(disconnectFolderVault)}>
          Use browser storage instead
        </button>
      )}
      {mode === "imported" && (
        <button type="button" className="ghostbtn" onClick={run(forgetImport)}>
          Forget the imported copy
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
