import { isWebVault } from "../../lib/browserVault";

/** Settings → General in Rotli Web only: where the notes live, what that
 * means, and what stays in the Mac app. Renders nothing in the desktop shell
 * and in the browser twin. */
export function WebVaultSettings() {
  if (!isWebVault()) return null;
  return (
    <>
      <h4 className="sethead">Rotli Web</h4>
      <p className="lead">
        Your vault lives in this browser, on this device. Nothing is sent anywhere: the page&rsquo;s security
        policy forbids every outbound request.
      </p>
      <p className="setnote">
        Clearing this site&rsquo;s data removes the vault, so keep what matters in a note you can copy out.
        Chat and every model, the Librarian, Breve, Word and sheet files, and Finder drops are in{" "}
        <a href="/" rel="noopener">
          Rotli for Mac
        </a>
        .
      </p>
    </>
  );
}
