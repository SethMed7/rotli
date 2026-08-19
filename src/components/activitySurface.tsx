// The Librarian — the AI-Filer change journal (design §4.4.3). Every Filer
// action (file a note, set an AI field, refresh an area overview) is logged and
// REVERSIBLE here. PROPOSALS wait in the "Waiting for you" lane and apply only
// on an explicit Approve (the frontend never auto-applies). This is the trust
// surface: see everything the AI wants to do or has done, and undo any of it.
//
// 2026-07-31 rework (the maintainer): no per-row mascot, proposals grouped per note,
// history folded into days (recent first, the long tail behind View all), a
// first-visit explainer modal (re-openable via the labeled help button), a LIVE run band
// (the daemon narrates each note it looks at; Stop hands control back), and
// journal hygiene (prune resolved history; pending is sacred).

import { useEffect, useMemo, useRef, useState } from "react";

import { daysSinceMidnight, relativeLabel } from "../lib/dateLabels";
import { useTransientPopover } from "../lib/popover";
import {
  corpusJournalPrune,
  corpusResolveRef,
  corpusSetSecure,
  onOrganizerProgress,
  organizerDismissSecure,
  organizerRunOnce,
  organizerStop,
  secureRepairApply,
} from "../lib/tauri";
import { type BrainAction, canUndo, deriveJournal, describeAction } from "../services/brainJournal";
import { approveProposal, dismissProposal, undoAction } from "../services/brainJournalComposition";
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
import { ChevronRight, GearGlyph } from "./glyphs";

/** The status strip's plain words for the trust rung + organizing model. */
const TRUST_WORDS: Record<string, string> = {
  off: "Off",
  suggest: "Suggest — everything waits for your OK",
  tidy: "Tidy — new captures file themselves",
  organize: "Organize — working by itself in the background",
};
const MODEL_WORDS: Record<string, string> = {
  local: "On this Mac",
  claude: "Claude Sonnet 5",
  gemini35: "Gemini 3.5 Flash",
};

/** History longer than this earns the quiet "clear old logs" nudge (§4.8:
 * show, never nag — one line, two buttons, no badge). */
const LOG_NUDGE_AT = 300;
/** How many day groups show before the long tail folds behind View all. */
const RECENT_DAYS = 2;

function when(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function dayLabel(ts: number): string {
  const days = daysSinceMidnight(ts);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(days > 300 ? { year: "numeric" } : {}),
  });
}

/** One note's pending proposals, folded to a single row ("4 suggestions —
 * links · tags · summary · area") the user can approve or dismiss together. */
interface PendingGroup {
  key: string;
  title: string;
  ts: number;
  rows: BrainAction[];
}

function groupPending(pending: BrainAction[]): PendingGroup[] {
  const byNote = new Map<string, PendingGroup>();
  for (const a of pending) {
    const key = a.noteUlid ?? a.noteId;
    const g = byNote.get(key);
    if (g) {
      g.rows.push(a);
      g.ts = Math.max(g.ts, a.ts);
    } else {
      byNote.set(key, { key, title: a.noteTitle, ts: a.ts, rows: [a] });
    }
  }
  return [...byNote.values()].sort((a, b) => b.ts - a.ts);
}

function fieldWord(a: BrainAction): string {
  if (a.action === "file") return "file it";
  if (a.action === "index") return "area overview";
  return a.field === "suggested_area" ? "area" : (a.field ?? "field");
}

/** The first-visit explainer — everything the Librarian may and may NOT do,
 * in one card. Re-openable any time from the header's help button. */
function LibrarianIntro({
  onClose,
  onOpenSettings,
}: {
  onClose: () => void;
  onOpenSettings: (pane: "brain" | "security") => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  useTransientPopover([cardRef], true, onClose);
  return (
    <div className="lib-intro-overlay">
      <div
        className="lib-intro"
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label="About the Librarian"
      >
        <h3>Meet the Librarian</h3>
        <p>
          Your vault is a folder of plain files. The Librarian keeps it tidy: it files new captures into the
          Library&rsquo;s areas and fills in organizational metadata, so you never have to.
        </p>
        <ul className="lib-intro-rules">
          <li>
            <strong>It only moves files and edits metadata</strong> — summary, tags, links, area. It never
            rewrites a single word inside your notes.
          </li>
          <li>
            <strong>It always skips</strong> locked notes, secure notes, and your hand-arranged Main. Those
            are yours alone.
          </li>
          <li>
            <strong>Secrets are found by patterns, not AI.</strong> The secret detector is on-device pattern
            matching (key shapes, card numbers, SSNs) — no model reads your notes to find them. A model only
            reads a note to organize it, and only the model you chose in Settings.
          </li>
          <li>
            <strong>Recorded actions stay reviewable</strong> — undo rechecks the current note and refuses if
            it changed.
          </li>
        </ul>
        <h4>Where your files go</h4>
        <ul className="lib-intro-rules">
          <li>
            <strong>New captures wait in intake</strong> until the quiet window passes and the Librarian can
            place them in a Library area.
          </li>
          <li>
            <strong>Library areas are ordinary folders</strong> under <code>wiki/</code>. The Markdown files
            remain readable and editable without Rotli.
          </li>
          <li>
            <strong>Main and named views are references</strong> stored in <code>.rotli/</code>, never extra
            copies of your notes. Reorganizing a view does not move the file.
          </li>
          <li>
            <strong>Archive, Trash, assets, and chats stay separate</strong> so lifecycle state and app data
            do not get mixed into your note folders.
          </li>
        </ul>
        <h4>Why this structure</h4>
        <p>
          One durable file has one physical home. Views can change freely around it, and the journal can
          reverse the Librarian&rsquo;s moves without reconciling duplicate content. That keeps the vault
          portable, inspectable, and useful when Rotli is closed.
        </p>
        <p className="lib-intro-trust">
          <strong>How much may it do?</strong> That&rsquo;s the ladder in Settings → Librarian:
          <br />
          <em>Suggest</em> — nothing happens until you approve it here. · <em>Tidy</em> — files new captures
          and fills metadata by itself; area overview pages still wait for your OK. · <em>Organize</em> — Tidy
          plus keeps each area&rsquo;s overview page fresh, all on its own; metadata suggestions never pile
          up. Only one thing always waits for you at every rung: filing a note it isn&rsquo;t sure about.
        </p>
        <div className="lib-intro-links" aria-label="Learn more">
          <button type="button" className="ghostbtn" onClick={() => onOpenSettings("brain")}>
            Librarian settings
          </button>
          <button type="button" className="ghostbtn" onClick={() => onOpenSettings("security")}>
            Security &amp; privacy
          </button>
          <button type="button" className="ghostbtn primary lib-intro-ok" onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

/** The daemon's live narration — one rolling window of what it's touching. */
interface LiveRun {
  active: boolean;
  total: number;
  seen: number;
  current: string | null;
  summary: string | null;
}

export function ActivitySurface() {
  const journal = useJournal();
  // RAW vault (vault-vs-brain, 2026-07-26): organizer surfaces hide; the
  // journal HISTORY stays (it happened), and security surfaces (secure-note
  // repair, the review lane) are vault properties that never turn off.
  const brainOn = useUiStore((s) => s.brainEnabled);
  const trust = useUiStore((s) => s.organizerTrust);
  const model = useUiStore((s) => s.organizerModel);
  const introSeen = useUiStore((s) => s.librarianIntroSeen);
  const setIntroSeen = useUiStore((s) => s.setLibrarianIntroSeen);
  const status = useOrganizerStatus().data;
  const repair = useSecureRepair().data ?? [];
  const hints = useSecureHints().data ?? [];
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [introOpen, setIntroOpen] = useState(false);
  const [showAllDays, setShowAllDays] = useState(false);
  const [clearAllArmed, setClearAllArmed] = useState(false);
  const [dismissAllArmed, setDismissAllArmed] = useState(false);
  const pendingCount = deriveJournal(journal.data ?? []).pending.length;
  // an armed Dismiss-all must never survive a turnover of WHAT it would
  // dismiss — new proposals arriving would face a pre-armed red button for
  // suggestions the user never saw (review F3)
  useEffect(() => setDismissAllArmed(false), [pendingCount]);
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set());
  // expanded history rows — a log row's click shows before → after (2026-07-31)
  const [expandedRows, setExpandedRows] = useState<ReadonlySet<string>>(new Set());
  const toggleRow = (id: string) =>
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const [stopRequested, setStopRequested] = useState(false);
  // the explicit Run now must react INSTANTLY (the maintainer, 2026-07-31: "issues with
  // visually seeing something is even happening") — the band shows on click,
  // and a fallback timer explains the one case a start can't come (a chat)
  const runNowTimer = useRef<number | null>(null);
  const [live, setLive] = useState<LiveRun>({
    active: false,
    total: 0,
    seen: 0,
    current: null,
    summary: null,
  });
  // rows the user just acted on — hidden immediately; the daemon's own set
  // converges on its next pass (the acted-on file moved or was dismissed)
  const [acted, setActed] = useState<ReadonlySet<string>>(new Set());
  const openNote = usePanesStore((s) => s.openNote);
  // Journal rows can be path-addressed (an _index.md has no frontmatter ULID),
  // but openNote is an id-only door — resolve rel→wire-id first, or the tab
  // opens on an unresolvable id and renders "Untitled" (the maintainer, 2026-07-31).
  const openRef = (ref: string) => {
    void corpusResolveRef(ref)
      .then((id) => openNote(id))
      .catch(() => openNote(ref));
  };
  const review = deriveSecureReview(
    hints.filter((h) => !acted.has(h.rel)),
    repair,
  );

  // the explainer greets the FIRST visit; the ? button brings it back anytime
  useEffect(() => {
    if (!introSeen) setIntroOpen(true);
  }, [introSeen]);
  const closeIntro = () => {
    setIntroOpen(false);
    if (!introSeen) setIntroSeen(true);
  };
  const openIntroSettings = (pane: "brain" | "security") => {
    closeIntro();
    const ui = useUiStore.getState();
    ui.setSettingsPaneRequest(pane);
    ui.setSettingsOpen(true);
  };

  // the daemon's narration (titles only) — the "watch it work" feed
  useEffect(
    () =>
      onOrganizerProgress((p) => {
        if (runNowTimer.current !== null) {
          window.clearTimeout(runNowTimer.current);
          runNowTimer.current = null;
        }
        if (p.phase === "start") {
          // a stale Stop request (pressed against a phantom busy) must not
          // wedge the button into "Stopping…" for the next real run (review F1)
          setStopRequested(false);
          setLive({ active: true, total: p.total ?? 0, seen: 0, current: null, summary: null });
        } else if (p.phase === "note") {
          setLive((l) => ({
            ...l,
            active: true,
            seen: l.seen + 1,
            current: p.title || p.rel || null,
          }));
        } else {
          setStopRequested(false);
          const did = (p.applied ?? 0) + (p.proposals ?? 0) + (p.requeued ?? 0) > 0;
          setLive((l) => ({
            ...l,
            active: false,
            current: null,
            // a REAL cycle (we saw its start) always answers — an explicit
            // Run now that finds nothing must never read as a dead button
            // (the maintainer, 2026-07-31). An end WITHOUT a start (a dormant
            // early-return cycle, review F8) PRESERVES whatever summary is
            // showing — it must never erase the answer under the user's eyes.
            summary:
              p.error || !l.active
                ? l.summary // the status line carries any error
                : did || p.stopped
                  ? `${p.applied ?? 0} applied · ${p.proposals ?? 0} proposed${
                      p.stopped ? " · stopped by you" : ""
                    }`
                  : "Nothing new to organize — everything is already filed. Suggestions below still wait for your approval.",
          }));
          void invalidateJournal();
          void invalidateNotes();
        }
      }),
    [],
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
  const groups = useMemo(() => groupPending(pending), [pending]);

  // history folded into day groups, newest first — the recent days render,
  // the long tail waits behind "View all"
  const days = useMemo(() => {
    const out: { label: string; rows: BrainAction[] }[] = [];
    for (const a of history) {
      const label = dayLabel(a.ts);
      const last = out[out.length - 1];
      if (last && last.label === label) last.rows.push(a);
      else out.push({ label, rows: [a] });
    }
    return out;
  }, [history]);
  const visibleDays = showAllDays ? days : days.slice(0, RECENT_DAYS);
  const hiddenDayCount = days.length - RECENT_DAYS;

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

  /** The whole Waiting lane in one deliberate click (the maintainer, 2026-07-31: "clean
   * up of everything pending"). Sequential, continue-on-error — each row keeps
   * its freshness guard, a stale row is skipped and counted, never a batch
   * abort halfway with no report. */
  const runAllPending = async (op: (a: BrainAction) => Promise<void>, verb: string) => {
    setBusy("all-pending");
    setErr(null);
    setNote(null);
    setDismissAllArmed(false);
    let done = 0;
    let skipped = 0;
    let lastError: string | null = null;
    try {
      for (const a of pending) {
        try {
          await op(a);
          done += 1;
        } catch (e) {
          skipped += 1; // usually a freshness guard — the note changed since
          lastError = e instanceof Error ? e.message : String(e);
        }
        if ((done + skipped) % 10 === 0) setNote(`${verb} ${done + skipped} of ${pending.length}…`);
      }
      // at Organize the background adopter may have beaten this batch to some
      // rows — "already applied" is the honest story, not a complaint (F3)
      setNote(
        `${verb} ${done}${skipped > 0 ? ` · ${skipped} skipped (already applied or changed since)` : ""}.`,
      );
      // NOTHING succeeded — that's a systemic failure, not N stale rows; say
      // the real error instead of a false freshness story (review F4)
      if (done === 0 && lastError) setErr(lastError);
      await invalidateNotes();
      await invalidateJournal();
    } finally {
      // finally, not tail — a failed invalidation must never wedge the lane
      // at "Working…" (review F4)
      setBusy(null);
    }
  };

  /** Approve/dismiss one note's whole group, sequentially — each row keeps its
   * own freshness guard; the first failure stops and surfaces. */
  const runGroup = async (g: PendingGroup, op: (a: BrainAction) => Promise<void>) => {
    setBusy(g.key);
    setErr(null);
    try {
      for (const a of g.rows) await op(a);
      await invalidateNotes();
      await invalidateJournal();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      await invalidateJournal(); // partial progress is real — show it
    } finally {
      setBusy(null);
    }
  };

  const prune = (keepDays: number) => {
    setBusy("prune");
    setErr(null);
    setNote(null);
    corpusJournalPrune(keepDays)
      .then(async (removed) => {
        setNote(
          removed > 0
            ? `Cleared ${removed} old log ${removed === 1 ? "entry" : "entries"}.`
            : "Nothing old enough to clear.",
        );
        await invalidateJournal();
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(null));
  };

  const running = live.active || status?.busy === true;

  return (
    <div className="board activity">
      {introOpen && <LibrarianIntro onClose={closeIntro} onOpenSettings={openIntroSettings} />}
      <header className="board-head">
        <h2 className="board-title">Librarian</h2>
        {pending.length > 0 && (
          <span className="board-count act-waiting" title="Suggestions waiting for you">
            {pending.length} waiting
          </span>
        )}
        <button
          type="button"
          className="act-help"
          aria-label="How the Librarian works"
          title="How the Librarian works"
          onClick={() => setIntroOpen(true)}
        >
          How it works
        </button>
        {/* the daemon is event-driven and sleeps when idle — this is the
            explicit nudge (one pass now, then back to sleep). Hidden when the
            worker never spawned (not a memex) or the ladder is Off. */}
        {brainOn &&
          status?.running &&
          status.trust !== "off" &&
          (running ? (
            <button
              type="button"
              className="act-undo act-stop"
              style={{ marginLeft: "auto" }}
              disabled={stopRequested}
              title="Finish the current note, then stop — the rest stays queued"
              onClick={() => {
                setStopRequested(true);
                organizerStop().catch((e) => setErr(e instanceof Error ? e.message : String(e)));
              }}
            >
              {stopRequested ? "Stopping…" : "Stop"}
            </button>
          ) : (
            <button
              type="button"
              className="act-undo"
              style={{ marginLeft: "auto" }}
              title="Run one organizer pass now (it never interrupts a chat)"
              onClick={() => {
                // the band appears ON CLICK — never a dead-feeling button;
                // the daemon's start event refines it, and the one case a
                // start can't come (an in-flight chat) explains itself
                setNote(null);
                setLive({ active: true, total: 0, seen: 0, current: null, summary: null });
                if (runNowTimer.current !== null) window.clearTimeout(runNowTimer.current);
                runNowTimer.current = window.setTimeout(() => {
                  runNowTimer.current = null;
                  setLive((l) => (l.active && l.seen === 0 && l.total === 0 ? { ...l, active: false } : l));
                  setNote("Queued — the pass starts the moment any in-flight chat finishes.");
                }, 8000);
                organizerRunOnce().then(
                  () => void invalidateJournal(),
                  (e) => setErr(e instanceof Error ? e.message : String(e)),
                );
              }}
            >
              Run now
            </button>
          ))}
      </header>
      {/* the standing status strip: what the Librarian IS right now — rung,
          model, last pass — with its settings ONE click away (the maintainer,
          2026-07-31: "no way to see my librarian settings from here") */}
      {brainOn && status?.running && (
        <div className="act-strip">
          <span className="act-strip-main">{TRUST_WORDS[trust] ?? trust}</span>
          <span className="act-strip-sep" aria-hidden="true">
            ·
          </span>
          <span>{MODEL_WORDS[model] ?? model}</span>
          {status.lastRunAt && Number.isFinite(Date.parse(status.lastRunAt)) && (
            <>
              <span className="act-strip-sep" aria-hidden="true">
                ·
              </span>
              <span title={status.lastRunAt}>last pass {relativeLabel(Date.parse(status.lastRunAt))}</span>
            </>
          )}
          {/* labeled, not a bare icon (the maintainer, 2026-07-31: "hard to see and
              understand till I click") */}
          <button
            type="button"
            className="act-undo act-strip-settings"
            onClick={() => {
              const ui = useUiStore.getState();
              ui.setSettingsPaneRequest("brain");
              ui.setSettingsOpen(true);
            }}
          >
            <GearGlyph size={12} /> Librarian settings
          </button>
        </div>
      )}
      {/* the LIVE band — the daemon narrating exactly what it's touching */}
      {running && (
        <div className="act-live" role="status">
          <span className="act-live-dot" aria-hidden="true" />
          <span className="act-live-text">
            {live.current
              ? `Looking at “${live.current}”${live.total > 0 ? ` — ${live.seen} of ${live.total}` : ""}`
              : "Organizing…"}
          </span>
        </div>
      )}
      {!running && live.summary && (
        <p className="brain-hint act-pad" role="status">
          Last run: {live.summary}
        </p>
      )}
      {err && <p className="file-err act-pad">⚠ {err}</p>}
      {note && (
        <p className="brain-hint act-pad" role="status">
          {note}
        </p>
      )}
      {/* quiet daemon-status lines — show, never nag (§4.8) */}
      {brainOn && status?.modelOffline && (
        <p className="brain-hint act-pad">Paused — local model offline. {status.queued} waiting.</p>
      )}
      {/* the secure-review confirm lane (feature B, decision 2026-07-22): the
          detector PROPOSES, the user disposes — nothing is ever auto-marked
          from here. "Not sensitive" is remembered for that exact content.
          ALWAYS the surface's first business (the maintainer, 2026-07-31). */}
      {review.confirm.length > 0 && (
        <div className="brain-hint act-pad act-secure-band">
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
                  onClick={() => openRef(h.rel)}
                >
                  “{h.title}”
                </button>
                <button
                  type="button"
                  className="act-undo act-approve"
                  disabled={busy !== null}
                  onClick={() => actOnHint(h.rel, () => corpusSetSecure(h.rel, true))}
                >
                  Make secure
                </button>
                <button
                  type="button"
                  className="act-undo"
                  disabled={busy !== null}
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
        <p className="brain-hint act-pad">
          {review.flaggedLeftover} secure {review.flaggedLeftover === 1 ? "note awaits" : "notes await"} your
          review — the AI won’t read or move {review.flaggedLeftover === 1 ? "it" : "them"}.
        </p>
      )}
      {/* legacy secure-intake repair (decision 2026-07-22): explicit and
          previewable — the list IS the preview, one deliberate click applies,
          and Rust re-validates every note on disk before its protected move. */}
      {repair.length > 0 && (
        <div className="brain-hint act-pad">
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
            disabled={busy !== null}
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
          <Character name="thoughtful" size={104} className="be-quokka" />
          <p className="be-title">Nothing yet</p>
          <p className="be-sub">
            When the Librarian files a note or updates its metadata it shows here — and you can undo any of
            it. On-device, logged, reversible.
          </p>
        </div>
      ) : (
        <div className="board-scroll">
          {/* ── Waiting for you: one row per NOTE, its suggestions folded ── */}
          {groups.length > 0 && (
            <>
              <div className="act-section act-section-row">
                <h3 className="act-section-title">
                  Waiting for you <span className="act-section-n">{pending.length}</span>
                </h3>
                {brainOn && (
                  <button
                    type="button"
                    className="act-undo act-approve"
                    disabled={busy !== null}
                    onClick={() => void runAllPending(approveProposal, "Approved")}
                  >
                    {busy === "all-pending" ? "Working…" : `Approve all ${pending.length}`}
                  </button>
                )}
                {dismissAllArmed ? (
                  <>
                    <button type="button" className="act-undo" onClick={() => setDismissAllArmed(false)}>
                      Keep
                    </button>
                    <button
                      type="button"
                      className="act-undo act-stop"
                      disabled={busy !== null}
                      onClick={() => {
                        setDismissAllArmed(false);
                        void runAllPending(dismissProposal, "Dismissed");
                      }}
                    >
                      Dismiss all {pending.length}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="act-undo"
                    disabled={busy !== null}
                    onClick={() => setDismissAllArmed(true)}
                  >
                    Dismiss all…
                  </button>
                )}
              </div>
              <ul className="recent-list">
                {groups.map((g) => {
                  const open = openGroups.has(g.key) || g.rows.length === 1;
                  return (
                    <li key={g.key}>
                      {g.rows.length > 1 && (
                        <div className="act-row act-group">
                          <button
                            type="button"
                            className="act-disclose"
                            aria-expanded={openGroups.has(g.key)}
                            aria-label={`${openGroups.has(g.key) ? "Collapse" : "Expand"} suggestions for ${g.title}`}
                            onClick={() =>
                              setOpenGroups((prev) => {
                                const next = new Set(prev);
                                if (next.has(g.key)) next.delete(g.key);
                                else next.add(g.key);
                                return next;
                              })
                            }
                          >
                            <ChevronRight size={11} className={openGroups.has(g.key) ? "open" : undefined} />
                          </button>
                          <button
                            type="button"
                            className="act-desc"
                            title="Open the note"
                            onClick={() => openRef(g.rows[0]?.noteUlid ?? g.rows[0]?.noteId ?? g.key)}
                          >
                            <strong>“{g.title || "Area overview"}”</strong> — {g.rows.length} suggestions:{" "}
                            {g.rows.map(fieldWord).join(" · ")}
                          </button>
                          <span className="act-time">{when(g.ts)}</span>
                          {brainOn && (
                            <button
                              type="button"
                              className="act-undo act-approve"
                              disabled={busy !== null}
                              onClick={() => void runGroup(g, approveProposal)}
                            >
                              Approve all
                            </button>
                          )}
                          <button
                            type="button"
                            className="act-undo"
                            disabled={busy !== null}
                            onClick={() => void runGroup(g, dismissProposal)}
                          >
                            Dismiss all
                          </button>
                        </div>
                      )}
                      {open && (
                        <ul className={g.rows.length > 1 ? "recent-list act-sub" : "recent-list"}>
                          {g.rows.map((a) => (
                            <li key={a.id}>
                              <div className="act-row">
                                <button
                                  type="button"
                                  className="act-desc"
                                  title="Open the note"
                                  // the ULID survives filings/renames; the rel is a fallback
                                  onClick={() => openRef(a.noteUlid ?? a.noteId)}
                                >
                                  {describeAction(a, true)}
                                </button>
                                <span className="act-time">{when(a.ts)}</span>
                                {/* raw vault: Approve would hit the Rust refusal — only
                                    Dismiss (journal-only) remains actionable */}
                                {brainOn && (
                                  <button
                                    type="button"
                                    className="act-undo act-approve"
                                    // the group batch may be mid-flight on this
                                    // exact row — no concurrent twin (review F3)
                                    disabled={busy !== null}
                                    onClick={() => void run(a, approveProposal)}
                                  >
                                    Approve
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="act-undo"
                                  disabled={busy !== null}
                                  onClick={() => void run(a, dismissProposal)}
                                >
                                  Dismiss
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {/* ── History: recent days open, the long tail behind View all ── */}
          {days.length > 0 && (
            <h3 className="act-section">
              History <span className="act-section-n">{history.length}</span>
            </h3>
          )}
          {visibleDays.map((day) => (
            <div key={day.label}>
              <h4 className="act-day">
                {day.label} <span className="act-section-n">{day.rows.length}</span>
              </h4>
              <ul className="recent-list">
                {day.rows.map((a) => {
                  const undone = a.status === "reverted";
                  const expanded = expandedRows.has(a.id);
                  return (
                    <li key={a.id}>
                      <div className={undone ? "act-row done" : "act-row"}>
                        <button
                          type="button"
                          className="act-disclose"
                          aria-expanded={expanded}
                          aria-label={`${expanded ? "Hide" : "Show"} what changed`}
                          onClick={() => toggleRow(a.id)}
                        >
                          <ChevronRight size={11} className={expanded ? "open" : undefined} />
                        </button>
                        {/* a log row's click SAYS WHAT IT DID (the maintainer, 2026-07-31)
                            — the before → after lives right here; the note
                            itself is one link away inside the detail */}
                        <button
                          type="button"
                          className="act-desc"
                          title={expanded ? "Hide what changed" : "Show what changed"}
                          onClick={() => toggleRow(a.id)}
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
                              disabled={busy !== null}
                              onClick={() => void run(a, undoAction)}
                            >
                              Undo
                            </button>
                          )
                        )}
                      </div>
                      {expanded && (
                        <div className="act-detail">
                          {a.action === "field" ? (
                            <>
                              <div className="act-diff-was">{a.before.trim() ? a.before : "(empty)"}</div>
                              <div className="act-diff-now">{a.after.trim() ? a.after : "(empty)"}</div>
                            </>
                          ) : a.action === "file" ? (
                            <div className="act-diff-move">
                              moved from <code>{a.before || "?"}</code> to <code>{a.after || "?"}</code>
                            </div>
                          ) : a.action === "index" ? (
                            <div className="act-diff-move">
                              the area&rsquo;s overview page was regenerated from its members
                            </div>
                          ) : (
                            <div className="act-diff-move">a one-time repair</div>
                          )}
                          <button
                            type="button"
                            className="act-linkbtn act-detail-open"
                            onClick={() => openRef(a.noteUlid ?? a.noteId)}
                          >
                            Open the note
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          {hiddenDayCount > 0 && (
            <button type="button" className="act-viewall" onClick={() => setShowAllDays(!showAllDays)}>
              {showAllDays
                ? "Show recent days only"
                : `View all — ${hiddenDayCount} more ${hiddenDayCount === 1 ? "day" : "days"}`}
            </button>
          )}
          {/* journal hygiene: these are just logs — pending is never touched */}
          {history.length > 0 && (
            <div className="act-logcare">
              {history.length > LOG_NUDGE_AT && (
                <p>The journal holds {history.length} entries — clearing old logs keeps things quick.</p>
              )}
              <button type="button" className="act-undo" disabled={busy !== null} onClick={() => prune(30)}>
                Clear logs older than 30 days
              </button>
              {/* cleared history takes its Undo with it — an armed two-step,
                  same grammar as Empty Trash (review F2) */}
              {clearAllArmed ? (
                <>
                  <button type="button" className="act-undo" onClick={() => setClearAllArmed(false)}>
                    Keep
                  </button>
                  <button
                    type="button"
                    className="act-undo act-stop"
                    disabled={busy !== null}
                    onClick={() => {
                      setClearAllArmed(false);
                      prune(0);
                    }}
                  >
                    Remove {history.length} entries — their Undo goes with them
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="act-undo"
                  disabled={busy !== null}
                  onClick={() => setClearAllArmed(true)}
                >
                  Clear all history…
                </button>
              )}
              <p className="act-logcare-hint">Cleared entries can no longer be undone from here.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
