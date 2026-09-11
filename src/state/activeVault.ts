import { corpusRefreshActiveVault, isTauri } from "../lib/tauri";
import { queryClient } from "../services/query";
import { openWelcome, resetWelcome } from "../services/welcome";
import { resetMainForVaultSwitch } from "./main";
import { useMruStore } from "./mru";
import { resetPanesForVaultSwitch } from "./panes";
import { hydratePersistedState } from "./persist";
import { resetUiForVaultSwitch } from "./ui";
import { resetViewsForVaultSwitch } from "./views";

let refreshInFlight: Promise<void> | null = null;

/** Rebind one webview to the backend's newly active default vault. The native
 * shell stays mounted; only vault-scoped caches and durable projections move. */
export function refreshActiveVault(): Promise<void> {
  if (refreshInFlight) return refreshInFlight;
  const refresh = (async () => {
    queryClient.clear();
    resetWelcome();
    resetPanesForVaultSwitch();
    resetMainForVaultSwitch();
    resetViewsForVaultSwitch();
    useMruStore.setState({ ids: [], itemTouchedAt: {}, chatTouchedAt: {} });
    await hydratePersistedState();
    resetUiForVaultSwitch();
  })();
  refreshInFlight = refresh;
  void refresh.then(
    () => {
      if (refreshInFlight === refresh) refreshInFlight = null;
    },
    () => {
      if (refreshInFlight === refresh) refreshInFlight = null;
    },
  );
  return refresh;
}

/** The one path after a vault is CREATED (onboarding's empty folder, the
 * switcher's Connect on an empty folder): rebind, then seed the Welcome folder
 * in Main and land on the welcome note. The vault itself is already durable, so
 * a seeding failure is logged and left to Settings → Open welcome folder rather
 * than failing the creation. Opening an existing vault never comes through here. */
export async function activateCreatedVault(): Promise<void> {
  await refreshActiveVault();
  try {
    await openWelcome();
  } catch (cause) {
    console.warn("welcome folder seeding failed", cause);
  }
}

/** Ask Rust to reopen/rescan the active folder, then rebuild every vault-scoped
 * frontend projection. Used by ⌘R and the explicit vault-menu action. */
export async function reconnectActiveVault(): Promise<void> {
  if (!isTauri()) return;
  await corpusRefreshActiveVault();
  await refreshActiveVault();
}
