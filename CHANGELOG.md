# Changelog

All notable changes to rotli are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Excalidraw boards** — a board is a real `.excalidraw` file living in your
  corpus folders next to your `.md` notes (a file you own, openable in
  excalidraw.com). Boards open in a pane like a note, save to disk as you draw,
  and show in the sidebar with their own glyph. Excalidraw is code-split, so it
  loads only when you open a board.
- **A `+` menu in the sidebar** (replaces the pencil) — New note · New Excalidraw
  board · New folder.
- **Nested folders** — create a folder inside any folder (e.g. an `excalidraw`
  folder inside Inbox) from the `+` menu. The inline name commits on Enter or
  when you click away (Esc cancels).

### Changed
- **Board** and **All notes** now open as grids in the content area to the right
  of the sidebar — the sidebar no longer disappears, and there's no empty pane.
  Board stays a home for quick captures; All notes adds a search box and shows
  every note (and board) as cards. Clicking a card returns to the editor/canvas.

### Fixed
- The editor now keeps the caret above the floating format bar while you type —
  the last line pushes up instead of sliding behind the bar.
- The Quick Note hotkey (⌥Q) now controls **only** the Quick Note: closing it
  returns you to where you came from and never surfaces the main window.
- The Quick Note header is draggable again — the title is a centered button with
  draggable space on either side, so the window is easy to move.

## [0.2.2] - 2026-06-24

### Added
- Copy as you see it: copying from the beautified editor strips markdown syntax —
  no `**` around bold, links become their text, list/heading prefixes dropped.
- A **Beautified ⇄ Raw markdown** view toggle in the Aa panel — read your notes as
  live WYSIWYG or as the plain markdown source (the file is identical either way).

### Changed
- Tidier bullet / numbered lists: a tighter hanging indent and a centered marker,
  so the glyph sits next to its text instead of adrift at the far left.

## [0.2.1] - 2026-06-24

### Added
- A quiet "update available" dot on the titlebar Settings button, so a new
  release tells you it's here without a badge or a ping. The check now also
  re-runs when you summon the app and on a slow timer (still silent — no
  auto-download, no modal).

### Fixed
- Auto-update could fail to unpack (`failed to unpack ._rotli.app`): the updater
  archive is now built with `COPYFILE_DISABLE=1` so macOS doesn't add AppleDouble
  sidecar files the unpacker rejects.

## [0.2.0] - 2026-06-24

First public release — a warm, local-first menu-bar notes app, now with a memex
brain and signed auto-updates.

### Added
- **memex integration** — rotli can read/connect/initiate a memex knowledge spine
  (for the maintainer, `~/smBrain`): a read-only Memory browser over `wiki`/`self`/
  `chats`, a Chat front that writes named `chats/` conversations, ⌥C captures that
  route to the brain's `inbox.md`, and "Browse in Notes" to make a memex the corpus.
  rotli owns `chats/` + `inbox.md` and never writes the brain's memory.
- **CodeMirror 6 editor** — inline WYSIWYG markdown (syntax hidden, revealed on the
  caret line), live preview, focus mode, and a fully rebindable keymap.
- **Signed in-app auto-update** — a quiet on-launch check + a manual "Check for
  updates / Install & relaunch" in Settings → General (no auto-download, no nags).
- The menu-bar shell — ⌥Space toggle, ⌥C one-breath capture, ⌥Q Quick Note, the
  Board, onboarding, and a local-file corpus (atomic writes, OS-trash deletes,
  external-edit watcher). Developer-ID signed + notarized.

### Release tooling
- `bun run build:mac`, `bun run release`, and the `bump-version` / `predmg-clean` /
  `make-latest-json` scripts.

## [0.1.0]

### Added
- memex integration (Increments 1–3): detect/connect/init a memex instance,
  the read-only Memory browser over its spine, chats/ + inbox.md write seam, and
  "Browse in Notes" to point the Notes tree at a memex.
- Editor rewritten on CodeMirror 6: inline WYSIWYG markdown (syntax hidden,
  revealed on the caret line), live preview, focus mode, and the shared keymap.
- Onboarding flow, the Board surface, and the Quick Note window (⌥Q) with the
  ⌘P quick-note picker.
- The menu-bar shell: ⌥Space main toggle, ⌥C one-breath capture, the local-file
  corpus (atomic writes, OS-trash deletes, an external-edit watcher), and a
  fully rebindable hotkey engine.
