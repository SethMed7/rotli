// Right-click the sidebar's own surface (not a row): where it sits and whether
// it stays (the owner, 2026-09-17: "via right clicking the left menu and have a
// way to say move to right"). The same two knobs as Appearance → Sidebar.

import type { MenuSpec } from "../../state/contextMenu";
import { useUiStore } from "../../state/ui";

export function sidebarPlacementMenu(): MenuSpec[] {
  const ui = useUiStore.getState();
  const other = ui.sidebarSide === "left" ? "right" : "left";
  return [
    { kind: "action", label: `Move sidebar to ${other}`, onClick: () => ui.setSidebarSide(other) },
    { kind: "sep" },
    {
      kind: "action",
      label: "Keep sidebar open",
      checked: ui.sidebarReveal === "pinned",
      checkedMark: "highlight",
      onClick: () => ui.setSidebarReveal("pinned"),
    },
    {
      kind: "action",
      label: "Open sidebar on hover",
      checked: ui.sidebarReveal === "hover",
      checkedMark: "highlight",
      onClick: () => ui.setSidebarReveal("hover"),
    },
  ];
}

/** True for a right-click on the sidebar itself — not on a row, control, or
 * field that owns its own menu or its own right-click. */
export function isSidebarSurface(target: EventTarget | null): boolean {
  return !(
    target instanceof Element &&
    target.closest(
      "button, a, input, textarea, [role='menuitem'], [role='treeitem'], [data-note-id], .sb-chatrow, .main-row",
    )
  );
}
