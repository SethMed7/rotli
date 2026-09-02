// Presentation helpers shared by the Breve views (breveSurface.tsx,
// breveWatchlist.tsx): page header, save-state note, draft guard, empty and
// loading states. Pulled out of the surface file so sibling views can reuse
// them without growing the god-file.

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

import { useNow } from "../../lib/useNow";
import type { BreveSnapshot } from "../../routines/briefs";
import { useUiStore } from "../../state/ui";
import { CheckGlyph, ClockGlyph } from "../glyphs";
import { breveHealthSummary } from "./breveHealthModel";

export type SaveState = "idle" | "saving" | "saved" | "error";

/** Something needs the person's attention (Breve health, 2026-09-02). Inline
 * like sidebar.tsx's FoldGlyph — same 1.7 stroke / 24-viewBox family; never
 * the text "⚠", which ignores icon sizing and the icon colour roles. */
function WarningGlyph({ size = 15 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 4 3.5 18.5a1 1 0 0 0 .87 1.5h15.26a1 1 0 0 0 .87-1.5z" />
      <path d="M12 10v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

/** The one health sentence, shared by the Today page and the Routines page.
 * A failing brief slot renders in the failure role; `children` lets a page
 * add its own action (Start Breve, Review routines). */
export function BreveHealthStrip({ snapshot, children }: { snapshot: BreveSnapshot; children?: ReactNode }) {
  const now = useNow();
  const health = breveHealthSummary(snapshot, now);
  const warn = health.level === "warn";
  return (
    <div
      className={warn ? "breve-honesty warn" : "breve-honesty"}
      role={warn ? "alert" : "status"}
      data-breve-health={health.level}
    >
      {warn ? <WarningGlyph size={15} /> : <ClockGlyph size={15} />}
      <p>
        {warn && <strong>{health.label}. </strong>}
        {health.detail}
      </p>
      {children}
    </div>
  );
}

export function PageHead({ title, detail }: { title: string; detail: string }) {
  return (
    <header className="breve-page-head">
      <hgroup>
        <h2>{title}</h2>
        <p>{detail}</p>
      </hgroup>
    </header>
  );
}

export function SaveNote({
  state,
  error,
  dirty = false,
}: {
  state: SaveState;
  error?: string;
  dirty?: boolean;
}) {
  if (state === "idle" && !dirty) return null;
  const message =
    state === "saving"
      ? "Saving…"
      : state === "saved"
        ? "Saved"
        : state === "error"
          ? error || "Could not save"
          : "Unsaved changes";
  return (
    <span
      className={state === "error" ? "breve-save-note err" : "breve-save-note"}
      role={state === "error" ? "alert" : "status"}
      aria-live={state === "error" ? "assertive" : "polite"}
    >
      {state === "saved" && <CheckGlyph size={12} />}
      {message}
    </span>
  );
}

/** Every guarded form registers itself here. Two forms can be mounted at ONCE
 * now (the merged Settings page hosts Models + Delivery), so breveDirty must
 * be the UNION of live dirty sources — a last-writer-wins boolean let a clean
 * form clear a dirty sibling's guard and lose its draft silently (adversarial
 * review 2026-07-30, HIGH). */
const dirtySources = new Set<object>();

export function useBreveDraftGuard(dirty: boolean) {
  const setBreveDirty = useUiStore((state) => state.setBreveDirty);
  const source = useRef({}).current;
  useEffect(() => {
    if (dirty) dirtySources.add(source);
    else dirtySources.delete(source);
    setBreveDirty(dirtySources.size > 0);
    return () => {
      dirtySources.delete(source);
      setBreveDirty(dirtySources.size > 0);
    };
  }, [dirty, source, setBreveDirty]);
}

export function EmptyMessage({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="breve-empty-state">
      <strong>{title}</strong>
      <p>{detail}</p>
      {action}
    </div>
  );
}

export function BreveSkeleton({ label }: { label: string }) {
  return (
    <div className="breve-skeleton" role="status" aria-label={label} aria-busy="true">
      <span className="breve-skeleton-title" />
      <span className="breve-skeleton-copy" />
      <span className="breve-skeleton-band" />
      <span className="breve-skeleton-row" />
      <span className="breve-skeleton-row short" />
    </div>
  );
}
