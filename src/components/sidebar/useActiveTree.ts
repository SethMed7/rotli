// The tree the sidebar is CURRENTLY showing: Main, the active named view's
// subset, or the Vault view (the vault's folders as on disk, read-only). Two
// callers need it — the Home front renders it, and the shell's collapse-all
// needs its folder ids (Main folders default OPEN, so a wiped map would
// re-EXPAND them, #83). One resolution rule, stated once.

import { useMemo } from "react";

import { useFolders, useNoteIndex } from "../../services/hooks";
import type { MainNode } from "../../services/mainTree";
import { vaultTree } from "../../services/vaultTree";
import { viewTree } from "../../services/viewTree";
import { useMainStore } from "../../state/main";
import { useUiStore } from "../../state/ui";
import { useVaultView } from "../../state/vaultView";
import { useViewsStore } from "../../state/views";

export function useActiveTree(): MainNode[] {
  const mainTree = useMainStore((s) => s.manifest.tree);
  const viewsManifest = useViewsStore((s) => s.manifest);
  const activeView = useUiStore((s) => s.activeView);
  const vaultOn = useVaultView((s) => s.on);
  const noteIndex = useNoteIndex();
  const folders = useFolders().data;
  const vault = useMemo(
    () => (vaultOn ? vaultTree(noteIndex.values(), folders ?? []) : null),
    [vaultOn, noteIndex, folders],
  );
  if (vault) return vault;
  return activeView ? viewTree(viewsManifest, activeView) : mainTree;
}
