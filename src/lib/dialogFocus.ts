import { type KeyboardEvent, type RefObject, useEffect } from "react";

/** Keep Tab within a modal's enabled, visible controls, including while busy. */
export function containDialogFocus(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== "Tab") return;
  const card = event.currentTarget;
  const controls = [
    ...card.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]:not([data-focus-end]), iframe, audio[controls], video[controls]',
    ),
  ].filter((node) => node.getClientRects().length > 0 && node.tabIndex >= 0);
  const first = controls[0];
  const last = controls.at(-1);
  if (!first || !last) {
    event.preventDefault();
    card.focus();
  } else if (event.shiftKey && (document.activeElement === first || document.activeElement === card)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === card)) {
    // keys inside an iframe never reach this handler, and a player's own
    // controls report the player as active: leave Tab to the browser, which
    // lands on the dialog's data-focus-end sentinel, and that returns to the top
    if (last.matches("iframe, audio, video") && document.activeElement === last) return;
    event.preventDefault();
    first.focus();
  }
}

/** Move focus to `target` when a dialog opens, and back to whatever had it when
 * the dialog goes away (DESIGN.md's focus law). */
export function useDialogFocus(target: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    target.current?.focus();
    return () => opener?.focus();
  }, [target]);
}
