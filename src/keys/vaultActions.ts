import { isTauri } from "../lib/tauri";
import { reconnectActiveVault } from "../state/activeVault";
import { useUiStore } from "../state/ui";
import { registerAction } from "./registry";

export function registerVaultActions(): void {
  registerAction({
    id: "vault.refresh",
    platforms: ["desktop"],
    title: "Refresh current vault",
    defaultChord: "Meta+R",
    enabled: () => isTauri(),
    run: () => {
      void reconnectActiveVault().catch((error: unknown) =>
        useUiStore
          .getState()
          .setRowActionError(
            `Couldn’t refresh the vault — ${error instanceof Error ? error.message : String(error)}`,
          ),
      );
    },
  });
}
