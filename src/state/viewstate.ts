import type { PaneNode } from "../types";

export interface PersistedViewstate {
  v: 1;
  root: PaneNode;
  focusedPaneId: string;
  selectedFolderId: string;
  activeView: string | null;
  mru: string[];
  itemTouchedAt: Record<string, number>;
  chatTouchedAt: Record<string, number>;
}

/** Session surfaces never enter the vault's durable pane layout. */
export function durablePane(node: PaneNode): PaneNode {
  if (node.kind === "split") return { ...node, children: node.children.map(durablePane) };
  const tabs = node.tabs.filter((tab) => tab.surfaceKind !== "browser");
  const activeTabId = tabs.some((tab) => tab.id === node.activeTabId)
    ? node.activeTabId
    : (tabs[0]?.id ?? "");
  return { ...node, tabs, activeTabId };
}
