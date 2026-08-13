import type { MouseEvent as ReactMouseEvent } from "react";

import { dispatch } from "../keys/registry";
import { type MenuSpec, useContextMenu } from "../state/contextMenu";
import { NEW_ITEM_DEFINITIONS } from "./model";

export function newItemMenuItems(): MenuSpec[] {
  return NEW_ITEM_DEFINITIONS.map((item) => ({
    kind: "action" as const,
    label: item.label,
    onClick: () =>
      dispatch(
        item.kind === "board" ? "boards.new" : `items.new${item.kind[0]!.toUpperCase()}${item.kind.slice(1)}`,
      ),
  }));
}

export function openNewItemMenu(
  event: Pick<ReactMouseEvent<HTMLElement>, "currentTarget" | "stopPropagation">,
): void {
  event.stopPropagation();
  const trigger = event.currentTarget;
  const rect = trigger.getBoundingClientRect();
  useContextMenu.getState().open(rect.left, rect.bottom + 4, newItemMenuItems(), {
    returnFocus: () => trigger.focus(),
  });
}
