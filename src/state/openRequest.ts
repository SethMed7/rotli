import { type WorkspaceOpenRequest, splitRootId } from "../lib/tauri";

/** What routing an open request needs from the app, injected so the policy
 * stays testable without the shell. */
export interface OpenRequestDeps {
  /** Make a connected vault the active one (`corpus_switch_vault`); true when
   * the live vault changed. */
  switchVault: (vaultId: string) => Promise<boolean>;
  /** Rebind the webview's vault-scoped state after a switch. */
  refreshActiveVault: () => Promise<void>;
  open: (item: WorkspaceOpenRequest) => void;
  fail: (message: string) => void;
}

/** Open what `rotli open`, the MCP open tool, or a rotli:// link queued. Panes
 * show only the active vault, so an item in a connected vault switches to that
 * vault first and then opens by its id there. Rust queues only connected
 * VAULTS (a connected folder is refused before it reaches the mailbox); a
 * switch that fails or changes nothing opens nothing. */
export async function routeOpenRequest(request: WorkspaceOpenRequest, deps: OpenRequestDeps): Promise<void> {
  const { rootId, rel } = splitRootId(request.id);
  if (rootId === "default") {
    deps.open(request);
    return;
  }
  let switched = false;
  try {
    switched = await deps.switchVault(rootId);
  } catch (cause) {
    deps.fail(`Couldn't switch to the vault that item is in: ${String(cause)}`);
    return;
  }
  if (!switched) {
    deps.fail("Couldn't switch to the vault that item is in.");
    return;
  }
  await deps.refreshActiveVault();
  deps.open({ ...request, id: rel });
}
