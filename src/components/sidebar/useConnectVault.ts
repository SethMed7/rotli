// The one Connect flow (the vault menu's Connect, a folder window's Add as
// vault, and chat's empty state): pick a folder, then make it a vault — made
// fresh when empty, linked when it is a vault, and a folder of someone's notes
// asks first: Connect it in place, or Connect a copy with the Librarian.

import { isWebVault } from "../../lib/browserVault";
import { initMemexAsCorpus, pickVaultFolder } from "../../memex/service";
import { useChooseFolder, useConnectBrain } from "../../memex/useMemex";
import { inspectVaultFolder, openExistingFolder } from "../../services/vaultImport";
import { connectPlan } from "../../services/vaultSwitcher";
import { activateCreatedVault } from "../../state/activeVault";
import { flushSettingsNow } from "../../state/persist";
import { useWebVaultConnect } from "../../state/webVaultConnect";

export function useConnectVault() {
  const connectBrainMut = useConnectBrain();
  const chooseFolderMut = useChooseFolder();

  /** Resolves whether a vault opened or connected (false: "not now"). */
  const connectPath = async (path: string): Promise<boolean> => {
    const inspection = await inspectVaultFolder(path);
    const plan = connectPlan(inspection.kind);
    if (plan === "create") {
      await initMemexAsCorpus(path);
      await activateCreatedVault();
      return true;
    }
    if (plan === "link") {
      await connectBrainMut.mutateAsync(path);
      return true;
    }
    // a folder of someone's notes: a copy Rotli makes, or the folder in place
    return openExistingFolder(path, inspection, async () => {
      await flushSettingsNow();
      await chooseFolderMut.mutateAsync(path);
    });
  };

  /** True once a folder was picked and connected; false when the picker was
   * dismissed (or, on Rotli Web, handed to the browser's own dialog). */
  const connectVault = async (title = "Connect a vault, or make a new folder for one"): Promise<boolean> => {
    if (isWebVault()) {
      // Rotli Web: say what is about to happen, then the browser's own picker
      useWebVaultConnect.getState().show();
      return false;
    }
    const path = await pickVaultFolder(title);
    if (!path) return false;
    return connectPath(path);
  };

  return { connectVault, connectPath };
}
