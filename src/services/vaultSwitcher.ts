// The vault switcher (decision 2026-07-25, Zen reference): the sidebar header
// names the current vault and opens ONE menu to move between vaults. Pure menu
// construction — the sidebar supplies handlers, the shared context-menu host
// renders. Grammar rules:
//   · every known vault lists by name; the CURRENT one uses the highlight mark
//     (never a checkmark gutter — the 2026-07-24 exclusive-choice rule);
//   · switching repoints the notes folder, which RELAUNCHES rotli — the menu
//     says so honestly instead of pretending it's instant;
//   · connect/settings ride below a separator, system actions after content.

import type { MenuSpec } from "../state/contextMenu";
import { CORPUS_INSTANCE_ID, type MemexInstance } from "../memex/config";

export interface VaultMenuHandlers {
  /** Repoint the notes folder to this root (relaunches on success). */
  switchTo: (root: string) => void;
  /** Folder picker → connect another vault (relaunches on success). */
  connect: () => void;
  /** Open Settings (Location holds the full vault management). */
  openSettings: () => void;
}

/** The sidebar-header vault name: the corpus instance's label, else a fallback
 * ("rotli" in the browser demo, where no config exists). */
export function vaultDisplayName(instances: MemexInstance[]): string {
  return instances.find((i) => i.id === CORPUS_INSTANCE_ID)?.label || "rotli";
}

export function buildVaultMenu(instances: MemexInstance[], handlers: VaultMenuHandlers): MenuSpec[] {
  const corpus = instances.find((i) => i.id === CORPUS_INSTANCE_ID) ?? null;
  const others = instances.filter((i) => i.id !== CORPUS_INSTANCE_ID);
  const items: MenuSpec[] = [];
  if (corpus) {
    items.push({
      kind: "action",
      label: corpus.label,
      checked: true,
      checkedMark: "highlight",
      // clicking the current vault is a calm no-op — never a surprise relaunch
      onClick: () => {},
    });
  }
  for (const inst of others) {
    items.push({
      kind: "action",
      label: inst.label,
      checked: false,
      checkedMark: "highlight",
      onClick: () => handlers.switchTo(inst.root),
    });
  }
  if (items.length > 0) items.push({ kind: "sep" });
  items.push({ kind: "action", label: "Connect another vault…", onClick: handlers.connect });
  items.push({ kind: "action", label: "Location settings…", onClick: handlers.openSettings });
  if (others.length > 0) {
    // the honesty line: switching is a relaunch, not a live swap
    items.push({ kind: "sep" });
    items.push({
      kind: "action",
      label: "Switching vaults relaunches rotli",
      disabled: true,
      onClick: () => {},
    });
  }
  return items;
}
