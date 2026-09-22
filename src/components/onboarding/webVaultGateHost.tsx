// Rotli Web's setup wiring, kept out of the app shell: whether setup shows
// (whenever the vault isn't connected), setup itself (lazy — a connected
// boot never loads it), and the Welcome seeding an empty folder gets on its
// first connected boot.

import { Suspense, lazy, useEffect } from "react";

import { isWebVault } from "../../lib/browserVault";
import { webVaultIsFreshFolder } from "../../services/notes";
import { openWelcome } from "../../services/welcome";
import { useVaultConnection, vaultConnected } from "../../state/vaultConnection";

const WebVaultGate = lazy(() => import("./webVaultGate").then((m) => ({ default: m.WebVaultGate })));

/** A vault is required: no editor until one is connected. */
export function useWebVaultGateShown(): boolean {
  const connection = useVaultConnection((s) => s.connection);
  return isWebVault() && !vaultConnected(connection);
}

/** An EMPTY folder connected at boot becomes a vault: seed the Welcome folder
 * into it and land on its note, as a created Mac vault does. An existing
 * vault is never seeded over. */
export function useFreshFolderWelcome(): void {
  useEffect(() => {
    if (!isWebVault() || !webVaultIsFreshFolder()) return;
    void openWelcome().catch((cause) => console.warn("welcome folder seeding failed", cause));
  }, []);
}

export function WebVaultGateHost() {
  return (
    <div className="app-window">
      <Suspense fallback={null}>
        <WebVaultGate />
      </Suspense>
    </div>
  );
}
