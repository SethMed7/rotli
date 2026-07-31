# Design: the Tasks surface

Date: 2026-07-25 · Status: **v1 implemented same day** (direction from the
2026-07-25 vault-platform decision; Zen Notes reference)

## What it is

One smart view over every open Markdown checkbox in the corpus. Markdown stays
the only truth — the surface is a per-call projection, exactly like Main and
search. No task database, no new file format, no frontmatter.

## v1 rules

- **Source**: `- [ ]` / `* [ ]` lines in the editor body of ordinary Markdown
  notes. Fenced code blocks are skipped; empty checkboxes (no text) are skipped.
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
  (`[ ]` → `[x]`) through the ordinary note write path — same invariants as
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
