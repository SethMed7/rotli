// The Tasks surface (decision 2026-07-25): every open Markdown checkbox across
// the corpus, grouped by note — a projection, never a store (Markdown is the
// only truth; docs/decisions/2026-07-25-tasks-surface.md). Checking a task off
// is a real note edit through the ordinary write path; Rust re-validates the
// exact text first, so a stale row refuses instead of flipping the wrong line.

import { useState } from "react";
import { stripMarkdown } from "../editor/stripMarkdown";
import { corpusToggleTask } from "../lib/tauri";
import { invalidateNotes, useTasks } from "../services/hooks";
import { groupTasks } from "../services/tasksView";
import { usePanesStore } from "../state/panes";
import { Character } from "./character";
import { ChevronRight, FileGlyph } from "./glyphs";

export function TasksSurface() {
  const tasks = useTasks();
  const openNote = usePanesStore((s) => s.openNote);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // rows just checked off — struck through immediately; the refetch removes them
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());

  const items = tasks.data ?? null;
  const groups = groupTasks(items ?? []);
  const taskKey = (noteId: string, line: number) => `${noteId}:${line}`;

  const check = (noteId: string, line: number, text: string) => {
    const key = taskKey(noteId, line);
    setBusy(key);
    setErr(null);
    corpusToggleTask(noteId, line, text)
      .then(async () => {
        setDone((prev) => new Set(prev).add(key));
        await invalidateNotes();
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(null));
  };

  return (
    <div className="board tasks">
      <header className="board-head">
        <h2 className="board-title">Tasks</h2>
        <span className="board-count">{items?.length ?? 0}</span>
      </header>
      {err && (
        <p className="file-err" style={{ padding: "0 22px 8px" }}>
          ⚠ {err}
        </p>
      )}
      {items === null ? (
        <p className="main-empty">Loading…</p>
      ) : groups.length === 0 ? (
        <div className="list-empty">
          <Character name="celebrating" size={104} className="be-quokka" />
          <p className="be-title">Nothing open</p>
          <p className="be-sub">
            Any <code>- [ ]</code> checkbox you write in a note shows up here. Check it off from either side —
            the note is the only truth.
          </p>
        </div>
      ) : (
        <div className="board-scroll">
          {/* what this surface IS — the groups below are notes (Seth,
              2026-07-31: "not clear what notes are apart of or what it is") */}
          <p className="task-intro">
            Every open checkbox from your notes, grouped by the note it lives in. Checking one off edits the
            note itself.
          </p>
          {groups.map((g) => (
            <section key={g.noteId} className="task-group">
              <button
                type="button"
                className="task-note"
                title="Open the note"
                onClick={() => openNote(g.noteId)}
              >
                <FileGlyph size={14} className="task-note-icon" />
                <span className="task-note-title">{g.noteTitle}</span>
                <span className="task-note-count">{g.tasks.length}</span>
                <ChevronRight size={10} className="task-note-go" />
              </button>
              <ul className="task-list">
                {g.tasks.map((t) => {
                  const key = taskKey(t.noteId, t.line);
                  const checked = done.has(key);
                  // display strips inline markdown; the RAW text stays the
                  // toggle's expect (Rust re-validates the exact source line)
                  const label = stripMarkdown(t.text);
                  return (
                    <li key={key}>
                      <div className={checked ? "task-row done" : "task-row"}>
                        <button
                          type="button"
                          className="task-check"
                          role="checkbox"
                          aria-checked={checked}
                          aria-label={`Mark done: ${label}`}
                          disabled={checked || busy === key}
                          onClick={() => check(t.noteId, t.line, t.text)}
                        />
                        <span className="task-text" title={label}>
                          {label}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
