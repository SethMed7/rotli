// The vault switcher (decision 2026-07-25): the sidebar header names the
// current vault and opens one row-based menu. Each row owns its switch target
// and active state; refresh and overflow controls stay presentation concerns.

import { CORPUS_INSTANCE_ID, type MemexInstance } from "../memex/config";
import type { MenuSpec } from "../state/contextMenu";

export interface VaultSwitcherItem {
  instance: MemexInstance;
  active: boolean;
}

/** A vault row's label: raw vaults carry a quiet suffix; Librarian-on is the
 * default and stays unmarked (calm — only the exception is labeled). */
export function vaultRowLabel(inst: Pick<MemexInstance, "label" | "brainEnabled">): string {
  return inst.brainEnabled ? inst.label : `${inst.label} · raw`;
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

/** A vault row's overflow menu. Removal is a drill-in so the destructive step
 * needs a second click, states that the folder stays on disk, and is refused
 * for the active vault (the shell's forget_root rule: switch first). */
export function vaultOverflowItems(
  inst: Pick<MemexInstance, "label">,
  active: boolean,
  on: { openLocationSettings: () => void; remove: () => void },
): MenuSpec[] {
  return [
    { kind: "action", label: "Location settings…", onClick: on.openLocationSettings },
    { kind: "sep" },
    active
      ? {
          kind: "action",
          label: "Remove from Rotli… (switch vaults first)",
          disabled: true,
          onClick: () => {},
        }
      : {
          kind: "drill",
          label: "Remove from Rotli…",
          danger: true,
          items: [
            { kind: "action", label: `Remove ${inst.label}`, danger: true, onClick: on.remove },
            {
              kind: "action",
              label: "The folder and its files stay where they are",
              disabled: true,
              onClick: () => {},
            },
          ],
        },
  ];
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
