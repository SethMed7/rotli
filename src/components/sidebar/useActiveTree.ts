// The tree the sidebar is CURRENTLY editing: Main, or the active named view's
// subset. Two callers need it — the Home front renders it, and the shell's
// collapse-all needs its folder ids (Main folders default OPEN, so a wiped map
// would re-EXPAND them, #83). One resolution rule, stated once.

import type { MainNode } from "../../services/mainTree";
import { viewTree } from "../../services/viewTree";
import { useMainStore } from "../../state/main";
import { useUiStore } from "../../state/ui";
import { useViewsStore } from "../../state/views";

export function useActiveTree(): MainNode[] {
  const mainTree = useMainStore((s) => s.manifest.tree);
  const viewsManifest = useViewsStore((s) => s.manifest);
  const activeView = useUiStore((s) => s.activeView);
  return activeView ? viewTree(viewsManifest, activeView) : mainTree;
}
