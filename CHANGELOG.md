# Changelog

All notable changes to rotli are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Notes show by your folders, not the brain's filing** (memex integration, Phase 2 —
  shelf-projection, read side) — a note in a connected memex now appears in the sidebar
  under its `shelf:` (the folder *you* put it in), never its disk path. So a note rotli
  staged into `wiki/_inbox/` with `shelf: [Inbox]` shows under **Inbox**; one filed to
  `Myela/Payments` shows there — and you never feel it physically lives in `wiki/`. The
  `wiki/_inbox/` staging dir is hidden from the tree (it's plumbing); curated notes that
  don't carry a shelf yet keep showing under their wiki area until one is set. Frontmatter
  stays hidden (it always was).
- **Edit memex notes in place** (memex integration, Phase 2 — editability) — a shelf-projected
  memex note now opens and saves like any rotli note: edits write back to its `wiki/_inbox/`
  file with the v3.5 frontmatter preserved (`owner`/`area`/`summary`/`tags`/`links`/`shelf`/
  `reach` ride through untouched) and `updated:` bumped to a `YYYY-MM-DD` date (memex notes
  stay date-shaped; local notes keep rotli's timestamp). Memex date stamps are now honored
  for sort order too.
- **New notes default into your memex** (memex integration, Phase 2 — creation flip) — when a
  writable memex is connected, ⌘N and **＋ New note** create the note INTO the memex's
  `wiki/_inbox/` staging (v3.5 contract) instead of the local Inbox, and open it. An explicit
  LOCAL folder selection is always respected (never diverted); a selected shelf folder seeds
  the new note's shelf. (Quick Note still captures locally — a follow-up.) The sidebar still
  shows these under the memex's shelves nested in the Vault row; **promoting** those shelves
  to the primary top-level view (local demoted to a collapsed section) is the remaining visual
  step.
- **Write notes into your memex** (memex integration, Phase 1) — Memory now has a
  **＋ Note** button (when the connected memex is writable for rotli). It writes a
  brand-new note into the memex's `wiki/_inbox/` **staging** area following the v3.5
  note contract: a hidden frontmatter block (`id` · `owner` · `created`/`updated` ·
  `shelf` · `reach`) wraps your plain-markdown body, with the AI metadata
  (`area`/`summary`/`tags`/`links`) left blank for a later local-LLM pass to classify
  and file. The note round-trips smBrain's own `validate.ts` cleanly. This begins
  retiring the "notes always land in the local Inbox / Vault read-only" interim — the
  Vault sidebar browse stays read-only; the explicit write lives in Memory for now.
  rotli still writes **only** `chats/`, `inbox.md`, and `wiki/_inbox/` — the rest of
  the brain is refused at both the TS gate and the Rust guard. (rotli now speaks the
  memex contract band **[3.4, 3.5]**, so a `~/smBrain` whose card still reads `3.4`
  stays writable.)
- **The Vault** (multi-root corpus) — the old "Brain" destination is now **Vault**
  and points at an external memex (your `~/smBrain`), browsed in place in the
  sidebar (its `wiki/` + `chats/`, read-only) alongside your local notes. Connect
  one in Settings → Storage → "Connect a folder…". rotli never writes your notes
  into it — `chats/` is only the chat area, and new notes always land in your
  local Inbox. Folder ids gained a `root:path` scheme (local ids stay bare, so
  nothing migrates); each root gets its own file-watcher.
- **Diagrams & math in your notes** — fenced ` ```math ` (KaTeX), ` ```mermaid `,
  and ` ```jsxgraph ` (interactive plots — sine waves, unit circles, draggable
  points) now render inline in the editor. They follow your theme, show an
  **Expand** button, and reveal their raw source when you click/caret into them
  (your `.md` keeps the literal fenced source — it's a render layer, never a
  rewrite). Bad input shows a tidy error box instead of breaking the editor.
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
- **Per-section `+`** — hover any section (Inbox / Brain / Storage / a folder)
  and a `+` appears where the count was: one click drops a new folder *inside*
  that section. Plus a **collapse-all** button in the sidebar header.

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
