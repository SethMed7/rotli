import { useState } from "react";

import { hotkeyHint } from "../lib/hotkeyHint";
import { WELCOME_LESSON_COUNT, openWelcome, welcomeUsesMemory } from "../services/welcome";
import { startTour } from "../state/tour";

/** A read-only native vault cannot take the notes; the browser twin always
 * can, because its seed lives in memory and says so. */
export function welcomeAvailability(
  disabled: boolean,
  usesMemory: boolean,
): { unavailable: boolean; note: string | null } {
  if (usesMemory)
    return { unavailable: false, note: "Browser preview: the notes live in memory and reset on reload." };
  if (disabled) return { unavailable: true, note: "Open a writable vault to add the notes." };
  return { unavailable: false, note: null };
}

/** Settings → General: one action that seeds the Welcome folder (idempotent)
 * and opens the welcome note. Everything in it is an ordinary note in Main. */
export function WelcomeSettings({ disabled = false }: { disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { unavailable, note } = welcomeAvailability(disabled, welcomeUsesMemory());

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await openWelcome();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h4 className="sethead">Welcome folder</h4>
      <p className="lead">
        Every new vault starts with a Welcome folder in Main: the welcome note and {WELCOME_LESSON_COUNT}{" "}
        short lessons, all ordinary notes. Edit them, or delete the folder when you are done. Opening it again
        restores any lesson you removed.
      </p>
      <button type="button" className="ghostbtn" disabled={busy || unavailable} onClick={() => void run()}>
        {busy ? "Opening…" : "Open welcome folder"}
      </button>
      <p className="lead">
        The guided tour points at the real controls: New, Main and its view picker, search, Aa, Chat, and
        Settings. It runs once after setup and any time from here{hotkeyHint(" or ⌘K")}.
      </p>
      <button type="button" className="ghostbtn" onClick={startTour}>
        Show me around
      </button>
      {note && <p className="setnote">{note}</p>}
      {error && (
        <p className="setnote err" role="alert" aria-live="polite">
          {error}
        </p>
      )}
    </>
  );
}
