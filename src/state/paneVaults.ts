import { rootIdOf } from "../lib/tauri";
import { CORPUS_INSTANCE_ID } from "../memex/config";

/** Convert the corpus wire grammar into the stable vault identity used by pane
 * tabs. Bare ids belong to the running corpus; prefixed ids keep their linked
 * root id. */
export function contentVaultId(id: string): string {
  const rootId = rootIdOf(id);
  return rootId === "default" ? CORPUS_INSTANCE_ID : rootId;
}

/** The root a file opened from Finder is mounted under (`finder_<hash>`;
 * src-tauri/src/corpus_raw.rs, parity fixture `rawRootPrefix`). */
export const RAW_ROOT_PREFIX = "finder_";

/** An item id from a file opened from Finder (its own single-file root). */
export function isOpenedFileId(id: string): boolean {
  return contentVaultId(id).startsWith(RAW_ROOT_PREFIX);
}

/** Panes always stay scoped to the running corpus. Connected vault ids are
 * switcher targets only, never simultaneous content routes. The one exception
 * is a file opened from Finder: a single-file mount that exists only for its
 * tab, never a vault (docs/design/open-in-rotli.md). */
export function canOpenVaultInPanes(vaultId: string): boolean {
  return vaultId === CORPUS_INSTANCE_ID || vaultId.startsWith(RAW_ROOT_PREFIX);
}
