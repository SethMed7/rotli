// "Hold ⌘ to peek" — a hook that fires when a LONE modifier is held idle past a
// delay, and releases the moment anything else happens. It is the trigger for
// the WhichKey overlay (a non-modal shortcut map) and lives DELIBERATELY apart
// from the registry dispatcher (the maintainer, 2026-06-13): it is a sibling window
// listener that NEVER preventDefaults, so a real ⌘-chord still fires its action
// AND dismisses the overlay (the chord's first non-modifier keydown cancels us).
//
// The chord engine's law (src/keys/registry.ts / chords.ts) is that a lone held
// modifier yields no chord (chordFromEvent → null) and never enters the action
// loop. This hook reads the same gap from the other side: it watches for the
// modifier alone, with no other key down, settling past delayMs.

import { useEffect, useRef } from "react";

/** event.code values that count as "the target modifier is down". */
const MODIFIER_CODES: Record<HeldModifier, [string, string]> = {
  Meta: ["MetaLeft", "MetaRight"],
  Alt: ["AltLeft", "AltRight"],
  Control: ["ControlLeft", "ControlRight"],
  Shift: ["ShiftLeft", "ShiftRight"],
};

export type HeldModifier = "Meta" | "Alt" | "Control" | "Shift";

/** Normal workspace hints are immediate; attention-owning modal UI keeps the
 * deliberate hold so Command does not flash help during an interaction. */
export function hotkeyPeekDelay(hasModal: boolean): number {
  return hasModal ? 500 : 0;
}

interface HeldModifierOptions {
  /** Which lone modifier, held idle, arms the timer. */
  modifier: HeldModifier;
  /** How long it must settle before onHold fires (ms). */
  delayMs: number;
  /** Off entirely when false — listeners detach, any pending hold releases. */
  enabled: boolean;
  /** The modifier has been held idle past delayMs (the overlay should show). */
  onHold: () => void;
  /** The held state ends — release, a different key, blur, or a click. */
  onRelease: () => void;
}

/** True when ANOTHER modifier (not the target) is currently down. */
function otherModifierDown(modifier: HeldModifier, event: KeyboardEvent): boolean {
  return (
    (modifier !== "Meta" && event.metaKey) ||
    (modifier !== "Alt" && event.altKey) ||
    (modifier !== "Control" && event.ctrlKey) ||
    (modifier !== "Shift" && event.shiftKey)
  );
}

export function useHeldModifier(opts: HeldModifierOptions): void {
  // keep the latest callbacks/values without re-attaching listeners every render
  const ref = useRef(opts);
  ref.current = opts;

  useEffect(() => {
    if (!opts.enabled) return;

    const codes = MODIFIER_CODES[opts.modifier];
    let timer: number | null = null;
    let held = false; // onHold has fired and not yet been released
    // a real key (or a second modifier) arrived while we were arming/held — the
    // hold is cancelled until the target modifier is fully released (keyup),
    // so a fired chord can't re-arm while ⌘ is still held down after it
    let cancelledUntilKeyup = false;

    const clearTimer = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    const release = () => {
      clearTimer();
      if (held) {
        held = false;
        ref.current.onRelease();
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return; // auto-repeat is not a fresh press
      const isTarget = codes.includes(event.code);

      if (isTarget) {
        // the target modifier pressed alone, nothing else down → arm. If any
        // other modifier is somehow already down, this is not a lone hold.
        if (cancelledUntilKeyup) return; // wait for keyup to re-arm
        if (otherModifierDown(ref.current.modifier, event)) return;
        if (timer === null && !held) {
          if (ref.current.delayMs <= 0) {
            held = true;
            ref.current.onHold();
          } else {
            timer = window.setTimeout(() => {
              timer = null;
              held = true;
              ref.current.onHold();
            }, ref.current.delayMs);
          }
        }
        return;
      }

      // ANY other keydown (a real key OR a different modifier) while arming or
      // held → the hold is over; if a chord just fired, dismiss the overlay.
      clearTimer();
      cancelledUntilKeyup = true;
      if (held) {
        held = false;
        ref.current.onRelease();
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (!codes.includes(event.code)) return;
      // the target modifier let go: release, and re-arm becomes possible again
      cancelledUntilKeyup = false;
      release();
    };

    // app-switch (blur) or a click anywhere must never leave the overlay stuck
    const onLeave = () => {
      cancelledUntilKeyup = false;
      release();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onLeave);
    window.addEventListener("mousedown", onLeave);

    return () => {
      // unmount or enabled→false: detach + release any pending hold
      release();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onLeave);
      window.removeEventListener("mousedown", onLeave);
    };
  }, [opts.enabled, opts.modifier]);
}
