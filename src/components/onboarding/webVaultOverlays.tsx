// Rotli Web's vault overlays over a CONNECTED editor: Change vault, the
// "Reconnecting to your vault" cover while Rotli Helper doesn't answer (edits
// wait, unsaved, until it is back), and the one-time offer to copy notes an
// older Rotli Web kept inside this browser into the vault.

import { useEffect, useRef, useState } from "react";

import { unsavedDrafts } from "../../editor/model";
import { invalidateFolders, invalidateNotes } from "../../services/hooks";
import {
  type LegacyFile,
  clearLegacyBrowserFiles,
  copyLegacyInto,
  deferLegacyOffer,
  legacyFilesToCopy,
  legacyOfferDeferred,
} from "../../services/legacyBrowserNotes";
import { activeWebVaultDir } from "../../services/notes";
import { connectedFolderName, webVaultKey } from "../../services/webNotes";
import { journalKey, writeJournal } from "../../services/webUnsavedJournal";
import { useLegacyNotesOffer } from "../../state/legacyNotesOffer";
import { useVaultConnection } from "../../state/vaultConnection";
import { WebDialogFrame } from "../webDialogFrame";
import { WebVaultConnectDialog } from "../webVaultConnectDialog";

export function WebVaultOverlays() {
  useUnsavedJournal();
  return (
    <>
      <WebVaultConnectDialog />
      <ReconnectingCover />
      <LegacyNotesOffer />
    </>
  );
}

/** On unload, keep whatever the save dot still shows as unsaved; the next
 * boot writes it into the vault (services/webUnsavedJournal.ts). */
function useUnsavedJournal(): void {
  useEffect(() => {
    const vault = webVaultKey();
    if (!vault) return;
    const key = journalKey(vault);
    const keep = () => writeJournal(window.localStorage, key, unsavedDrafts());
    // restored from the back/forward cache: the page lives on and saves itself
    const resume = (event: PageTransitionEvent) => {
      if (event.persisted) window.localStorage.removeItem(key);
    };
    window.addEventListener("pagehide", keep);
    window.addEventListener("pageshow", resume);
    return () => {
      window.removeEventListener("pagehide", keep);
      window.removeEventListener("pageshow", resume);
    };
  }, []);
}

function ReconnectingCover() {
  const reconnecting = useVaultConnection((s) => s.reconnecting);
  const card = useRef<HTMLDivElement>(null);
  // take focus from the editor: nothing typed now could be saved yet
  useEffect(() => {
    if (reconnecting) card.current?.focus();
  }, [reconnecting]);
  if (!reconnecting) return null;
  return (
    <div
      className="web-vault-reconnecting"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="web-reconnect-title"
    >
      <div className="web-vault-reconnecting-card" ref={card} tabIndex={-1}>
        <h2 id="web-reconnect-title">Reconnecting to “{connectedFolderName() ?? "your vault"}”…</h2>
        <p>
          Rotli Helper stopped answering on this computer. Your latest changes are waiting and save the moment
          it is back. It starts by itself at login; to start it now, run{" "}
          <code>~/.rotli/bin/rotli-helper</code>.
        </p>
      </div>
    </div>
  );
}

function LegacyNotesOffer() {
  const [files, setFiles] = useState<LegacyFile[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Settings → General asks again after Not now
  const requested = useLegacyNotesOffer((s) => s.open);
  const hideRequest = useLegacyNotesOffer((s) => s.hide);
  useEffect(() => {
    const dir = activeWebVaultDir();
    const key = webVaultKey();
    if (!dir) return;
    if (!requested && key && legacyOfferDeferred(window.localStorage, key)) return;
    // only what the vault doesn't already hold; nothing left clears the browser's copy
    void legacyFilesToCopy(dir).then((found) => {
      setDone(null);
      setFiles(found.length > 0 ? found : null);
    });
  }, [requested]);
  if (!files) return null;
  const vault = connectedFolderName() ?? "your vault";
  const close = () => {
    // Not now (or ✕) before copying: don't ask again on every visit
    const key = webVaultKey();
    if (done === null && key) deferLegacyOffer(window.localStorage, key);
    setFiles(null);
    hideRequest();
  };
  const copy = () => {
    const dir = activeWebVaultDir();
    if (!dir) return;
    setBusy(true);
    setError(null);
    copyLegacyInto(dir, files)
      .then(async ({ written, failed }) => {
        await Promise.all([invalidateNotes(), invalidateFolders()]);
        if (failed.length > 0) {
          // the browser keeps everything until every file is safely in the vault
          setError(
            `${failed.length} could not be copied (${failed.slice(0, 3).join(", ")}). Nothing was removed from this browser; try again.`,
          );
          return;
        }
        await clearLegacyBrowserFiles();
        setDone(written);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setBusy(false));
  };
  return (
    <WebDialogFrame
      id="web-legacy-notes"
      title="Notes kept in this browser"
      busy={busy}
      onClose={close}
      actions={
        done === null ? (
          <>
            <button type="button" className="rename-btn" disabled={busy} onClick={close}>
              Not now
            </button>
            <button type="button" className="rename-btn primary" disabled={busy} onClick={copy}>
              {busy ? "Copying…" : `Copy into “${vault}”`}
            </button>
          </>
        ) : (
          <button type="button" className="rename-btn primary" onClick={close}>
            Done
          </button>
        )
      }
    >
      {done === null ? (
        <p className="web-connect-line">
          An earlier Rotli Web kept {files.length} {files.length === 1 ? "file" : "files"} inside this
          browser. Copy them into “{vault}” so they are real files? Nothing in the vault is overwritten: a
          file that differs lands beside yours, marked “from this browser”. The browser’s copy is removed
          after it is safely in the vault. Not now keeps them here; Settings → General can copy them later.
        </p>
      ) : (
        <p className="web-connect-line" role="status">
          {done === 0
            ? "Everything was already in the vault."
            : `Copied ${done} ${done === 1 ? "file" : "files"} into “${vault}”.`}
        </p>
      )}
      {error && (
        <p role="alert" className="rename-error">
          {error}
        </p>
      )}
    </WebDialogFrame>
  );
}
