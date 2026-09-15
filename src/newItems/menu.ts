import type { MouseEvent as ReactMouseEvent } from "react";

import { dispatch } from "../keys/registry";
import { LAUNCH_FEATURES } from "../lib/featurePolicy";
import { type MenuSpec, useContextMenu } from "../state/contextMenu";
import { availableNewItems } from "./model";

export function newItemMenuItems(): MenuSpec[] {
  return availableNewItems(LAUNCH_FEATURES).map((item) => ({
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
