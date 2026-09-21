// The Home front's half of the two-step hotkeys (keys/leader.ts). Home owns the
// view menu and the painted Main rows, so it answers the first step: ⌘⇧W opens
// the view menu with ⌘1–9 on its choices; ⌘⇧S numbers the top root notes.
// Split out of sidebarHome.tsx (its size ceiling), and the one place the
// request/answer rules live.

import { type MouseEvent, type RefObject, useEffect, useRef } from "react";

import { cancelLeader, enterLeader, useLeaderStore } from "../../keys/leader";
import { viewAtSlot } from "../../services/viewTree";
import { type MenuSpec, useContextMenu } from "../../state/contextMenu";
import { useUiStore } from "../../state/ui";
import { useViewsStore } from "../../state/views";

/** ⌘⇧S is pending: a root note's number. Decoration — the row keeps its name. */
export function MainSlotHint({ slot }: { slot: number | undefined }) {
  const pending = useLeaderStore((state) => state.mode === "sidebar");
  if (slot === undefined || !pending) return null;
  return (
    <span className="main-slot-n" aria-hidden="true">
      ⌘{slot}
    </span>
  );
}

function openMenuBelow(trigger: HTMLElement, items: MenuSpec[]): void {
  const rect = trigger.getBoundingClientRect();
  useContextMenu.getState().open(rect.left, rect.bottom + 4, items, {
    returnFocus: () => trigger.focus(),
  });
}

export function useHomeLeader(
  /** The view picker's items; `numbered` puts ⌘1–9 on its choices. */
  viewMenuItems: (numbered: boolean) => MenuSpec[],
  showView: (name: string | null) => void,
  /** Which requests this front answers — Chat answers only the view menu. */
  answers: readonly ("views" | "sidebar")[] = ["views", "sidebar"],
): {
  viewsButtonRef: RefObject<HTMLButtonElement | null>;
  openViewMenu: (event: MouseEvent<HTMLButtonElement>) => void;
} {
  const leaderRequest = useUiStore((state) => state.leaderRequest);
  const viewsButtonRef = useRef<HTMLButtonElement | null>(null);
  // A request is answered once, and only while fresh — Home may mount FOR it a
  // beat later (the hotkey switched fronts), but never minutes later.
  useEffect(() => {
    // read the LIVE request, not this render's: answered means cleared, so a
    // repeated effect run (StrictMode mounts twice) finds nothing to answer
    const request = useUiStore.getState().leaderRequest;
    if (!request || !answers.includes(request.id)) return;
    useUiStore.getState().clearLeaderRequest();
    if (Date.now() - request.at > 1000) return;
    if (request.id === "sidebar") {
      enterLeader({
        id: "sidebar",
        // the rendered rows ARE the order the numbers were painted in — click
        // the row itself, so a slot opens exactly what a pointer would
        pick: (slot) => document.querySelector<HTMLElement>(`.main-tree [data-main-slot="${slot}"]`)?.click(),
      });
      return;
    }
    const trigger = viewsButtonRef.current;
    if (!trigger) return;
    openMenuBelow(trigger, viewMenuItems(true));
    enterLeader({
      id: "views",
      // slot 1–9 of that menu, read when the key lands; an empty slot does nothing
      pick: (slot) => {
        const view = viewAtSlot(useViewsStore.getState().manifest, slot);
        if (view !== undefined) showView(view);
      },
      onEnd: () => useContextMenu.getState().close(),
    });
    // (re-running on every render is free: an answered request reads as none)
  }, [leaderRequest, viewMenuItems, showView, answers]);

  // The menu can also close on its own (a click, Esc inside it): the pending
  // leader goes with it, so ⌘1 is a tab jump again at once. Open → closed only:
  // on the commit that mounts Home FOR the hotkey, this effect still holds the
  // render's "closed" and would cancel what the effect above just started.
  const menuOpen = useContextMenu((state) => state.menu !== null);
  const menuWasOpen = useRef(false);
  useEffect(() => {
    if (menuWasOpen.current && !menuOpen && useLeaderStore.getState().mode === "views") cancelLeader();
    menuWasOpen.current = menuOpen;
  }, [menuOpen]);

  return {
    viewsButtonRef,
    openViewMenu: (event) => {
      event.preventDefault();
      event.stopPropagation();
      openMenuBelow(event.currentTarget, viewMenuItems(false));
    },
  };
}
