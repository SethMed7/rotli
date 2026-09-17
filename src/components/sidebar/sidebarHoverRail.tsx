// The sidebar out of the way (the owner, 2026-09-17: "opens on hover and shuts
// when away, allowing for better focus"): a hot strip on the window's edge
// reveals the same sidebar as an overlay over the content; it slides away
// once the pointer leaves it, or on Esc. ⌘0 still brings it — in this mode
// `sidebarCollapsed` is simply "the overlay is closed".

import { useEffect, useRef } from "react";

import { type SidebarSide, useUiStore } from "../../state/ui";
import { Sidebar } from "../sidebar";

const LEAVE_GRACE_MS = 260;

export function SidebarHoverRail({ side }: { side: SidebarSide }) {
  const open = useUiStore((s) => !s.sidebarCollapsed);
  const setCollapsed = useUiStore((s) => s.setSidebarCollapsed);
  const timer = useRef<number | null>(null);
  const cancel = () => {
    if (timer.current === null) return;
    window.clearTimeout(timer.current);
    timer.current = null;
  };
  const show = () => {
    cancel();
    setCollapsed(false);
  };
  const hideSoon = () => {
    cancel();
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setCollapsed(true);
    }, LEAVE_GRACE_MS);
  };
  useEffect(() => cancel, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCollapsed(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setCollapsed]);
  return (
    <>
      <div className="warm-edge" data-side={side} aria-hidden="true" onPointerEnter={show}>
        <span className="edgehint" />
      </div>
      {open && (
        <div
          className="rail-overlay"
          data-side={side}
          onPointerEnter={cancel}
          onPointerLeave={hideSoon}
          onFocusCapture={cancel}
          onBlurCapture={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) hideSoon();
          }}
        >
          <Sidebar />
        </div>
      )}
    </>
  );
}
