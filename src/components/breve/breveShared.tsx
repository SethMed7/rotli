// Presentation helpers shared by the Breve views (breveSurface.tsx,
// breveWatchlist.tsx): page header, save-state note, draft guard, empty and
// loading states. Pulled out of the surface file so sibling views can reuse
// them without growing the god-file.

import { useEffect } from "react";
import type { ReactNode } from "react";
import { CheckGlyph } from "../glyphs";
import { useUiStore } from "../../state/ui";

export type SaveState = "idle" | "saving" | "saved" | "error";

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

export function useBreveDraftGuard(dirty: boolean) {
  const setBreveDirty = useUiStore((state) => state.setBreveDirty);
  useEffect(() => {
    setBreveDirty(dirty);
    return () => setBreveDirty(false);
  }, [dirty, setBreveDirty]);
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
