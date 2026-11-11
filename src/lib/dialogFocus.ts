import type { KeyboardEvent } from "react";

/** Keep Tab within a modal's enabled, visible controls, including while busy. */
export function containDialogFocus(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== "Tab") return;
  const card = event.currentTarget;
  const controls = [
    ...card.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"], iframe, audio[controls], video[controls]',
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
    // a player's own controls report the <audio>/<video> as active: wrapping
    // here would make them unreachable by keyboard
    if (last.matches("audio, video") && document.activeElement === last) return;
    event.preventDefault();
    first.focus();
  }
}
