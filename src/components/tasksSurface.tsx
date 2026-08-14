// The Tasks surface (decision 2026-07-25): every open Markdown checkbox across
// the corpus, grouped by note — a projection, never a store (Markdown is the
// only truth; docs/decisions/2026-07-25-tasks-surface.md). Checking a task off
// is a real note edit through the ordinary write path; Rust re-validates the
// exact text first, so a stale row refuses instead of flipping the wrong line.

import { useEffect, useMemo, useRef, useState } from "react";

import { stripMarkdown } from "../editor/stripMarkdown";
import { registerSurfaceFind } from "../keys/surfaceFind";
import { corpusToggleTask } from "../lib/tauri";
import { invalidateNotes, useNoteIndex, useTasks } from "../services/hooks";
import { filterTaskGroups, groupTasks, sectionTaskGroups } from "../services/tasksView";
import { usePanesStore } from "../state/panes";
import { Character } from "./character";
import { ChevronRight, FileGlyph, SearchGlyph } from "./glyphs";

export function TasksSurface() {
  const tasks = useTasks();
  const noteIndex = useNoteIndex();
  const openNote = usePanesStore((s) => s.openNote);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // rows just checked off — struck through immediately; the refetch removes them
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const items = tasks.data ?? null;
  const updatedAtByNote = useMemo(
    () => new Map([...noteIndex].map(([id, note]) => [id, note.updatedAt] as const)),
    [noteIndex],
  );
  const groups = useMemo(() => groupTasks(items ?? [], updatedAtByNote), [items, updatedAtByNote]);
  const filtered = useMemo(() => filterTaskGroups(groups, query), [groups, query]);
  const sections = useMemo(() => sectionTaskGroups(filtered, Date.now()), [filtered]);
  const taskKey = (noteId: string, line: number) => `${noteId}:${line}`;

  useEffect(() => {
    return registerSurfaceFind(() => {
      searchRef.current?.focus();
      searchRef.current?.select();
    });
  }, []);

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
        <label className="task-search">
          <SearchGlyph size={14} />
          <input
            ref={searchRef}
            type="search"
            value={query}
            placeholder="Search tasks…"
            aria-label="Search tasks"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          {query && (
            <button type="button" aria-label="Clear task search" onClick={() => setQuery("")}>
              ×
            </button>
          )}
        </label>
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
            Any <code>- [ ]</code> checkbox you write in a note shows up here — including the ones you marked{" "}
            <code>- [/]</code> as in progress. Check it off from either side; the note is the only truth.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="list-empty compact">
          <SearchGlyph size={28} />
          <p className="be-title">No matching tasks</p>
          <p className="be-sub">Try a note title or words from the task.</p>
        </div>
      ) : (
        <div className="board-scroll">
          {/* what this surface IS — the groups below are notes (Seth,
              2026-07-31: "not clear what notes are apart of or what it is") */}
          <p className="task-intro">
            Every open checkbox from your notes, grouped by the note it lives in. Checking one off edits the
            note itself.
          </p>
          {sections.map((section) => (
            <section key={section.id} className="task-age-section" aria-labelledby={`tasks-${section.id}`}>
              <h3 id={`tasks-${section.id}`}>{section.label}</h3>
              {section.groups.map((g) => (
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
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
