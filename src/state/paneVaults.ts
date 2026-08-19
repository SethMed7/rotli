import { rootIdOf } from "../lib/tauri";
import { CORPUS_INSTANCE_ID } from "../memex/config";

/** Convert the corpus wire grammar into the stable vault identity used by pane
 * tabs. Bare ids belong to the running corpus; prefixed ids keep their linked
 * root id. */
export function contentVaultId(id: string): string {
  const rootId = rootIdOf(id);
  return rootId === "default" ? CORPUS_INSTANCE_ID : rootId;
}

/** Panes always stay scoped to the running corpus. Connected vault ids are
 * switcher targets only, never simultaneous content routes. */
export function canOpenVaultInPanes(vaultId: string): boolean {
  return vaultId === CORPUS_INSTANCE_ID;
}
