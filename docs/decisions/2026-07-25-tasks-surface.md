# Design: the Tasks surface

Date: 2026-07-25 · Status: **v1 implemented same day** (direction from the
2026-07-25 vault-platform decision; Zen Notes reference)

## What it is

One smart view over every open Markdown checkbox in the corpus. Markdown stays
the only truth — the surface is a per-call projection, exactly like Main and
search. No task database, no new file format, no frontmatter.

## v1 rules

- **Source**: `- [ ]` / `* [ ]` lines in the editor body of ordinary Markdown
  notes — and, since 2026-08-04, their `[/]` in-progress form (see the
  amendment below). Fenced code blocks are skipped; empty checkboxes (no text) are skipped.
  Boards, files, chats, `_index.md`, and Trash/Archive are excluded — a task in
  a sink is not a nag. A hard-wrapped checkbox reads as ONE task: indented,
  non-list continuation lines directly under the `- [ ]` join its text
  (2026-07-31 — wrapped items used to cut at the first newline). The surface
  strips inline markdown for display; the raw source text stays the toggle's
  validation contract.
- **Secure and locked notes are included.** This is the user's own local
  screen — the same rule as the sidebar showing secure titles. The surface is
  not exposed through the agent workspace (CLI/MCP) in v1, so nothing here
  changes what any model can see; if a future version exposes tasks to agents,
  secure/locked exclusion becomes part of that review.
- **Toggle is a real user edit.** Checking a task rewrites that one line
  (`[ ]` or `[/]` → `[x]`) through the ordinary note write path — same invariants as
  typing in the editor (updated bump, rename aliasing, gitignore-follow). The
  write re-validates against the exact task text first; a note edited since the
  list was built refuses with a clear message instead of flipping the wrong
  line. Unchecking happens in the note itself — v1 lists open tasks only, so a
  checked task simply leaves the list.
- **Navigation**: the group header (note glyph + title + open-task count) opens
  its note. Grouping is by note, in the corpus list order (pinned, then
  recently updated).
- **Sidebar**: a Tasks smart row beside All notes with the open-task count,
  opening the surface in the content area (the All-notes/All-chats pattern).

## Later (needs its own pass)

Completed-task view · per-area grouping · due dates or any task metadata
(would need a vocabulary decision first) · exposure through the agent
workspace with secure/locked exclusion.

## Amendment 2026-08-04 — the `[/]` in-progress mark

Direction: the maintainer, from ZenNotes v2.21 — "offer partial complete… click once for
in progress and again for complete."

A checkbox now has **three** states, not two: `[ ]` open · `[/]` in progress ·
`[x]` done. `[/]` is the convention Obsidian's task plugins and ZenNotes
already use, so a note written in one reads correctly in the other. Markdown
stays the only truth — this adds a mark to the grammar, not a field to a file.

- **Started is not finished.** `[/]` projects onto this surface alongside `[ ]`,
  counts as OPEN in the workspace metrics, and does NOT count toward a parent
  task's `2/4`. Checking one off here takes it straight to `[x]` — the Tasks
  surface is a "done with it" affordance, not a state machine.
- **Typing always works; the setting governs the click.** Settings → General →
  Checkboxes chooses between the classic two-state click (open⇄done, the
  default, and what every existing note was written under) and the three-state
  click. Writing `[/]` by hand works under either.
- **One grammar, one definition.** The checkbox pattern used to be written out
  by hand in nine places across TypeScript and Rust. Adding a third mark to
  nine independent regexes is how a grammar drifts, so the TS half now shares
  `src/editor/taskState.ts`; the Rust half (`corpus.rs` `strip_open_box` /
  `check_off`, `workspace.rs` `markdown_metrics`) is held to it by tests on
  both sides.
- **The box is found by position, never by search.** `check_off` targets the
  three characters after the list marker, so a task whose own words contain a
  bracket pair ("- [/] fix the [ ] case") has the right box flipped.

## Amendment 2026-09-18 — Tasks on the web, the regroomed surface, Archived

The owner's review: "search needs to be addressed, the width, clarity of what
is part of what note at a glance", an Archived section, and the standing rule
that whatever the app does, the web does too.

- **Tasks exists outside the Mac app.** `corpusTasks()` answered `[]` whenever
  there was no Tauri, so Rotli Web and the browser twin always showed "Nothing
  open". The projection and the check-off now also run in TypeScript:
  `src/lib/taskLines.ts` is the pure twin of `open_task_text`,
  `task_continuation`, `joined_task_text`, and `check_off`, and
  `src/services/webTasks.ts` applies it over the notes port (live notes only:
  never Archive, Trash, or chat transcripts; a changed line refuses as stale).
  Still a projection — nothing is stored.
- **Each note is a headed group.** The title is the header, its tasks hang
  under it on one rule, a chevron folds the note, and long tasks wrap instead
  of clipping. A search that matches task text keeps only the matching tasks;
  a title match keeps the note whole.
- **The search field is ours.** It was an unstyled `type="search"`, which draws
  the browser's own magnifier and clear button beside Rotli's. It is a text
  input with the searchbox role.
- **Archived.** Tasks in notes untouched for `TASK_ARCHIVE_DAYS` (30) sit in a
  closed section with a count; a search opens it. Nothing moves on disk, and
  editing the note brings its tasks back. The cutoff is Settings → General →
  Tasks (`taskArchiveAge`: two weeks, 30, 60, or 90 days, or Never; default 30),
  and the live sections clamp to it so every note lands in exactly one.
- **A task's words open the note AT that task.** `src/editor/lineJump.ts` waits
  for the note's editor, and `resolveLine.ts` checks the line against the
  task's words first — the reported line when it still matches, else the
  nearest line that does — so a note edited since the list was built never
  lands the caret somewhere arbitrary. The note's title still opens it at the
  top.
