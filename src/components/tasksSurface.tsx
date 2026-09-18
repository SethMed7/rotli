// The Tasks surface (decision 2026-07-25; regroomed 2026-09-18 after the owner's
// review: "search needs to be addressed, the width, clarity of what is part of
// what note at a glance"): every open Markdown checkbox across the corpus,
// grouped by note — each note a headed group whose tasks hang under it on a
// rule, a note can fold, long tasks wrap, and tasks in notes untouched for
// TASK_ARCHIVE_DAYS sit in a closed Archived section. A projection, never a store (Markdown is the
// only truth; docs/decisions/2026-07-25-tasks-surface.md). Checking a task off
// is a real note edit through the ordinary write path; Rust re-validates the
// exact text first, so a stale row refuses instead of flipping the wrong line.

import { useEffect, useMemo, useRef, useState } from "react";

import { stripMarkdown } from "../editor/stripMarkdown";
import { registerSurfaceFind } from "../keys/surfaceFind";
import { corpusToggleTask, isTauri } from "../lib/tauri";
import { useNow } from "../lib/useNow";
import { invalidateNotes, useNoteIndex, useTasks } from "../services/hooks";
import {
  TASK_ARCHIVE_DAYS,
  filterTaskGroups,
  groupTasks,
  sectionTaskGroups,
  taskCount,
} from "../services/tasksView";
import { toggleWebTask } from "../services/webTasks";
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
  // notes folded by hand, and whether Archived is open (closed until asked for;
  // a search opens it, or its matches would be invisible)
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const toggleFold = (noteId: string) =>
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(noteId)) next.delete(noteId);
      else next.add(noteId);
      return next;
    });
  const searchRef = useRef<HTMLInputElement>(null);

  const items = tasks.data ?? null;
  const updatedAtByNote = useMemo(
    () => new Map([...noteIndex].map(([id, note]) => [id, note.updatedAt] as const)),
    [noteIndex],
  );
  const groups = useMemo(() => groupTasks(items ?? [], updatedAtByNote), [items, updatedAtByNote]);
  const filtered = useMemo(() => filterTaskGroups(groups, query), [groups, query]);
  const now = useNow();
  const sections = useMemo(() => sectionTaskGroups(filtered, now), [filtered, now]);
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
    (isTauri() ? corpusToggleTask(noteId, line, text) : toggleWebTask(noteId, line, text))
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
        <button
          type="button"
          className="task-help"
          aria-expanded={helpOpen}
          aria-controls="task-intro"
          aria-label="What is this list?"
          title="What is this list?"
          onClick={() => setHelpOpen((open) => !open)}
        >
          ?
        </button>
        <label className="surface-search">
          <SearchGlyph size={14} />
          {/* text, not search: the search type draws its own magnifier and
              clear button beside ours (the owner's screenshot, 2026-09-18) */}
          <input
            ref={searchRef}
            type="text"
            role="searchbox"
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
          {helpOpen && (
            <p className="task-intro" id="task-intro">
              Every open checkbox from your notes, grouped by the note it lives in. Checking one off edits the
              note itself. Tasks in notes you haven’t touched for {TASK_ARCHIVE_DAYS} days rest under
              Archived; edit the note and they come back.
            </p>
          )}
          {sections.map((section) => {
            const open = !section.archived || archiveOpen || query.trim() !== "";
            return (
              <section
                key={section.id}
                className={section.archived ? "task-age-section archived" : "task-age-section"}
                aria-labelledby={`tasks-${section.id}`}
              >
                {section.archived ? (
                  <h3 id={`tasks-${section.id}`}>
                    <button
                      type="button"
                      className="task-archive-toggle"
                      aria-expanded={open}
                      onClick={() => setArchiveOpen((was) => !was)}
                    >
                      <ChevronRight size={10} className={open ? "task-fold open" : "task-fold"} />
                      {section.label}
                      <span className="task-note-count">{taskCount(section.groups)}</span>
                    </button>
                  </h3>
                ) : (
                  <h3 id={`tasks-${section.id}`}>{section.label}</h3>
                )}
                {open &&
                  section.groups.map((g) => {
                    const isFolded = folded.has(g.noteId);
                    return (
                      <section key={g.noteId} className="task-group">
                        <div className="task-note-head">
                          <button
                            type="button"
                            className="task-fold-button"
                            aria-expanded={!isFolded}
                            aria-label={
                              isFolded ? `Show tasks in ${g.noteTitle}` : `Hide tasks in ${g.noteTitle}`
                            }
                            onClick={() => toggleFold(g.noteId)}
                          >
                            <ChevronRight size={10} className={isFolded ? "task-fold" : "task-fold open"} />
                          </button>
                          <button
                            type="button"
                            className="task-note"
                            title="Open the note"
                            onClick={() => openNote(g.noteId)}
                          >
                            <FileGlyph size={14} className="task-note-icon" />
                            <span className="task-note-title">{g.noteTitle}</span>
                            <span className="task-note-count">{g.tasks.length}</span>
                          </button>
                        </div>
                        {!isFolded && (
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
                                    <span className="task-text">{label}</span>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </section>
                    );
                  })}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
