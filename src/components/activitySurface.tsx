// Brain Activity — the AI-Filer change journal (design §4.4.3). Every Filer action
// (file a note, set an AI field, refresh an area overview) is logged and REVERSIBLE
// here. Phase 3 rows are your own manual "file this note"; Phase 4's daemon appends
// the same shape — PROPOSALS land in the pending lane on top and apply only on an
// explicit Approve (the frontend never auto-applies). This is the trust surface:
// see everything the AI wants to do or has done, and undo any of it.

import { useState } from "react";
import { type BrainAction, canUndo, deriveJournal, describeAction } from "../services/brainJournal";
import { approveProposal, dismissProposal, undoAction } from "../services/brainJournalComposition";
import { daysSinceMidnight } from "../lib/dateLabels";
import { corpusSetSecure, organizerDismissSecure, organizerRunOnce, secureRepairApply } from "../lib/tauri";
import {
  invalidateJournal,
  invalidateNotes,
  useJournal,
  useOrganizerStatus,
  useSecureHints,
  useSecureRepair,
} from "../services/hooks";
import { deriveSecureReview } from "../services/secureReview";
import { usePanesStore } from "../state/panes";
import { useUiStore } from "../state/ui";
import { Character } from "./character";

function when(ts: number): string {
  const d = new Date(ts);
  const days = daysSinceMidnight(ts);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (days <= 0) return time;
  if (days === 1) return `Yesterday ${time}`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function ActivitySurface() {
  const journal = useJournal();
  // RAW vault (vault-vs-brain, 2026-07-26): organizer surfaces hide; the
  // journal HISTORY stays (it happened), and security surfaces (secure-note
  // repair, the review lane) are vault properties that never turn off.
  const brainOn = useUiStore((s) => s.brainEnabled);
  const status = useOrganizerStatus().data;
  const repair = useSecureRepair().data ?? [];
  const hints = useSecureHints().data ?? [];
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // rows the user just acted on — hidden immediately; the daemon's own set
  // converges on its next pass (the acted-on file moved or was dismissed)
  const [acted, setActed] = useState<ReadonlySet<string>>(new Set());
  const openNote = usePanesStore((s) => s.openNote);
  const review = deriveSecureReview(
    hints.filter((h) => !acted.has(h.rel)),
    repair,
  );

  const actOnHint = (rel: string, op: () => Promise<void>) => {
    setBusy(rel);
    setErr(null);
    op()
      .then(async () => {
        setActed((prev) => new Set(prev).add(rel));
        await invalidateNotes();
        await invalidateJournal();
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(null));
  };

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
        <h2 className="board-title">Librarian Activity</h2>
        <span className="board-count">{pending.length + history.length}</span>
        {/* the daemon is event-driven and sleeps when idle — this is the
            explicit nudge (one pass now, then back to sleep). Hidden when the
            worker never spawned (not a memex) or the ladder is Off. */}
        {brainOn && status?.running && status.trust !== "off" && (
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
      {err && (
        <p className="file-err" style={{ padding: "0 22px 8px" }}>
          ⚠ {err}
        </p>
      )}
      {/* quiet daemon-status lines — show, never nag (§4.8) */}
      {brainOn && status?.modelOffline && (
        <p className="brain-hint" style={{ padding: "0 22px 8px" }}>
          Paused — local model offline. {status.queued} waiting.
        </p>
      )}
      {/* the secure-review confirm lane (feature B, decision 2026-07-22): the
          detector PROPOSES, the user disposes — nothing is ever auto-marked
          from here. "Not sensitive" is remembered for that exact content. */}
      {review.confirm.length > 0 && (
        <div className="brain-hint" style={{ padding: "0 22px 8px" }}>
          <p style={{ margin: 0 }}>
            {review.confirm.length === 1
              ? "1 note looks like it holds sensitive data"
              : `${review.confirm.length} notes look like they hold sensitive data`}{" "}
            — the AI won’t read or move {review.confirm.length === 1 ? "it" : "them"} while you decide.
          </p>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {review.confirm.map((h) => (
              <li key={h.rel} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  type="button"
                  className="act-desc"
                  title="Open the note"
                  onClick={() => openNote(h.rel)}
                >
                  “{h.title}”
                </button>
                <button
                  type="button"
                  className="act-undo act-approve"
                  disabled={busy === h.rel}
                  onClick={() => actOnHint(h.rel, () => corpusSetSecure(h.rel, true))}
                >
                  Make secure
                </button>
                <button
                  type="button"
                  className="act-undo"
                  disabled={busy === h.rel}
                  onClick={() => actOnHint(h.rel, () => organizerDismissSecure(h.rel))}
                >
                  Not sensitive
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {review.flaggedLeftover > 0 && (
        <p className="brain-hint" style={{ padding: "0 22px 8px" }}>
          {review.flaggedLeftover} secure {review.flaggedLeftover === 1 ? "note awaits" : "notes await"} your
          review — the AI won’t read or move {review.flaggedLeftover === 1 ? "it" : "them"}.
        </p>
      )}
      {/* legacy secure-intake repair (decision 2026-07-22): explicit and
          previewable — the list IS the preview, one deliberate click applies,
          and Rust re-validates every note on disk before its protected move. */}
      {repair.length > 0 && (
        <div className="brain-hint" style={{ padding: "0 22px 8px" }}>
          <p style={{ margin: 0 }}>
            {repair.length === 1
              ? "1 secure note still sits in intake"
              : `${repair.length} secure notes still sit in intake`}{" "}
            — left there by an older version. Moving {repair.length === 1 ? "it" : "them"} into Secure notes
            keeps {repair.length === 1 ? "its" : "their"} words untouched and never shows the AI anything.
          </p>
          <ul style={{ margin: "6px 0", paddingLeft: 18 }}>
            {repair.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className="act-desc"
                  title="Open the note"
                  onClick={() => openNote(c.id)}
                >
                  “{c.title}” — from intake
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="act-undo act-approve"
            disabled={busy === "secure-repair"}
            onClick={() => {
              setBusy("secure-repair");
              setErr(null);
              secureRepairApply()
                .then(async (r) => {
                  if (r.failed.length > 0) setErr(r.failed.join(" · "));
                  await invalidateNotes();
                  await invalidateJournal();
                })
                .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
                .finally(() => setBusy(null));
            }}
          >
            {repair.length === 1 ? "Move it to Secure notes" : "Move them to Secure notes"}
          </button>
        </div>
      )}
      {actions === null ? (
        <p className="main-empty">Loading…</p>
      ) : pending.length === 0 && history.length === 0 ? (
        <div className="list-empty">
          <Character name="knowledge" size={104} className="be-quokka" />
          <p className="be-title">Nothing yet</p>
          <p className="be-sub">
            When the Librarian files a note or updates its metadata it shows here — and you can undo any of
            it. On-device, logged, reversible.
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
                      {describeAction(a, true)}
                    </button>
                    <span className="act-time">{when(a.ts)}</span>
                    {/* raw vault: Approve would hit the Rust refusal — only
                        Dismiss (journal-only) remains actionable */}
                    {brainOn && (
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
                    )}
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
                      {describeAction(a, false)}
                    </button>
                    <span className="act-time">{when(a.ts)}</span>
                    {undone ? (
                      <span className="act-undone">undone</span>
                    ) : (
                      /* raw vault: Undo replays a Brain move and would hit the
                         Rust refusal — history stays readable, not actionable */
                      brainOn &&
                      canUndo(a) && (
                        <button
                          type="button"
                          className="act-undo"
                          disabled={busy === a.id}
                          onClick={() => void run(a, undoAction)}
                        >
                          Undo
                        </button>
                      )
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
