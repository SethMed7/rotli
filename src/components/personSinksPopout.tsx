// The one-time "move your Archive and Trash?" question in a copy with the
// Librarian on (services/personSinks.ts), as a callout that pops out of the
// sidebar beside its Archive and Trash rows (the owner, 2026-10-15: "a popout
// from the left menu out of the trash and archive", dismissible, gone after
// ten seconds). It waits for the copy dialog and the thank-you card to close.
// Closing it without an answer hides it for this session only: the question
// comes back on the next launch until it is answered Yes or No.

import { useQuery } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { activeInstance } from "../memex/config";
import { useMemexConfig } from "../memex/useMemex";
import { answerPersonSinks, personSinksQuestion, personSinksToAsk } from "../services/personSinks";
import { useOnboardingThanks } from "../state/onboardingThanks";
import { useUiStore } from "../state/ui";
import { useVaultImport } from "../state/vaultImport";

/** How long the callout stays when left alone (paused while pointed at or focused). */
export const POPOUT_MS = 10_000;

// the Archive row first, then Trash, then the System zone itself
const ANCHORS = ['[data-system-row="archive"]', '[data-system-row="trash"]', ".sb-system"];
const GAP = 12;

type Rect = { left: number; top: number; width: number; height: number };

/** Beside the sidebar, level with the row it points at, inside the window.
 * `arrowTop` is where the pointer sits on the card's left edge. */
export function besideSidebar(
  row: Rect,
  sidebarRight: number,
  viewport: { width: number; height: number },
  card: { width: number; height: number },
): { left: number; top: number; arrowTop: number } {
  const center = row.top + row.height / 2;
  const top = Math.min(
    Math.max(GAP, center - card.height / 2),
    Math.max(GAP, viewport.height - card.height - GAP),
  );
  const left = Math.min(sidebarRight + GAP, Math.max(GAP, viewport.width - card.width - GAP));
  const arrowTop = Math.min(Math.max(16, center - top), Math.max(16, card.height - 16));
  return { left, top, arrowTop };
}

export function PersonSinksPopout() {
  const config = useMemexConfig().data;
  const active = config ? activeInstance(config) : null;
  const answer = useUiStore((state) => state.personSinksAnswer);
  const importIdle = useVaultImport((state) => state.step.kind === "idle");
  const thanksOpen = useOnboardingThanks((state) => state.open);
  const [dismissed, setDismissed] = useState(false);
  const sinks = useQuery({
    queryKey: ["person-sinks", active?.root ?? null, active?.memexId ?? null, answer],
    queryFn: () => personSinksToAsk(active, answer),
    enabled: importIdle,
  });
  const vaultId = active?.memexId;
  if (!importIdle || thanksOpen || dismissed || !sinks.data || !vaultId) return null;
  return (
    <PersonSinksCard
      {...personSinksQuestion(sinks.data)}
      onAnswer={(move) => answerPersonSinks(vaultId, move)}
      onDismiss={() => setDismissed(true)}
    />
  );
}

export function PersonSinksCard({
  title,
  line,
  onAnswer,
  onDismiss,
}: {
  title: string;
  line: string;
  onAnswer: (move: boolean) => Promise<void>;
  onDismiss: () => void;
}) {
  const card = useRef<HTMLElement>(null);
  const [at, setAt] = useState<{ left: number; top: number; arrowTop: number } | null>(null);
  const [held, setHeld] = useState(false); // pointed at or focused: the clock waits
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useLayoutEffect(() => {
    const place = () => {
      const row = ANCHORS.map((selector) => document.querySelector<HTMLElement>(selector)).find(Boolean);
      const sidebar = document.querySelector<HTMLElement>(".sidebar");
      const node = card.current;
      if (!node) return;
      if (!row)
        return setAt({ left: GAP, top: window.innerHeight - node.offsetHeight - GAP, arrowTop: -100 });
      setAt(
        besideSidebar(
          row.getBoundingClientRect(),
          sidebar?.getBoundingClientRect().right ?? row.getBoundingClientRect().right,
          { width: window.innerWidth, height: window.innerHeight },
          { width: node.offsetWidth, height: node.offsetHeight },
        ),
      );
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, []);

  // gone after ten seconds left alone; Esc and a click elsewhere close it now
  useEffect(() => {
    if (held || busy) return;
    const timer = window.setTimeout(onDismiss, POPOUT_MS);
    return () => window.clearTimeout(timer);
  }, [held, busy, onDismiss]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    const onPointer = (event: PointerEvent) => {
      if (card.current && !card.current.contains(event.target as Node)) onDismiss();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer, true);
    };
  }, [onDismiss]);

  const answerWith = (move: boolean) => {
    setErr(null);
    setBusy(true);
    onAnswer(move)
      .catch((cause: unknown) => setErr(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setBusy(false));
  };
  return (
    <aside
      ref={card}
      className="tour-card person-sinks-popout"
      role="dialog"
      aria-label={title}
      style={
        at
          ? ({ left: at.left, top: at.top, "--arrow-top": `${at.arrowTop}px` } as React.CSSProperties)
          : { visibility: "hidden" }
      }
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <button type="button" className="person-sinks-close" aria-label="Not now" onClick={onDismiss}>
        ×
      </button>
      <h2>{title}</h2>
      <p>{line}</p>
      <p className="person-sinks-note">Your original vault is never touched.</p>
      {err && (
        <p className="person-sinks-note" role="alert">
          ⚠ Couldn’t move them. {err}
        </p>
      )}
      <div className="settings-hint-actions">
        <button type="button" className="ghostbtn" disabled={busy} onClick={() => answerWith(false)}>
          No, leave them
        </button>
        <button type="button" className="settings-hint-open" disabled={busy} onClick={() => answerWith(true)}>
          Yes, move them
        </button>
      </div>
    </aside>
  );
}
