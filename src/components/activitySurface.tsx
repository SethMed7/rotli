// Brain Activity — the AI-Filer change journal (design §4.4.3). Every Filer action
// (file a note, set an AI field, refresh an area overview) is logged and REVERSIBLE
// here. Phase 3 rows are your own manual "file this note"; Phase 4's daemon appends
// the same shape — PROPOSALS land in the pending lane on top and apply only on an
// explicit Approve (the frontend never auto-applies). This is the trust surface:
// see everything the AI wants to do or has done, and undo any of it.

import { useState } from "react";
import {
  type BrainAction,
  approveProposal,
  deriveJournal,
  dismissProposal,
  undoAction,
} from "../services/brainJournal";
import { organizerRunOnce } from "../lib/tauri";
import { invalidateJournal, invalidateNotes, useJournal, useOrganizerStatus } from "../services/hooks";
import { usePanesStore } from "../state/panes";
import { Character } from "./character";

function when(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - new Date(ts).setHours(0, 0, 0, 0)) / 86_400_000);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (days <= 0) return time;
  if (days === 1) return `Yesterday ${time}`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** One line per row — same verbs for a proposal and its applied history twin. */
function describe(a: BrainAction, proposed: boolean): string {
  const verb =
    a.action === "file"
      ? `File “${a.noteTitle}” → ${(a.area ?? a.after).replace(/^wiki\//, "")}`
      : a.action === "index"
        ? `Refresh ${a.area ?? a.noteTitle} overview`
        : `Set ${a.field} on “${a.noteTitle}”`;
  if (proposed) {
    // labeled, not a bare number (#84, audit 2026-07)
    const pct =
      typeof a.confidence === "number" ? ` · ${Math.round(a.confidence * 100)}% sure` : "";
    return `Proposes: ${verb}${pct}`;
  }
  return a.action === "file" ? `Filed “${a.noteTitle}” → ${a.after.replace(/^wiki\//, "")}` : verb;
}

export function ActivitySurface() {
  const journal = useJournal();
  const status = useOrganizerStatus().data;
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const openNote = usePanesStore((s) => s.openNote);

  const actions = journal.data ?? null;
  const { pending, history } = deriveJournal(actions ?? []);

  // one busy/err funnel for approve/dismiss/undo — same pattern as Phase 3 undo
  const run = async (a: BrainAction, op: (a: BrainAction) => Promise<void>) => {
    setBusy(a.id);
    setErr(null);
    try {
      await op(a);
      await invalidateNotes();
      await invalidateJournal();
    } catch (e) {
      console.warn("journal action failed", e);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="board activity">
      <header className="board-head">
        <h2 className="board-title">Brain Activity</h2>
        <span className="board-count">{pending.length + history.length}</span>
        {/* the daemon is event-driven and sleeps when idle — this is the
            explicit nudge (one pass now, then back to sleep). Hidden when the
            worker never spawned (not a memex) or the ladder is Off. */}
        {status?.running && status.trust !== "off" && (
          <button
            type="button"
            className="act-undo"
            style={{ marginLeft: "auto" }}
            title="Run one organizer pass now (it never interrupts a chat)"
            onClick={() => {
              organizerRunOnce().then(
                () => void invalidateJournal(),
                (e) => setErr(e instanceof Error ? e.message : String(e)),
              );
            }}
          >
            Run now
          </button>
        )}
      </header>
      {err && <p className="file-err" style={{ padding: "0 22px 8px" }}>⚠ {err}</p>}
      {/* quiet daemon-status lines — show, never nag (§4.8) */}
      {status?.modelOffline && (
        <p className="brain-hint" style={{ padding: "0 22px 8px" }}>
          Paused — local model offline. {status.queued} waiting.
        </p>
      )}
      {(status?.secureSkipped ?? 0) > 0 && (
        <p className="brain-hint" style={{ padding: "0 22px 8px" }}>
          {status?.secureSkipped} {status?.secureSkipped === 1 ? "capture looks" : "captures look"}{" "}
          like they contain secrets — review them yourself. The AI won’t read or move them.
        </p>
      )}
      {actions === null ? (
        <p className="main-empty">Loading…</p>
      ) : pending.length === 0 && history.length === 0 ? (
        <div className="board-empty">
          <Character name="knowledge" size={104} className="be-quokka" />
          <p className="be-title">Nothing yet</p>
          <p className="be-sub">
            When the AI files a note or updates its metadata it shows here — and you can undo any of it.
            On-device, logged, reversible.
          </p>
        </div>
      ) : (
        <div className="board-scroll">
          {pending.length > 0 && (
            <ul className="recent-list">
              {pending.map((a) => (
                <li key={a.id}>
                  <div className="act-row">
                    <span className="act-brain" aria-hidden="true">
                      🧠
                    </span>
                    <button
                      type="button"
                      className="act-desc"
                      title="Open the note"
                      // the ULID survives filings/renames; the rel is a fallback
                      onClick={() => openNote(a.noteUlid ?? a.noteId)}
                    >
                      {describe(a, true)}
                    </button>
                    <span className="act-time">{when(a.ts)}</span>
                    <button
                      type="button"
                      /* the affirmative action gets the quiet accent — no more
                         identical ghost twins (#84, audit 2026-07) */
                      className="act-undo act-approve"
                      disabled={busy === a.id}
                      onClick={() => void run(a, approveProposal)}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="act-undo"
                      disabled={busy === a.id}
                      onClick={() => void run(a, dismissProposal)}
                    >
                      Dismiss
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <ul className="recent-list">
            {history.map((a) => {
              const undone = a.status === "reverted";
              return (
                <li key={a.id}>
                  <div className={undone ? "act-row done" : "act-row"}>
                    <span className="act-brain" aria-hidden="true">
                      🧠
                    </span>
                    <button
                      type="button"
                      className="act-desc"
                      title="Open the note"
                      onClick={() => openNote(a.noteUlid ?? a.noteId)}
                    >
                      {describe(a, false)}
                    </button>
                    <span className="act-time">{when(a.ts)}</span>
                    {undone ? (
                      <span className="act-undone">undone</span>
                    ) : (
                      <button
                        type="button"
                        className="act-undo"
                        disabled={busy === a.id}
                        onClick={() => void run(a, undoAction)}
                      >
                        Undo
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
