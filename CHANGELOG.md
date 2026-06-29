# Changelog

All notable changes to rotli are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Pre-1.0:** every `0.x` release is **beta / dev work**. `1.0.0` is reserved for the first
> public launch — `scripts/release.sh` refuses to build a major ≥ 1 unless `--launch` is passed.

## [Unreleased]

## [0.8.6] — 2026-06-29

### Added
- **Secure notes.** A regex pass detects secret patterns (API/private keys, JWTs, SSNs, card
  numbers) and auto-flags a note `secure: true` — **without recording the secret**. A secure note's
  content is **never sent to a remote model** (the `corpus_read_ai` gate refuses it; a local model
  like gemma may still read it), and its file is **auto-gitignored** so a pushed vault never leaks it.
  The metadata panel shows the flag with a manual toggle.

## [0.8.5] — 2026-06-29

### Added
- **Opens maximized**, and **double-click the titlebar to zoom** — the standard macOS gesture,
  re-enabled over the manual-drag titlebar.

### Fixed
- **Block-handle gutter** no longer shows a light/white bar: the editor gutter is transparent, so the
  `+` / grip handles sit subtly in the left margin, theme-matched.

## [0.8.4] — 2026-06-29

### Added
- **Move an inline image** — drag the image itself to reposition it (it drops at the cursor line);
  resize stays on the corner grip, and a plain click still reveals the source.
- **Editable metadata** — the metadata panel's fields (shelf/reach/area/tags…) are now editable:
  type a value (Enter/blur saves), **×** removes, the bottom row **adds** a field. Reserved keys
  (id/created/updated/pinned/origin/locked) stay managed by rotli.

### Changed
- **Chat is a pane surface now.** A chat opens in a pane like a note or canvas — so **multiple
  chats** can be open at once, and a pane can hold a **chat OR a note** (note left, chat right).
  "New chat" / a chat row opens a chat pane; "All chats" expands the sidebar list; tabs/splits/
  drag work on chats for free.

### Fixed
- **Chat UI rebuilt.** Role labels (you · rotli), assistant replies render as **markdown**
  (bold/italic/code/links + fenced code blocks), a centered empty state, and a **multi-line
  composer** (⏎ send · ⇧⏎ newline). User-right / AI-left bubbles, the model selector intact.

## [0.8.3] — 2026-06-29

### Added
- **Milkdown-style block handles** — each block's left-gutter handle is now a **`+`** (add a
  block below) and a real **6-dot grip** (drag to reorder · click for actions), replacing the
  lone `⠿` that font-fell-back to a thin white bar.
- **Real file-type logos** — the sidebar, surfaces, palette, and tabs show the actual
  **monochrome** format mark per file: the **Excalidraw** logo for canvases, the **SVG** logo,
  the **PDF** (Acrobat) mark, and an IDE-standard picture glyph for raster images
  (`currentColor`, theme-aware; logo paths from simple-icons, CC0).
- **Board → Captures.** The quick-captures view is renamed **Captures**; its cards are now
  sticky notes (softly raised, lift on hover) that you can **drag to reorder** — the order
  persists in `.rotli/settings.json`, never in your notes.
- **`svg` code blocks render inline** — a ` ```svg ` fenced block shows the vector; click it to edit
  the source (the code ⇄ preview toggle), joining the existing math/mermaid/jsxgraph block renderers.
- **Inline images.** Drag an image from Finder onto the editor → it imports into `storage/` and
  drops in at your cursor as a clean `![](storage:…)` link, rendered inline via the asset protocol.
  Drag the corner to **resize** (width stored Obsidian-style, `![alt|420](…)`); click the image to
  edit the source. Images dropped outside the editor still land in Storage. (Enables the
  `protocol-asset` Tauri feature + a scoped `corpus_abs` resolver.)
- **Metadata panel + AI lock.** A button right of `Aa` opens a panel showing the note's frontmatter
  (id/created/updated + the AI-filled shelf/area/tags…) with a **lock** toggle — locking writes a
  `locked: true` frontmatter line the eventual AI filer must respect ("don't touch this note"). The
  line round-trips losslessly; the editor never sees it.

## [0.8.2] — 2026-06-28

### Added
- **"Use as notes folder"** on a connected brain — promote it to BE your notes folder, so a separate plain
  `~/Documents/rotli` no longer lingers alongside it (the same folder can't be both corpus and brain).
- **Non-note files surface in Storage.** The walker only emitted `.md` + `.excalidraw`, so the Storage
  folder looked empty; images/PDFs/any file now surface as a read-only `file` kind that opens in the OS
  default app (kept out of All-Notes/Recent/Palette — they're assets). Will evolve to route dropped
  binaries into the memex `storage/` per the model.

### Changed
- **"brain" → "linked library"** in Settings → Location: a connected memex is now a **"linked library"** (a
  second memex you reference, tucked away) — freeing "brain" to mean your own AI-organized areas inside
  Notes (per `docs/model.md`). A rotli-created memex now scaffolds the gitignored `storage/`.
- **Removed the orphaned Memory front** (dead code — nothing opened it); the brain is browsed via the
  Vault tree. Memory is how things are *saved*, not a front.
- **Storage shows the memex `storage/`.** On a memex corpus the Storage front now surfaces the binary
  asset store read-only (opened in the OS default app), projected to the Storage destination — it was
  hidden before.
- **Drop a file to import it.** Dragging a file from Finder onto the window copies it into the corpus's
  binary area (the memex `storage/`, or local `Storage/` for a plain corpus) — collision-safe — where it
  shows in Storage and opens in the OS default app.

### Docs
- **Locked the rotli model + vocabulary** (`docs/model.md`) and realigned the always-injected `.carl`
  rules: three fronts (Inbox · Chat · Notes); "your notes folder is a memex"; **"brain" = your AI-organized
  areas inside Notes** (not a connected memex); a second memex is a "linked library"; Storage = the memex
  `storage/`; access is metadata. Fixed a dead `smbrain-integration` pointer injecting a 404 every session.
  `self/`→`identity/`+`personality/` wording; "Settings → Memory"→"Location"; superseded banners on
  `roadmap.html` + the v3.5 proposal + the rearchitecture doc.

## [0.8.1] — 2026-06-27

### Added
- **Onboarding picks where your brain lives.** The first-run **Your brain** step now lets you **Use** a
  memex detected on this Mac, **Create a new brain…** (choose a folder — rotli scaffolds a fresh v3.6 memex
  there and makes it your corpus), or keep **just simple notes** in `~/Documents/rotli`. Whichever you pick,
  your one folder *is* your brain (or a plain notes folder if you defer). New Rust `corpus_init_memex`
  scaffolds the v3.6 spine + a fresh `mx_` `memex.json`; the choice commits once after onboarding, with the
  `onboarded` flag flushed to disk before the relaunch so first-run can't loop.

## [0.8.0] — 2026-06-27

### Changed
- **One folder = your brain: the corpus.json unification.** Replaced four separate location
  mechanisms (`corpus-root.txt`, `corpus-memex-root.txt`, `corpus-roots.json`, `memex-instances.json`)
  with a single `corpus.json` — the notes corpus IS a memex by default (its folder is your brain), plus
  connected read-only **brains** and added **folders**. The active write target is the corpus when it's
  a memex, else the active connected brain. A one-time migration preserves existing installs (and dedupes
  a brain that was double-registered as both a vault root and an instance — notes load byte-identically).
- **The Location pane is one folder.** Collapsed to a single **"Choose folder…"** smart picker (a memex →
  use it as your brain · an empty folder → move your notes there · any folder → use as-is) + **Your brain**
  + **Other brains** / **Connect a brain…**. The four separate folder pickers, the "rotli sync" card, and
  the Quick-capture toggle are gone — quick capture has one fixed home (the active brain's `inbox.md`,
  falling back to the Board only when there's no writable brain).
- **Memex contract bumped to 3.6** (numeric band `[3.4, 3.6]`), matching memex-vault's `STRUCTURE.md`.

### Fixed
- First-run onboarding can't loop (the `onboarded` flag is flushed to disk before the connect-brain
  relaunch); a note created into a memex corpus opens correctly (wire-id prefix derived from the active
  root); choosing/connecting an already-registered folder can't open the same directory twice; "Check the
  brain" results show on the right card; a folder with only `.DS_Store` counts as empty; brain perms are
  validated; a corrupt `corpus.json` is preserved as `.bak` instead of silently re-migrated.

### Docs
- Reconciled the always-injected CARL contract rule (v3.6 · `identity/`+`personality/` · the corpus.json
  model) and bannered the superseded design docs (`memex-rules-first-pass.md` write boundary,
  `next-stages.md` Track 2).

## [0.7.2] — 2026-06-27

### Changed
- **Settings simplified: Storage + Memory → one "Location" tab.** The two overlapping settings sections
  collapsed into a single **Location** pane (the nav is now General · Hotkeys · Appearance · Location ·
  Plugins), organized around the idea that your notes folder *is* — or can become — a **brain** (a memex):
  **Your notes folder** (storage medium · path · Reveal/Move) → **Your brain** (detect / connect / start a
  memex, per-instance perms, Browse in Notes, Check the brain) → **The Vault** (browse a brain alongside,
  read-only) → **Quick capture**. Pure UI re-composition — every control is preserved, with no data-layer
  or Rust change. First step toward "your corpus is a memex"; the onboarding folder-pick and the underlying
  root-model unification come next.

## [0.7.1] — 2026-06-27

### Fixed
- **Block handles actually drag now.** The handle used HTML5 drag-and-drop, which the macOS WKWebView
  swallows — and a `draggable` element steals the click, so neither the drag nor the menu fired in the
  app. Rewrote the interaction with **mouse events**: drag the ⠿ to reorder (with a drop line), or click
  it for the menu. Both verified.

### Added
- **Tables are beautified.** GFM markdown tables now render as real tables in the editor (bordered cells,
  bold header, column alignment from the `:---:` row, zebra rows). Put the caret inside and it reveals the
  raw markdown to edit — same live-preview model as fenced code. The `.md` is untouched.

## [0.7.0] — 2026-06-27

Two new features — block editing + external folders — plus the small-icon polish.

### Added
- **Block handles (Milkdown-style)** — a toggle in the **Aa** panel (Blocks: Off / Handles). Turn it on
  and every block gets a **⠿ handle** in the gutter: **drag it to reorder** the block, or **click it** for
  a menu — **Add below · Move up · Move down · Delete**. The `.md` stays the source of truth (every action
  is a plain text edit); off by default. Also reachable from ⌘K ("Toggle block handles").
- **Add external folders** — point rotli at any folder (e.g. a work folder) without moving it into your
  memex. The sidebar's Notes section gains an **"Add a folder…"** row (and a **Folders** group for the ones
  you've added); the folder opens **read-write in place** so you browse + edit its markdown notes through
  rotli. The files are never copied or touched; a hover **×** forgets the binding (two-click confirm).
  rotli stays a notes app, not an IDE — only your markdown notes surface.

### Changed
- **Titlebar identity** — just the quokka mark now, **centered** in the bar (no "rotli" wordmark).
- **Bolder small icons** — the menu-bar tray + titlebar quokka thicken only the **body outline** (eyes/
  mouth stay crisp) so they read clearly at chrome size; the full-size art is unchanged.
- **Memex contract band → [3.4, 3.6]** — stays writable against the upgraded memex (`self/` split into
  `identity/` + `personality/` + the org layer); rotli's own write surfaces are unchanged.

## [0.6.3] — 2026-06-26

### Changed
- **Bolder quokka lines** — the line-art quokka (logo, characters, icons) now draws with a thicker
  stroke, so it reads with more presence at every size.
- **Refreshed app/dock icon** — regenerated the full icon set (and the menu-bar mark) from the
  thicker-lined quokka, so the Dock icon has real weight.

## [0.6.2] — 2026-06-26

### Added
- **Quokka accents in Settings** — each Settings section (General · Hotkeys · Appearance · Storage ·
  Memory · Plugins) now carries a small, muted line-art quokka at the top-right of its heading,
  matched to the section (Memory → the knowledge quokka, Storage → the stays-local quokka, …). Like
  the rest of the character set, the accent tints with the theme and stays a quiet flourish.

## [0.6.1] — 2026-06-26

New brand: the line-art quokka. A warm, hand-drawn identity replaces the AI-generated art.

### Changed
- **New app icon** — the quokka logo on a **linen** tile with **black lines** (clean and legible at every
  size). Regenerated the full macOS/iOS/Android icon set from it.
- **New menu-bar icon** — the quokka as a macOS **template** icon, so it tints to the menu bar
  automatically (black on light bars, white on dark) — the shape stays constant, the line color follows.
- **New in-app logo** — the titlebar identity is the quokka mark + **rotli** set in **Baloo 2**, the rounded
  wordmark face that pairs with the line-art character (self-hosted; Fontshare, commercial-OK).
- **Quokka characters in the quokka-world surfaces** — the empty state, the Chat connect state, and
  onboarding now show the hand-drawn **line-art quokka** characters (notes · chat · inbox · board ·
  knowledge · local · base). Each is a single-path SVG that **tints with the theme** (the line color
  follows the active theme; the shape never changes).

### Removed
- The old **AI-generated quokka image** (`assets/world/quokka-master.jpg`) — replaced by the line-art set.

## [0.6.0] — 2026-06-26

The left menu becomes the navigator — three sections, no more top dropdown (IA rework, Increment 1).

### Added
- **Three top-level left-menu sections: Inbox · Chat · Notes.** The titlebar module dropdown is
  retired — the sidebar IS the navigation now. Each section is a collapsible accordion (state
  persists):
  - **Inbox = email** — a clear placeholder of the intended structure (an **All** row + an
    account accordion: `maintainer@example.com`, `hello@sethmedina.com`, …, thread sub-accordion
    later). The mail integration is a later increment; **rotli writes nothing** for it.
  - **Chat** — a ChatGPT-style section over your memex `chats/`: **+ New chat**, a searchable
    **All chats**, and your recent **history** (a limited view; "All chats" opens the full search).
    Clicking a chat opens it in the content area beside the sidebar — Chat is no longer a
    full-surface front reached from a dropdown.
  - **Notes** — the corpus, unchanged: **All notes · Board · Recent**, then the local destinations,
    the Vault/Knowledge folders, and nested folders. (Memory isn't a section — it's simply your
    Vault.)
- **Pick the chat model from your memex AI.** The Chat surface has a **model selector** that reads
  the shared on-device store (`~/.memex/ai/registry.json`) and lists every chat-capable model it
  declares (Gemma via MLX, the llama.cpp backup, …), defaulting to the store's default. The bridge
  now speaks **both** wire shapes — Ollama `/api/generate` (MLX) and OpenAI `/v1/chat/completions`
  (llama.cpp) — so the picked model actually runs. The choice persists.

### Changed
- **"Inbox" now means email; the note-capture concept is "Capture."** The local capture destination
  (and the ⌥C one-breath capture) is **labeled Capture** so the word "Inbox" is free for mail. The
  on-disk name and the memex contract are **unchanged** (`inbox.md` keeps its name; rotli still writes
  only `chats/`, `inbox.md`, `wiki/_inbox/`).
- The titlebar identity is now a plain **rotli** home wordmark (click → back to the note panes).

*(Increment 1 is the structural left-menu rework only. Streaming chat, `@note`/`@board`/`@email`
context, the chat-owns-a-summary-note model, Breve `history/` rendered in Chat, and the real email
integration are later increments. Plan: `docs/notes-chat-inbox-rearchitecture.md`.)*

## [0.5.0] — 2026-06-26

The Chat front begins — a real on-device chat (Increment 1).

### Added
- **Chat actually talks now.** The Chat front (module switcher → **Chat**) is a real conversation:
  type a message and the **on-device model replies** — the same local MLX/Gemma server Breve uses,
  bridged through **Rust** (the webview's CSP can't reach `localhost`, so a `chat_complete` command
  POSTs the model). Messages render as **bubbles**; the thread **persists as `chats/<slug>.md`** in
  your memex (rotli's owned surface, v3.5 contract) and reloads from there. The left list is your
  **history**. Needs your local model running on `:11435`; if it's not, the chat says so in-line.
  *(Increment 1 — one-shot replies, no streaming yet. Next: streaming · `@note`/`@board`/`@email`
  context · the chat-owns-a-summary-note model · Breve `history/` rendered in this surface · the
  3-section left menu. Plan: `docs/notes-chat-inbox-rearchitecture.md`.)*

## [0.4.3] — 2026-06-26

### Added
- **Rename a board from its tab, too** — double-click a board's tab to rename it inline (joins the
  sidebar right-click rename from 0.4.2; both share one flow). And **⌘⇧N makes a new board** (⌘N stays
  new-note), opening it straight into its name field.
- **Board metadata for the AI** — each board now carries a **description + tags** via a small **ⓘ**
  button (bottom-right of a board). A board is just an image to a text LLM, so this is how it'll know
  what a board is about and pull it into a chat as `@board` context later. Stored top-level in the
  `.excalidraw` file (not Excalidraw's appState, which it strips) and preserved across drawing edits.
  *(Wiring it into rotli's own ⌘K search arrives with the Chat front.)*

## [0.4.2] — 2026-06-26

### Added
- **Name and rename your boards.** A new board's sidebar row opens an inline name field
  the moment you create it (name it first, no more "untitled"), and **right-click any board
  → rename** in place (Enter commits, Esc / click-away cancels). The `.excalidraw` file is
  renamed on disk and any open canvas tab follows the new name. (New `corpus_rename_board`,
  unit-tested.) *(Renaming via the tab, a dedicated new-board chord, and board metadata for
  AI search are the next step.)*

### Fixed
- **The sidebar's right-click no longer pops the webview's "Reload" menu** — it's suppressed
  in the sidebar so rotli's own row actions take over (the editor keeps its native menu for
  spell-check / copy).
- **The Vault repopulates after the memex move** (0.4.1's self-heal) — if your Vault still
  reads empty, Settings → Storage → Connect a folder → `~/memex-vault`.

## [0.4.1] — 2026-06-26

### Fixed
- **The Vault no longer goes empty after the memex move** — an installed app had its Vault
  bound to the now-gone `~/smBrain`; that dead binding was dropped without rebinding, so the
  Vault showed nothing. It now **self-heals** to `~/memex-vault` (a vanished bound path
  re-auto-binds to the default memex; an existing-but-non-memex folder is still left alone).
- **The note header status is back at the top-right** — centering the header had stranded the
  `chars · updated · On this Mac · Aa` cluster mid-pane with a gap. The header is full-width
  again (date left, status right); the body column stays centered.

### Changed
- **Notes use a bit more width by default** (comfort measure 720→820px) so a note fills more
  of a wide screen.
- **Recent reads as a clean table** — hairline row separators + roomier rows + clearer
  title/snippet/date columns.
- **New Excalidraw boards open in your color theme** (dark or light), instead of always-light.

## [0.4.0] — 2026-06-26

The memex-vault + polish release — the connected brain is renamed `memex-vault` (with an
internal `storage/`), and a round of UI fixes: centered notes, a dated Recent list, the
Vault's `wiki` reframed as "Knowledge", Settings-on-General, and two interaction bugs
(the Quick Note hotkey, and a board tab trapping note-clicks) put right.

### Fixed
- **A note no longer hugs the left on a wide screen** — the writing column is centered and
  a touch wider (comfort measure 660→720px, default size 14.5→15px), so a note fills more of
  a big display instead of stranding dead space on the right. The date/status header aligns
  to the centered column.
- **Opening a note while a board was open is no longer a dead click** — replacing a canvas
  (Excalidraw) tab kept `surfaceKind:"canvas"`, so the pane stayed stuck on the board and
  every sidebar note-click did nothing (and a note could look blank). `openNote` now swaps to
  a clean note tab. (Fixes the "stuck on the board / blank note" reports.)
- **The Quick Note hotkey only controls the Quick Note** — closing it (its chord / Esc) no
  longer surfaces the main window; if you came from another app it steps out cleanly instead.

### Changed
- **Settings opens on General** (was Hotkeys).
- **Recent is a dated list** — every note ordered by most-recently-touched, shown as rows
  with the date on the right (title · snippet · date), in the content area.
- **The memex `wiki` reads as "Knowledge"** in the Vault, with a plain-language note (on hover)
  that it's AI-organized for retrieval; the `_templates`/`_inbox` plumbing folders are hidden
  from the tree. (A toggle to *reveal* the AI metadata on a note is still to come — it's
  stripped at the read layer today.)
- **The connected memex is now `memex-vault`** (was `smBrain`). The maintainer's brain
  moved to `~/memex-vault` (repo `SethMed7/memex-vault`) to read as what it is — a private
  instance of the open-source **memex** structure. rotli's auto-bind default and all
  references follow it; the `vault:` root scheme and the **Vault** UI label are unchanged.
  A memex's binaries now live in an internal, gitignored `storage/` (the `storage:` root),
  so a connected memex is one self-contained folder. (No corpus migration — rotli keys the
  Vault by root *name*, not path; re-point it in Settings → Storage if you'd bound the old
  path, or rebuild so the new `~/memex-vault` default auto-binds.)

## [0.3.0] — 2026-06-25

The memex release — rotli now reads, writes, edits, and creates notes inside a connected
memex (your `~/memex-vault`) per the v3.5 note contract, plus the Vault, Excalidraw boards,
nested folders, and inline diagrams/math from the increments since 0.2.2.

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
  and file. The note round-trips memex-vault's own `validate.ts` cleanly. This begins
  retiring the "notes always land in the local Inbox / Vault read-only" interim — the
  Vault sidebar browse stays read-only; the explicit write lives in Memory for now.
  rotli still writes **only** `chats/`, `inbox.md`, and `wiki/_inbox/` — the rest of
  the brain is refused at both the TS gate and the Rust guard. (rotli now speaks the
  memex contract band **[3.4, 3.5]**, so a `~/memex-vault` whose card still reads `3.4`
  stays writable.)
- **The Vault** (multi-root corpus) — the old "Brain" destination is now **Vault**
  and points at an external memex (your `~/memex-vault`), browsed in place in the
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
  (for the maintainer, `~/memex-vault`): a read-only Memory browser over `wiki`/`self`/
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
