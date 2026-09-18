// The sidebar out of the way (the owner, 2026-09-17: "opens on hover and shuts
// when away, allowing for better focus"): a hot strip on the window's edge
// reveals the sidebar; it goes once the pointer leaves it, or on Esc. ⌘0 still
// brings it — in this mode `sidebarCollapsed` is simply "the rail is closed".
//
// Revealed, it is the SAME in-flow rail ⌘0 shows (the owner, 2026-09-18: "it
// should just push — do the same thing as the hotkey, just on hover. I should
// still be able to drag"): the content moves over, nothing is covered, and the
// resize grip is there. The earlier floating overlay is gone. A held button
// (the grip mid-resize, a row mid-drag) holds the rail open: the layout must
// not shift under a gesture.
//
// Two races the review caught (2026-09-17): a graze — the pointer leaves the
// strip before the rail has mounted, so no leave ever reaches the rail
// — and the sidebar's own context menu, whose portal takes focus and the
// pointer. So a hide is ARMED by leaving the strip or the rail, but only
// LANDS when the pointer is truly away from both and no context menu is open;
// a menu closing re-arms it. And a close by Esc or ⌘0 under a resting pointer
// leaves the strip beneath that pointer — the browser's synthetic enter would
// reopen it at once — so the strip is disarmed until the pointer leaves it,
// synchronously in the store's own notification, before anything unmounts.
// Esc goes through the transient stack like every popover: a menu above the
// rail takes it first, and the window's own Esc never sees it.

import { type ReactNode, useEffect, useRef } from "react";

import { useContextMenu } from "../../state/contextMenu";
import { type SidebarSide, useUiStore } from "../../state/ui";
import { Sidebar } from "../sidebar";

const LEAVE_GRACE_MS = 260;

function inside(el: Element | null, x: number, y: number): boolean {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

export function SidebarHoverRail({ side, grip }: { side: SidebarSide; grip: ReactNode }) {
  const open = useUiStore((s) => !s.sidebarCollapsed);
  const setCollapsed = useUiStore((s) => s.setSidebarCollapsed);
  const registerTransient = useUiStore((s) => s.registerTransient);
  const stripRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const pointer = useRef({ x: -1, y: -1, held: false });
  const armed = useRef(true);
  const timer = useRef<number | null>(null);
  const cancel = () => {
    if (timer.current === null) return;
    window.clearTimeout(timer.current);
    timer.current = null;
  };
  const show = () => {
    if (!armed.current) return;
    cancel();
    setCollapsed(false);
  };
  const hideSoon = () => {
    cancel();
    timer.current = window.setTimeout(() => {
      timer.current = null;
      const { x, y, held } = pointer.current;
      // a gesture in flight (resizing, dragging a row out): ask again after it
      if (held) return hideSoon();
      // still over the rail or its strip, or its menu is up: stay
      if (inside(railRef.current, x, y) || inside(stripRef.current, x, y)) return;
      if (useContextMenu.getState().menu) return;
      setCollapsed(true);
    }, LEAVE_GRACE_MS);
  };
  const leaveStrip = () => {
    armed.current = true;
    hideSoon();
  };
  // the latest hide for the menu subscription below (no memo: the compiler
  // owns memoisation here)
  const hideSoonRef = useRef(hideSoon);
  useEffect(() => {
    hideSoonRef.current = hideSoon;
  });
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    // any close (Esc, ⌘0, the leave timer) while the pointer rests on the
    // strip: hold the strip until the pointer leaves it — decided in the
    // store's synchronous notification, before React unmounts anything
    return useUiStore.subscribe((state, previous) => {
      if (state.sidebarCollapsed && !previous.sidebarCollapsed) {
        armed.current = !inside(stripRef.current, pointer.current.x, pointer.current.y);
      }
    });
  }, []);
  useEffect(() => {
    const track = (event: PointerEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY, held: event.buttons !== 0 };
    };
    const events = ["pointermove", "pointerdown", "pointerup", "pointercancel"] as const;
    for (const name of events) window.addEventListener(name, track);
    return () => {
      for (const name of events) window.removeEventListener(name, track);
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    // Esc: one layer at a time — the rail is a transient like any popover
    const unregister = registerTransient(() => setCollapsed(true));
    // the rail's own menu closing (a pick, a dismissal) re-arms the hide
    const unsubscribe = useContextMenu.subscribe((state, previous) => {
      if (previous.menu && !state.menu) hideSoonRef.current();
    });
    return () => {
      unregister();
      unsubscribe();
    };
  }, [open, setCollapsed, registerTransient]);
  return (
    <>
      <div
        ref={stripRef}
        className="warm-edge"
        data-side={side}
        aria-hidden="true"
        onPointerEnter={show}
        onPointerLeave={leaveStrip}
      >
        <span className="edgehint" />
      </div>
      {open && (
        <div
          ref={railRef}
          className="rail-wrap rail-hover"
          data-side={side}
          onPointerEnter={cancel}
          onPointerLeave={hideSoon}
          onFocusCapture={cancel}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) hideSoon();
          }}
        >
          <Sidebar />
          {grip}
        </div>
      )}
    </>
  );
}
