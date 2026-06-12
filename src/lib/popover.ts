// Transient popover plumbing: outside-click closes, and the popover registers
// with the ui store's transient stack so Esc (the registry's app.hide) closes
// it before the window — no ad-hoc keydown listeners.

import { type RefObject, useEffect, useRef } from "react";
import { useUiStore } from "../state/ui";

/** `refs` = the popover plus its anchor (so toggling the anchor doesn't
 * close-then-reopen on the same click). */
export function useTransientPopover(
  refs: RefObject<HTMLElement | null>[],
  open: boolean,
  onClose: () => void,
): void {
  const registerTransient = useUiStore((s) => s.registerTransient);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const refsRef = useRef(refs);
  refsRef.current = refs;

  useEffect(() => {
    if (!open) return;
    const close = () => closeRef.current();
    const unregister = registerTransient(close);
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const inside = refsRef.current.some((r) => r.current?.contains(target));
      if (!inside) close();
    };
    window.addEventListener("mousedown", onDown);
    return () => {
      unregister();
      window.removeEventListener("mousedown", onDown);
    };
  }, [open, registerTransient]);
}
