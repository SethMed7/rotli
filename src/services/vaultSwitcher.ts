// The vault switcher (decision 2026-07-25): the sidebar header names the
// current vault and opens one row-based menu. Each row owns its switch target
// and active state; refresh and overflow controls stay presentation concerns.

import { CORPUS_INSTANCE_ID, type MemexInstance } from "../memex/config";

export interface VaultSwitcherItem {
  instance: MemexInstance;
  active: boolean;
}

/** A vault row's label: raw vaults carry a quiet suffix; Librarian-on is the
 * default and stays unmarked (calm — only the exception is labeled). */
export function vaultRowLabel(inst: Pick<MemexInstance, "label" | "brainEnabled">): string {
  return inst.brainEnabled ? inst.label : `${inst.label} · raw`;
}

/** The sidebar-header vault name: the corpus instance's label, else a fallback
 * ("rotli" in the browser demo, where no config exists). */
export function vaultDisplayName(instances: MemexInstance[]): string {
  return instances.find((i) => i.id === CORPUS_INSTANCE_ID)?.label || "rotli";
}

/** Current vault first, then every connected switch target in config order. */
export function vaultSwitcherItems(instances: MemexInstance[]): VaultSwitcherItem[] {
  const corpus = instances.find((i) => i.id === CORPUS_INSTANCE_ID) ?? null;
  const others = instances.filter((i) => i.id !== CORPUS_INSTANCE_ID);
  return [
    ...(corpus ? [{ instance: corpus, active: true }] : []),
    ...others.map((instance) => ({ instance, active: false })),
  ];
}
