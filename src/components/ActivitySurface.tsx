// Brain Activity — the AI-Filer change journal (design §4.4.3). Every Filer action
// (file a note, set an AI field) is logged and REVERSIBLE here. In Phase 3 the actions
// are your own manual "file this note"; Phase 4's daemon appends the same shape. This
// is the trust surface: see everything the AI does, undo any of it.

import { useEffect, useState } from "react";
import { type BrainAction, readJournal, undoAction } from "../services/brainJournal";
import { invalidateNotes } from "../services/hooks";
import { usePanesStore } from "../state/panes";

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

export function ActivitySurface() {
  const [actions, setActions] = useState<BrainAction[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const openNote = usePanesStore((s) => s.openNote);

  const load = () =>
    readJournal()
      .then((a) => setActions(a))
      .catch((e) => {
        console.warn("journal read failed", e);
        setActions([]);
      });
  useEffect(() => {
    void load();
  }, []);

  const applied = (actions ?? []).filter((a) => a.status === "applied").reverse();
  const revertedIds = new Set((actions ?? []).filter((a) => a.status === "reverted").map((a) => a.id));

  const undo = async (a: BrainAction) => {
    setBusy(a.id);
    setErr(null);
    try {
      await undoAction(a);
      await invalidateNotes();
      await load();
    } catch (e) {
      console.warn("undo failed", e);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="board activity">
      <header className="board-head">
        <h2 className="board-title">Brain Activity</h2>
        <span className="board-count">{applied.length}</span>
      </header>
      {err && <p className="file-err" style={{ padding: "0 22px 8px" }}>⚠ {err}</p>}
      {actions === null ? (
        <p className="main-empty">Loading…</p>
      ) : applied.length === 0 ? (
        <div className="board-empty">
          <p className="be-title">Nothing yet</p>
          <p className="be-sub">
            When the AI files a note or updates its metadata it shows here — and you can undo any of it.
            On-device, logged, reversible.
          </p>
        </div>
      ) : (
        <div className="board-scroll">
          <ul className="recent-list">
            {applied.map((a) => {
              const undone = revertedIds.has(a.id);
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
                      onClick={() => openNote(a.noteId)}
                    >
                      {a.action === "file"
                        ? `Filed “${a.noteTitle}” → ${a.after.replace(/^wiki\//, "")}`
                        : `Set ${a.field} on “${a.noteTitle}”`}
                    </button>
                    <span className="act-time">{when(a.ts)}</span>
                    {undone ? (
                      <span className="act-undone">undone</span>
                    ) : (
                      <button
                        type="button"
                        className="act-undo"
                        disabled={busy === a.id}
                        onClick={() => void undo(a)}
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
