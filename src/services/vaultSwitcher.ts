// The vault switcher (decision 2026-07-25): the sidebar header names the
// current vault and opens one row-based menu. Each row owns its switch target
// and active state; refresh and overflow controls stay presentation concerns.

import { CORPUS_INSTANCE_ID, type MemexInstance } from "../memex/config";

export interface VaultSwitcherItem {
  instance: MemexInstance;
  active: boolean;
}

/** The sidebar-header vault name: the corpus instance's label, else the open
 * plain folder's, else a fallback ("rotli" in the browser demo, where no
 * config exists). */
export function vaultDisplayName(instances: MemexInstance[], currentFolder?: MemexInstance | null): string {
  return (instances.find((i) => i.id === CORPUS_INSTANCE_ID) ?? currentFolder)?.label || "rotli";
}

/** What Connect vault does with the folder the user picked: an empty folder
 * becomes a new vault, a vault is linked as a switch target, and any other
 * folder (Markdown, Obsidian, ZenNotes) opens in place as it is — the same as
 * onboarding's "Open an existing folder". Nothing is refused. */
export function connectPlan(kind: "memex" | "markdown" | "empty"): "create" | "link" | "open" {
  if (kind === "empty") return "create";
  return kind === "memex" ? "link" : "open";
}

/** What Remove from Rotli does for one row. It only disconnects: Rotli never
 * deletes a vault's folder or files (the owner, 2026-10-10: "we never delete
 * people's stuff ever"). Rust unbinds only a vault that is not live, so the
 * current vault is switched away from first: to the next connected vault, or,
 * when it is the only one, to a vault the person picks or makes right then
 * ("it will just prompt me to add new one before I can move forward"). Until
 * they pick one, nothing is removed. */
export type VaultRemovePlan =
  | { kind: "forget" }
  | { kind: "switch"; to: MemexInstance }
  | { kind: "replace" };

export function vaultRemovePlan(items: VaultSwitcherItem[], target: VaultSwitcherItem): VaultRemovePlan {
  if (!target.active) return { kind: "forget" };
  const next = items.find((item) => !item.active)?.instance;
  return next ? { kind: "switch", to: next } : { kind: "replace" };
}

/** The vault a Connect just added: in the list now, not before it. */
export function addedVault(before: MemexInstance[], after: MemexInstance[]): MemexInstance | null {
  const known = new Set(before.map((i) => i.id));
  return after.find((i) => i.id !== CORPUS_INSTANCE_ID && !known.has(i.id)) ?? null;
}

/** The id the outgoing vault was given when the shell switched away from it:
 * the switch re-registers it under a fresh route, found again by its folder. */
export function outgoingVaultId(instances: MemexInstance[], root: string): string | null {
  return instances.find((i) => i.id !== CORPUS_INSTANCE_ID && i.root === root)?.id ?? null;
}

/** Current vault first, then every connected switch target in config order.
 * An open plain folder is still the current row — the switcher never shows
 * an empty list while notes are on screen. */
export function vaultSwitcherItems(
  instances: MemexInstance[],
  currentFolder?: MemexInstance | null,
): VaultSwitcherItem[] {
  const corpus = instances.find((i) => i.id === CORPUS_INSTANCE_ID) ?? currentFolder ?? null;
  const others = instances.filter((i) => i.id !== CORPUS_INSTANCE_ID);
  return [
    ...(corpus ? [{ instance: corpus, active: true }] : []),
    ...others.map((instance) => ({ instance, active: false })),
  ];
}
