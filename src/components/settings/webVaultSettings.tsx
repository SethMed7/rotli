import { useState } from "react";

import { isWebVault } from "../../lib/browserVault";
import { connectedFolderName, exportWebVault, webVaultMode } from "../../services/webNotes";
import { useWebVaultConnect } from "../../state/webVaultConnect";

/** Settings → General in Rotli Web only: which vault this browser opens, how
 * it reaches it, and the way to another one. Renders nothing in the desktop
 * shell and in the browser twin. */
export function WebVaultSettings() {
  const web = isWebVault();
  const [error, setError] = useState<string | null>(null);
  const openChange = useWebVaultConnect((s) => s.show);
  if (!web) return null;
  const mode = webVaultMode();
  const folder = connectedFolderName();
  const exportZip = () => {
    setError(null);
    void exportWebVault().catch((reason) =>
      setError(reason instanceof Error ? reason.message : String(reason)),
    );
  };
  return (
    <>
      <h4 className="sethead">Rotli Web</h4>
      <p className="lead">
        Your vault is <strong>{folder}</strong> on this computer: every note is a file there, the same files
        Rotli for Mac reads.{" "}
        {mode === "helper"
          ? "This browser reaches it through Rotli Helper, which starts when you log in and touches only this folder."
          : "The browser remembers only this folder."}{" "}
        Nothing is sent anywhere: this page may talk only to your own computer.
      </p>
      <button type="button" className="ghostbtn" onClick={openChange}>
        Change vault…
      </button>
      <button type="button" className="ghostbtn" onClick={exportZip}>
        Export vault (.zip)
      </button>
      {error && (
        <p className="setnote err" role="alert" aria-live="polite">
          {error}
        </p>
      )}
      <p className="setnote">
        Chat runs through Rotli Helper on this computer (Home → Chat walks you through it); only a chat you
        start reaches the AI tool you chose, and secure notes never do. On-device models, the Librarian,
        Breve, Word and sheet files, and Finder drops are in{" "}
        <a href="/" rel="noopener">
          Rotli for Mac
        </a>
        .
      </p>
    </>
  );
}
