# Changelog

All notable changes to rotli are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Pre-1.0:** every `0.x` release is **beta / dev work**. `1.0.0` is reserved for the first
> public launch — `scripts/release.sh` refuses to build a major ≥ 1 unless `--launch` is passed.

## [Unreleased]

### Added

- **Development builds are unmistakable and consolidated.** The native development
  command launches as **rotli (dev)** and always uses the accent-backed app icon,
  runs first-run onboarding independently, and explicitly mounts the production
  vault for real read/write testing. Production keeps its existing identity;
  raw `tauri dev` retains the read-only safety default.
- **Chat now keeps its working files beside the conversation.** A contextual
  Work rail lists attached images and generated chat assets; selecting one
  opens the user-owned file in a new pane to the right, while the rail collapses
  to a quiet launcher. Picked images are copied into the memex and remain
  recoverable through portable `storage:` references in the chat Markdown.
- **Chat can create files the user owns and keeps editing.** Models can create
  Markdown notes, DOCX documents, XLSX sheets, Excalidraw boards, and images
  through Rotli's existing editors and lifecycle. PDF requests produce a local
  exported copy plus a separate editable Markdown source. Created items are
  linked into Chat Work deterministically and can be opened to the right or
  brought back into the composer with **Use in chat**.
- **A chat keeps one primary provider without closing off a second opinion.**
  After a chat is saved, its model picker stays within that provider (for
  example, Claude Opus to Sonnet). An explicit `@Claude`, `@GPT`, or `@Gemini`
  mention can consult another configured provider for one attributed turn
  without changing the chat's primary provider.

## [0.80.0] - 2026-08-08

### Added

- **Quick Note and Quick capture can target separate vaults.** General settings
  now offers an independent destination for each global capture entry point,
  while preserving Quick Note's current local-folder option. Explicit vault
  choices require write access and never silently fall back to another vault.
- **The Librarian now explains its filing system where you use it.** Its
  re-openable guide maps intake, Library folders, reference-only views,
  Archive, Trash, assets, and chats; it also explains the one-file rationale
  and links directly to Librarian and Security settings.
- **Long notes now have a quick way home.** A compact arrow appears at the
  bottom-right after scrolling and returns the Markdown pane to the top.

### Changed

- **Chat now explains when a Notes view is filtering it.** The Chat sidebar
  names the inherited view and offers one click back to Main and all chats;
  clicking its existing All chats row now clears the view too.
- **Raw vaults no longer strand every new note in Librarian intake.** When the
  Librarian is off, new ordinary notes land directly in the vault's `wiki/`
  note lane. Existing files are not moved; secure notes keep their protected
  home and the rest of the vault structure is unchanged.
- **Chat model icons now scan at one size.** Gemma and OpenAI marks are
  optically normalized to the same compact sidebar footprint as Claude,
  Gemini, and Qwen, with a design-system guard covering future additions.
- **Background tree saves now feel immediate.** The Main/named-view header no
  longer flashes `Saving…` or `Saved` after ordinary organization; failures
  still surface inline instead of disappearing.
- **Held-Command hints now read cleanly on the active control.** Home, Chat,
  and New chat show complete Command-inclusive chords that can be pressed
  directly while the overlay is open; active hints no longer disappear into
  an accent-on-accent block.
- **The onboarding character now lives on the page, not inside a card.** Each
  setup state brings it in with one brief gesture that respects reduced motion.
- **Showing file metadata now reveals it immediately.** Turning metadata on
  returns the focused Markdown pane to the banner at the top of the note.

### Fixed

- **Saved chats stay visible in the Chat sidebar.** Selecting an empty or
  legacy named view no longer turns a non-empty chat list into a blank menu;
  views with assigned chats still narrow normally.
- **Boards can be archived or trashed again.** Their menus no longer mislabel
  them as read-only files, and items in the System browser can be dragged onto
  the Trash row using the same guarded lifecycle as `⌘Delete`.
- **Double-clicking a photo keeps it rendered.** The second click now preserves
  the selected image instead of exposing its Markdown source.

## [0.79.0] - 2026-08-07

### Added

- **Choose where globe-enabled web research goes.** DuckDuckGo remains the free,
  no-account default; Brave Search API is now an optional bring-your-own-key
  provider whose credential stays in the macOS Keychain. The new Connections
  settings section names the direct network destination and never reveals a
  saved key.
- **Local answers now read evidence before making current claims.** A bounded
  research tool searches once, reads the top public pages, supplies numbered
  sources, and validates citations. Missing, conflicting, malicious, or
  unavailable evidence now steers the model toward uncertainty instead of a
  confident answer from memory.
- **First run now feels like part of the app.** The character accompanies every
  setup screen with short state-based motion, numbered choices keep their number
  beside the label, arrow keys select cards, and the live `⌘Enter` shortcut sits
  inside the Continue button it activates.
- **Bring an existing Markdown vault.** rotli inventories Obsidian, ZenNotes,
  and ordinary Markdown folders without writing, then offers opening in place or
  importing into an empty destination. Nested folders seed one Main reference
  tree; note content is neither copied into a database nor rewritten.

### Changed

- **Local web research now follows an evidence-first reasoning order.** Gemma
  carries a bounded private checkpoint from source inventory through exact fact
  extraction, reconciliation, citation mapping, and answer-or-abstain. Citation
  cleanup and date/time/timezone pairing checks catch unsupported combinations
  without adding an unconditional model call. Explicit source routing keeps
  unanchored public specifications, trials, transactions, benchmarks, and
  missions out of personal-note search. If a weak local model still chooses a
  note search for an unmistakably public question, Rotli corrects it locally
  without executing the note search or automatically sending a web request.
- **Web-search failures are no longer disguised as empty results.** DuckDuckGo
  now distinguishes no results, connection/timeout/HTTP failures, challenges,
  and changed markup; Brave distinguishes missing or rejected keys, quota/rate
  limits, network failures, and malformed responses. Rotli never silently
  retries through a different provider.
- **Skipping setup no longer chooses a notes location.** It applies the calm
  Paper/Charcoal system defaults and continues to an explicit Create or Open
  Vault screen. Fresh installs no longer silently create `~/Documents/rotli`.

### Fixed

- **New items stay in the Main folder you chose.** Clicking or keyboard-opening
  a Main folder now makes it the creation target, so choosing an Excalidraw
  board (or another item type) no longer drops the new item at Main's root.
- **Boards created in a named-view folder stay in that view.** The new-item
  chooser now retains the active view and its selected folder while preserving
  the board's global Main reference.
- **Excalidraw boards are named before they exist.** Creating a board from the
  chooser, menu, or hotkey now asks for a name first and writes the final,
  collision-safe filename directly instead of creating an untitled placeholder.
- **Held-Command hints now cover tabs and metadata.** Tabs show their real
  `⌘1`–`⌘9` targets in the shortcut overlay, and `⌘⇧M` toggles the focused
  note's file metadata through the shared, rebindable action registry.
- **Dropped photos land where you point.** Markdown now captures the exact drop
  position before importing a photo, so import time, scrolling, or a moved
  caret cannot redirect the image link elsewhere in the note.
- **Photos stay inside Markdown lists.** Dropping a photo onto an empty bullet,
  numbered item, or task now fills that list item instead of leaving a blank
  marker and inserting the image outside the list.
- **Slash commands work inside Markdown lists.** Type `/` after a bullet,
  number, or task marker to open the usual command menu. The marker stays put,
  and multiline inserts remain indented inside that item.
- **Selecting a whole note keeps its photos visible.** Select All and other
  selections that fully cover an image now leave the rendered photo selected
  instead of replacing it with raw Markdown text.
- **Arrow keys select photos instead of exposing image syntax.** Moving into a
  rendered standalone or list photo now outlines it as an object, matching a
  click, while an existing caret in image source remains editable.

## [0.78.0] - 2026-08-06

### Added

- **A window you have put away stops animating.** rotli lives in the menu bar,
  so its window spends most of its life out of sight; every animation now parks
  itself while the window is hidden and resumes when you come back. The relative
  "updated" time in the editor stops ticking too, and refreshes the moment the
  window returns — fresher on sight than before.
- **The website is ready for search and link previews.** Its production build
  now publishes canonical and Open Graph metadata, a sitemap, robots guidance,
  and a useful not-found page.

### Changed

- **Chat rows now show the model's real mark.** OpenAI, Claude, Gemini, Gemma,
  and Qwen use their recognizable artwork instead of invented letter badges;
  unknown local models and hybrid presets retain honest text fallbacks.
- **The website download button cannot get ahead of a release.** It now opens
  the latest signed release that actually exists instead of constructing a DMG
  URL from a version that might not have been published yet.
- **Upgraded the interface engine to React 19.** No behavior changes — this
  keeps rotli on a supported release line so future editor and board work is not
  blocked. The React Compiler stays off.

## [0.77.0] - 2026-08-05


### Changed

- **A chat row shows its model, not a chat icon.** Every row in Chat was wearing
  a little speech bubble that told you what you already knew. That slot now
  carries a small vendor mark for the model answering — so you can see at a
  glance which chats are on Claude, GPT, Gemini, or your own Mac.

### Fixed

- **One highlight per open chat.** A chat that was working (or unread) appeared
  twice — once in the lane at the top, once in its real place — and *both* copies
  lit up as selected. The lanes are notifications, not locations, so only the
  row in the chat's real home is highlighted now.

## [0.76.0] - 2026-08-04


### Added

- **Have replies read aloud.** Turn on **Settings → AI → Voice** and every answer
  gets a speaker button; press it again to stop. The voice runs entirely on your
  Mac — nothing is sent anywhere — and it's prepared the first time you use it,
  so nothing is downloaded unless you ask for it. Long answers start speaking
  right away instead of waiting for the whole reply, and code blocks are skipped
  rather than read out character by character. Seven voices to choose from.
- **Fold a section down to its heading.** Press ⌥⌘K anywhere inside a section
  and it collapses to its title, leaving a small `⋯` you can click to bring it
  back — so a long note can be read as an outline. Folding a heading takes its
  sub-sections with it and stops cleanly at the next heading of the same level,
  and the fold survives switching between the beautified and raw views.
- **`####` and deeper are headings now.** Markdown allows six levels; rotli only
  recognized three, so a fourth-level heading rendered as a plain paragraph.
  All six are recognized and styled (deeper levels read as quiet emphasis rather
  than shrinking away).
- **A parent task shows how far its subtasks have got.** Indent checkboxes under
  another one and the parent picks up a quiet `2/4` — turning green when they're
  all done. It counts only the boxes directly beneath it, so the number always
  matches what you can see, and **it is never written into your file**: your
  markdown stays exactly what you typed.
- **A task can be in progress, not just done or not.** Write `- [/]` and rotli
  draws the box half-filled — started work stops looking identical to work you
  haven't touched. It still shows on the Tasks surface, because started isn't
  finished. In Settings → General → Checkboxes you can make a *click* walk
  through it too: once for in progress, again for done. Typing `[/]` yourself
  works either way.

## [0.75.0] - 2026-08-04

### Fixed

- **Dropping an image on a chat attaches it.** It used to land in your vault and
  never reach the chat. Dropped images now attach to the chat under the cursor —
  and they're saved into your assets on the way in, so they stay referenceable
  instead of vanishing when the message is sent.
- **You can send an image with no words.** "What is this?" needed typed text
  before the send button would do anything.

### Added

- **Every connected model can see your images** — Claude, GPT and Gemini alike.
  Each one gets there differently under the hood, and the extra access each
  needs is granted **only for a message that actually carries an image**: an
  ordinary text conversation keeps exactly the locked-down setup it always had.
  Whether a local model can see images stays a property of that model, read from
  your AI store — so a text-only local model is never asked to look at something
  it can't.
- **An attached image is part of the message.** Each attachment shows a numbered
  preview above the composer and appears in the sent message as `[Image #1]`, so
  you can talk about it afterwards — "what's in image 2?" — and the conversation
  keeps a record that it was there.
- **See what a Breve routine actually does.** Each routine now has a **Workflow**
  toggle that lays out the real pipeline it runs — the schedule and its
  head-start, the sandbox, the model and its self-heal fallback, the render,
  audio and preview steps, the hold until delivery time, and every delivery lane.
  Lanes you've switched off still appear, greyed, so you can see what *isn't*
  running as easily as what is. It's read-only in this pass and derived from the
  real scripts rather than stored, so nothing about your routines changed.

## [0.74.0] - 2026-08-04

### Fixed

- **You can see which chat is working, at the top of the list.** A chat that's
  answering now floats into a **Working** lane above everything — folders
  included — so you never hunt for it. The working dot was also invisible on
  the chat you were actually looking at: a selected row fills with the accent
  color, and the dot was that same color. It now flips to the contrasting ink,
  like every other marker on a selected row.

- **Boards can be deleted again.** Deleting a board failed with “note not
  found”, naming a file sitting right there in your sidebar — boards are
  tracked by their file path while notes are tracked by an internal id, and the
  delete path only knew how to look up notes. Since deleting is a move to
  Trash, the same gap silently broke moving and archiving a board too. Boards
  now move as plain files — their contents are never rewritten — and restoring
  one from Trash puts it back exactly where it came from.

### Added

- **Hold ⌘ and the shortcuts appear right on the buttons.** Instead of a panel
  you have to read and translate back to the screen, each shortcut now shows as
  a small badge pinned to the control it actually drives — so you can see it and
  go straight there. How the hold behaves is yours: **Settings → Hotkeys → Hold
  ⌘** offers badges on the controls (the new default), the original grouped
  list, or nothing at all.
- **One key flips between Home and Chat** (⌃\`). ⌃1 and ⌃2 still jump straight
  to either front, and all three are rebindable like every other shortcut.

### Changed

- **A new chat opens ready to be named.** The title field takes the caret the
  moment a new chat opens, so you can type its name straight away — ⏎ still
  skips to the message box (and your first message names the chat if you'd
  rather not). A chat opened into a split pane doesn't steal your focus.

### Added

- **Generate an image right inside a note.** Type `/` in any note and pick
  **Generate image**: choose which model draws it, describe the picture, and the
  finished image is saved into your vault and dropped into the note where you
  were typing. The model list only ever shows engines you're actually signed
  into — GPT Image through Codex, Nano Banana through Gemini — so there's
  nothing to pick that can't run. If neither is connected, it says so up front
  instead of failing partway. Generated note images live together in
  `storage/images/`; chat-generated images keep their own per-chat home as
  before.

## [0.73.0] - 2026-08-03

### Fixed

- **A sent chat appears in the sidebar instantly.** Your message is saved the
  moment you press Send — so a brand-new chat shows up in the left bar right
  away, at the top, already pulsing while it thinks, and an existing chat
  jumps to the top on send instead of on reply. Your own message is also never
  lost anymore if the model fails mid-answer. (A new chat's tab also claims
  its identity at send time, closing a race where a reply could land on the
  wrong tab.)
- **The Gemini (Antigravity) lane no longer dies on "agy returned nothing…
  auto-denied".** The cloud model occasionally reached for the CLI's own
  tools, which headless mode silently denies — aborting the whole turn. rotli
  now spawns that lane in an empty scratch directory, tells the model plainly
  it has no native tools, and when the abort signature still appears, retries
  once with a hard override. Permissions stay denied — nothing was loosened.

## [0.72.0] - 2026-08-03

### Added

- **The chat sidebar now works like a real multi-chat cockpit.** Fire off
  several chats and switch freely: a chat that's answering breathes a small
  dot on its row, a reply that lands while you're elsewhere flips it to an
  **unread** dot and collects it in a new **Unread** lane at the top — so you
  always know which chat to click. Chats order by response recency (newest
  reply on top, inside folders too), and leaving a chat no longer cancels a
  send that was waiting in line — it finishes and lights up its row.
- **Pin chat folders.** A folder's right-click menu can pin it above the rest.
- **Every chat row shows its model.** The model a chat runs on sits quietly at
  the row's right edge.
- **Views reach the chat area.** Organize chats by work vs personal: assign a
  chat to a named view from its row menu, switch views to see only that view's
  chats, and a chat started while a view is active joins it automatically.
- **Replies show real tables and diagrams.** A markdown table in an answer
  renders as an actual table, and a `mermaid` flowchart renders as the drawn
  diagram — right in the chat. The assistant is encouraged to use both (in
  replies and in the notes it writes) when they genuinely clarify.
- **The assistant can draw on a board.** Ask for a visual diagram and the model
  can turn a flowchart into a real, fully editable Excalidraw board saved with
  your boards and opened on screen. Under the hood the model writes Mermaid —
  which even small on-device models do reliably — and rotli converts it
  locally; nothing leaves the Mac, and chats carrying secure-note content
  can't put their prose on a board.

### Changed

- Reordering chats inside a folder by hand is retired — response recency now
  owns the order (pinned chats still float first). Dragging a chat onto a
  folder still files it there.

### Fixed

- **Bold text in chat replies no longer shouts.** `**bold**` in an assistant
  reply was falling to the font's heaviest cut, which read far too thick against
  a dark thread. Chat bold now uses the same semibold emphasis the rest of the
  app speaks.
- **Each vault's chats keep their own settings.** A chat's model pick, web-search
  globe, and column width were remembered by chat name alone — so two vaults
  with a same-named chat silently shared one setting. They're now remembered per
  vault, existing settings migrate automatically, and renaming a chat carries
  all three along instead of losing them. Isolation is locked in by tests on
  both the TypeScript and Rust sides: chats and notes never travel between
  vaults.

## [0.71.0] - 2026-08-03

### Fixed

- **Numbered checklists finally look like checklists.** A step written as
  `1. [ ] Generate the new key` used to show the `[ ]` as literal text — only
  dash checkboxes rendered. Numbered steps now get a real checkbox next to their
  number, clicking it checks the step off, Enter continues the list with the
  next number and an empty box, and open numbered steps show up in Tasks like
  every other checkbox.
- **Notes the Librarian has filed stay editable.** In a memex, a note the
  Librarian moved out of the intake area into its curated home (say
  `wiki/engineering/`) hit "this location is read-only" on every save — the
  editor kept your text and retried forever, but the save could never land. The
  whole `wiki/` tree is now a writable surface for your own edits: filing a note
  organizes it, it doesn't freeze it. The brain's memory lanes, control files,
  and read-only vault settings are as protected as before, and the Librarian
  still owns its metadata keys exclusively.

## [0.70.0] - 2026-08-03

### Changed

- **On-device chat answers as it thinks — words appear as they're written instead
  of all at once.** The local model used to hold its whole reply until it was
  finished, so you'd watch a spinner and then get the answer in one drop. Now the
  answer streams in as it's generated, and **Stop** ends it mid-sentence while
  keeping whatever had already arrived. Only the on-device model streams; the
  connected lanes and the background organizer are unchanged.

## [0.69.0] - 2026-08-03

### Changed

- **The app opens a touch quicker, and it stays smooth while it works.** A board's
  drawing engine no longer loads its styles at startup, so a session that never
  opens a board starts leaner; a bit of first-launch housekeeping now waits until
  after the window is on screen. On-device chat starts answering sooner — it no
  longer double-checks which notes it's allowed to read before building its map of
  your notes. And a few background chores (listing notes, searching, gathering
  tasks) moved off the main thread, so the window keeps responding while they run,
  and drag-selecting in the file browser stays smooth.

## [0.68.0] - 2026-08-03

### Changed

- **On-device chat can reach the web when it should.** Ask it something that
  needs current information — the latest on a topic, who signed a letter, what
  just shipped — and it now recognizes its notes may be out of date instead of
  answering from them as if they were current. With the globe on, it searches
  and reads the web and answers from what it found, with sources. With the globe
  off, it tells you it'd need the web and leaves turning it on to you. It reasons
  about this rather than watching for a magic word, so it also catches questions
  that don't say "latest" out loud.
- **On-device chat shows its work.** A multi-step answer now narrates what it's
  doing — "searching your notes", "reading <note>", "searching the web" — so a
  long answer feels like progress instead of a frozen pause.
- **The rotli mark stays crisp when it's small.** The quokka in the titlebar,
  tabs, and chat no longer smears into a blur at small sizes — same drawing,
  lines that hold their weight.

## [0.67.0] - 2026-08-03

### Changed

- **One highlight for "you're here."** The Home/Chat switcher's active segment
  and the current item in the Main view menu now wear the same accent highlight
  as a selected note — one active-item language across the sidebar instead of
  three near-misses.

## [0.66.0] - 2026-08-02

### Changed

- **The build toolchain reached current.** Rotli moved to Vite 8, which now
  carries its Rust bundler (Rolldown) natively — the same fast builds, minus a
  temporary alias and a deprecated plugin. Nothing about the app changes: the
  bundle ships a touch smaller and one known security advisory drops out of the
  build's dependencies.

## [0.65.0] - 2026-08-01

### Added

- **Search got fast and smart.** Finding a note no longer scans every note on
  every keystroke — Rotli now keeps a real search index, so search stays quick
  as your vault grows from hundreds of notes to thousands. It also got smarter:
  typing two words finds the notes that have both, a half-typed word matches as
  you go, a small typo still lands the note you meant, and wrapping a phrase in
  "quotes" finds those exact words in order. The index is Rotli's own private
  cache next to your notes — it's rebuilt from your Markdown whenever it's
  needed and never something you have to think about; your files stay the only
  thing that's real. Secure notes are handled exactly as before: they show up in
  your own searches and never in anything a cloud model can see.

### Changed

- **The sidebar has a Home and a Chat, and you pick one.** The stacked "Chat"
  and "Notes" sections are gone. A small two-segment switcher now sits under
  your vault name: **Home** is your notes — All notes, Captures, Tasks and the
  Main tree you arrange yourself — and **Chat** is your chats, folders and all.
  Whichever you pick gets the whole sidebar and just scrolls, so you no longer
  fold one away to see the other, and Chat no longer stops at five recent
  conversations with a "+7 more" — every chat is right there. Rotli reopens on
  the side you were last using. `⌃1` goes Home, `⌃2` goes to Chat, and New chat
  moved to `⌃⇧2`; every one of those is still yours to rebind. Opening
  something always brings the right side forward — click a note and you land in
  Home, open a chat and you land in Chat — so "show me where this is" never
  points at a panel you can't see. Settings lost its "Chats in the sidebar"
  count, which no longer had anything to limit.
- **The System area folds away.** Library, Assets, Archive and Trash now sit
  under a heading you can click shut when you want a quieter sidebar; the
  Files · Librarian · Settings row at the very bottom stays put, under both
  Home and Chat. Pressing Collapse all twice still folds everything — the
  second press now tucks the System area away instead of the old sections.
- **The build got about nine times faster.** Rotli's bundler moved to
  rolldown and its typechecker to the Go-native TypeScript compiler, so a
  production build drops from ~10.4s to ~1.2s and a full typecheck from ~3.5s
  to ~0.8s. Nothing about the app changes — the same bundle ships, slightly
  smaller — but every fix now reaches you sooner. Babel and esbuild left the
  toolchain entirely, and a new dead-weight gate keeps unused code and
  undeclared dependencies from accumulating.

### Fixed

- **Breve's mail reader and Signal listener got two real crashes removed.**
  Asking Breve to read an email by an id its mailbox no longer holds threw
  instead of saying it couldn't find it, and one path through the Signal
  message handler could trip over an attachment it assumed was there. Both
  surfaced when the runtime's untyped edges were given real types.
- **Chat no longer searches your notes for nothing.** When a local model
  phrased a tool argument as a nested object instead of plain text, the
  search ran on the literal text "[object Object]" and quietly came back
  empty. It now says what went wrong so the model can correct itself.

## [0.64.0] - 2026-08-01

### Changed

- **A dead-end search hands the model a map instead.** When the on-device
  model searches a word no note contains ("runtime"), the miss now returns
  the vault's complete area list — each with its leading note title — and
  tells the model to search the area that would hold the answer. In live
  runs the model then finds "Preferences" and answers with the truth; when
  it still can't, it says "I couldn't find that in your notes" — the
  answer-every-part-from-a-read rule now forbids a guess dressed as a fact.
- **Chat can reach your identity notes now.** The parts of a vault that hold who
  you are — `identity/`, `personality/`, your daily `history/`, `MAP.md`, and
  `inbox.md` — used to be invisible to every model, so "what do I do for work?"
  had no reachable answer. Chat can now find and read them the same careful way
  it finds anything else: search it, open the one note that matters. It is still
  retrieval, not stuffing — nothing preloads your vault. They stay out of the
  Notes sidebar, and no AI can write to them.

- **Secure and locked finally mean two different things.**
  **Secure** hides a note from cloud models — completely, no setting, no
  exception. Models running on your own Mac *can* now read secure notes by
  default, which is the point of running one: nothing it reads leaves the
  machine. Any single note can still opt out from its menu, and the whole vault
  can from Settings → Security.
  **Locked** is not about hiding. A locked note is one **no AI may edit** —
  cloud or on-device, in chat or by the Librarian. Everyone can read it; nobody
  but you can change it. The note menu and the Security pane now say exactly
  that.

- Secure notes a chat has read still can't leak sideways: a chat that has seen
  one can only write into notes that are themselves secure, and its transcript
  can never be handed to a cloud model afterwards.

## [0.63.0] - 2026-08-01

### Added

- **Panes fit, whatever the size.** A pane is a hard box now: shrink the
  window, drag a divider to the edge, stack two chats — chrome compresses
  and scrolls instead of bleeding into the pane below. Panes keep a
  usable minimum height (derived from what a chat actually needs, not a
  guess), re-fit live as the window changes, chat titles make room for
  their buttons instead of sliding under them, and empty states scale
  the quokka down before clipping the words.

- **Every chat keeps its own model.** Two chats side by side can now run two
  different models at once: the chip under the composer shows *that* chat's
  model, sends from that chat use it, and it stays with the chat across
  relaunches. Picking a model no longer reaches into every other open chat. A
  brand-new chat still starts on the last model you picked, so nothing changes
  if you only ever use one.
- **On-device chats wait their turn instead of bogging down your Mac.** Run as
  many local chats as you like — before each reply starts, rotli checks how much
  memory this Mac actually has free right now and how big that model is. If
  there's room it just goes; if there isn't, the message says *"queued — not
  enough compute headroom right now"* and waits, with a **Prioritize** button to
  run it next. Stopping or leaving a queued message takes it back out of the
  line. There's no fixed limit on how many chats you can have open — a roomy Mac
  runs several at once, a smaller one runs them one after another. Claude, Codex
  and Gemini are unaffected.

### Fixed

- **The note's chat button offers your chats again.** Clicking it lists every
  chat on the note plus "New chat" — it used to fall into the same chat every
  time because each message quietly re-pointed the chat at a freshly minted
  notes file (that's also where those duplicate "chat about …" notes came
  from; no more of those). Conversation notes now land in the note you
  chatted from, in their own managed section, instead of spawning orphans.
- **"List the people in my vault" answers with your people.** The on-device
  model used to open the `people/` README — a note that explains how the folder
  is organized and names nobody — and read its list of links out loud, so a
  *project* could end up in a list of your family. Three things changed: notes
  filed under a folder you name ("people", "projects") now turn up in the
  model's search instead of only notes that spell that word out; the area's
  generated index — the note that actually lists everyone — is marked as such
  and offered first; and a note's `links:` line is labelled as pointers, not an
  answer. Asked for a roster, rotli now reads the roster.

- **The model picker opens fully in a split.** In a stacked layout the list
  used to open upward past the top of the window and come back clipped — a menu
  starting mid-air over the conversation. It now measures the room its chip
  actually has, flips below when there's more space there, and scrolls inside
  itself instead of running off-screen.
- **Tab indents the line again.** Pressing Tab on a line that wasn't already a
  list item pushed two invisible spaces in at the cursor instead of moving the
  line, so writing the text first and then reaching for Tab left the line where
  it was — and a `-` typed next stranded at the end (`test  -`, rendered
  literally, no bullet). Tab now shifts the whole line one level, cursor and
  all, exactly like Shift-Tab has always brought it back. Tab inside a fenced
  code block still types a soft tab at the cursor, and Tab with text selected
  indents the line instead of replacing what you selected.

### Changed

- **Nested bullets read as a clean ladder.** Each level now shifts the whole
  item by one even step, and the bullet, number, or checkbox sits in a narrower
  column right beside its words instead of drifting off to the left. Wrapped
  lines in a task line up under the task's text. No vertical indent lines —
  nesting is spacing, nothing drawn.

## [0.62.0] - 2026-07-31

### Changed

- **Half the size.** The installed app went from 40 MB to 20 MB. The Chinese
  handwriting font for boards is no longer bundled (CJK board text falls back
  to a system font), the binary sheds its debug symbols, and ~6 MB of
  hyphenation dictionaries and interface translations no code path could ever
  load are gone.
- **Typing got lighter.** Keystrokes no longer re-render the editor shell,
  re-scan the whole document, or wake the tab strip and note lists — the
  background sync tick that re-derived everything four times a second while
  you typed is quiet now. Most noticeable in long notes and multi-pane
  layouts.
- **Chat stays smooth in long threads.** Settled messages no longer re-render
  while you type your next one, and the sidebar's chat list no longer reads
  entire transcripts just to show titles.
- **The Librarian reports instantly.** Activity status, the queue count, and
  the secure-note badge update on real events instead of a once-a-minute
  check.
- **The whole toolchain moved to oxc** (oxlint + oxfmt + the tsc lane split
  out): the full lint gate dropped from ~12s to ~2s, formatting from ~2s to
  ~50ms. Dev-facing, but it guards every release.

### Fixed

- **Quit can't outrun a board save anymore.** A pending board write now holds
  the quit handshake until its bytes land, and closed boards no longer pile
  up quit work for the app's lifetime.
- **A failed Librarian cycle shows its error** — the status strip could
  previously miss it in a race and show nothing.
- **Releases can't embed release artifacts.** The updater feed used to stage
  inside the folder that gets baked into the binary; a stale build could have
  shipped 55 MB of the previous release inside the app.

## [0.61.0] - 2026-07-31

### Added

- **Your own routines.** Routines → "Add a routine…" creates a **custom
  brief** — Breve researches your prompt on schedule, with the same care as
  the morning brief — or a **reminder** that delivers your words at a chosen
  time. Custom briefs land in the Briefs list under their own name. The three
  daily briefs also take **extra instructions** now, and every routine that
  speaks for you shows an Instructions editor.
- **The brief playbook, in your hands.** Routines → "Brief instructions"
  shows the exact system prompt every brief follows — edit it and the next
  brief uses your version (no restart), or reset to the shipped default.
- **Breve in every vault.** A fresh vault offers "Start Breve in this vault":
  one click brings your delivery setup and routines along (shared defaults),
  and each vault's briefs, watchlist, and routines stay its own.
- **Briefs speak.** Each brief with a spoken version shows an inline audio
  player in the reader.

### Fixed

- **Creating or switching vaults no longer freezes the app.** The folder
  picker and the whole vault lane moved off the main thread, and the
  Librarian's boot sweep waits out the first paint.
- **Empty Trash empties everything** — trashed files and boards (not just
  notes) now delete; "Emptied 0 of 35" is gone.
- **The Librarian's "Open the note" opens the note** (area overviews used to
  land on an empty Untitled tab), and the same fix reaches the Briefs
  reader's "Open in Notes".
- **Collapse-all is two-stage**: first press folds open folders (chat folders
  included — and they stay folded across relaunches now), second press folds
  the sections themselves. Its tooltip no longer clips at the sidebar edge.
- **Tasks reads cleanly**: wrapped checkboxes show their full text, bold and
  code marks render instead of leaking `**`, and every group header shows
  which note it is — glyph, count, and a click-through.
- **Theme polish**: the warm accent no longer leaks into Paper/Charcoal icons,
  and the Librarian's settings button sits clear of its divider.

## [0.60.0] - 2026-07-31

### Changed

- **"Run now" is a real audit.** Beyond new and changed notes, it now checks
  every note for missing metadata — a note "processed once" whose summary,
  tags, or links never landed gets caught and filled in. Nothing hides.
- **The log shows its work.** Click any history row for a real diff — the
  old value struck out, the new one beneath it, moves shown as from → to —
  with the note itself one link away.
- The Librarian's settings control is a labeled button, not a bare gear.

## [0.59.0] - 2026-07-31

### Changed

- **Onboarding shows its keyboard.** Every pickable card wears its number,
  and a quiet hint above the footer says what the keys do — 1–9 pick, arrows
  move, ⏎ selects (again to continue), ⌘⏎ selects and continues.

## [0.58.0] - 2026-07-31

### Added

- **You can always see the Librarian working.** The sidebar's Librarian
  button pulses a quiet dot whenever anything runs — a scheduled pass or the
  background adopter — with the current note's title in its tooltip. Inside
  the Librarian, a standing status strip shows the trust level, the
  organizing model, and the last pass, with settings one gear-click away.
- **Onboarding by keyboard.** Numbers pick a card, arrows move between them,
  Enter selects (Enter again continues), ⌘⏎ selects and continues.

### Changed

- **Organize truly works in the background now.** Metadata suggestions no
  longer pile up in the Waiting lane at Organize — leftovers apply
  themselves through the same guarded, journaled, undoable lane the Approve
  buttons use. The one thing that always waits for you, at every trust
  level: filing a note the Librarian isn't sure about.
- "Run now" lights up the moment you click it, and explains itself when it
  has to wait for an in-flight chat.

## [0.57.0] - 2026-07-31

### Added

- **Approve everything at once.** The Librarian's Waiting lane gains
  "Approve all N" and an armed "Dismiss all…" — the whole backlog in one
  deliberate click, with stale rows skipped safely and reported honestly.

### Fixed

- **"Run now" always answers.** An explicit run that finds nothing new says
  so ("Nothing new to organize — everything is already filed") instead of
  silently closing — it read as a dead button.
- One action at a time in the Librarian: while a batch runs, every other
  mutating button waits its turn.

## [0.56.0] - 2026-07-31

### Added

- **rotli:// links — a clickable path into the app.** When Claude, Codex, or
  any agent manages a note through the rotli CLI/MCP, the result now carries a
  `deepLink` (`rotli://open?id=…`) beside the disk path. Click it anywhere —
  terminal, chat, another app — and rotli surfaces with that note open. Links
  are ids only, validated hard (traversal, absolute paths, and hostile shapes
  are ignored), and clicking one can never touch anything outside your vault.
  Works cold too: a click launches the app and still lands on the note.
- **⌥F — find from anywhere.** The ⌥-letter family's search twin: one global
  chord summons rotli with the ⌘K palette already open. Rebindable like every
  chord.
- **Rows resize like columns.** Drag a row's bottom edge in a rendered table
  to set its height (a minimum — content still grows it); double-click the
  edge to reset. Persisted per table on this Mac, the .md never changes.

### Changed

- **Table menus wear standard icons.** Alignment is the familiar
  horizontal-lines trio (left/center/right) instead of arrow glyphs, and the
  Move actions carry arrow+lines icons — instantly readable.
- **Wide tables scroll, not squeeze.** A table wider than the editor column
  now scrolls horizontally inside its own container instead of crushing its
  columns below readability.

## [0.55.0] - 2026-07-31

### Added

- **Watch the Librarian work — and stop it.** "Run now" opens a live band that
  narrates each note the organizer is looking at ("Looking at "X" — 3 of 12",
  titles only, never content), with a Stop button that finishes the current
  note and hands control back. A last-run summary line replaces the mystery.
- **Meet the Librarian.** A first-visit explainer says exactly what it may
  touch (a note's location and its metadata — never its words), what it always
  skips (locked notes, secure notes, your Main), how each trust level differs,
  and that secrets are found by on-device patterns, not AI. Re-open it anytime
  from the ? in the Librarian's header.
- **Empty Trash.** The Trash browser gains an armed two-step Empty Trash;
  items land in the macOS Trash, so "forever" stays honest. The sidebar Trash
  row wears an alert badge when it piles up.
- **Journal hygiene.** Clear logs older than 30 days, or all history (armed
  two-step — cleared entries take their Undo with them). Pending suggestions
  always survive a clear.

### Changed

- **The Librarian reads like a page, not a wall.** The mascot emoji is gone;
  suggestions group per note ("«X» — 4 suggestions: links · tags · summary ·
  area") with Approve all / Dismiss all; history folds into days with the
  long tail behind View all.
- **You always know what's waiting.** The sidebar's Librarian button wears a
  red badge when a sensitive-data decision needs you, or a tinted count of
  suggestions awaiting approval — Suggest mode is never a silent queue.
- **Tidy vs Organize, finally clear.** The captions now state their one real
  difference: Organize also keeps each area's overview page fresh by itself.

### Fixed

- Journal entries and `filed_by` stamps now name the model that actually did
  the organizing — a Claude-organized run used to be recorded as the local
  model.

## [0.54.0] - 2026-07-30

### Added

- **A note owns many chats now.** The editor's chat chip opens a picker —
  every chat on the note, newest work first, plus "New chat about this note";
  ⌥-click (or ⌘⇧C) skips the picker and continues the latest. Additional
  chats get their own slugs and "· 2"-style titles, so a second conversation
  never lands in (or overwrites) the first. The note context menu grows
  "New chat about this note", and both verbs are rebindable actions.
- **Read your briefs inside Breve.** The Briefs page now opens with the
  latest brief rendered right there — older/newer stepping, kind + date +
  reading time, and a finite close: "That's the whole brief — distilled from
  your topics. Next: …". Library rows load into the same reader; leaving
  Breve is only the explicit "Open in Notes".
- **ROADMAP.md** — the planned-features home: the email Inbox front's return,
  mobile and tablet apps, and the handwriting-to-text notebook experience.

### Changed

- **Chat messages read like a premium chat surface.** The per-message "rotli"
  label is gone — replies are plain text; hovering a message reveals its
  options (Copy, with a ✓ beat); the quokka mark appears once at the thread's
  live edge, ahead of a streaming reply or resting after the last one.
- **Breve reorganized, reading-first.** The rail is Briefs · Routines ·
  Watchlist · Settings — Models and Configure merged into one Settings home,
  which also hosts the legacy-migration steps. The watchlist arrives as calm
  folded groups (search auto-expands; your open groups survive saves).
- **The Inbox placeholder left the sidebar.** rotli shows two fronts — Chat ·
  Notes — until the mail integration is real (see ROADMAP.md). Capture,
  `wiki/_inbox`, and the Librarian's intake are untouched.

### Fixed

- The onboarding hint for ⌥C said captures land in "Inbox" — they land in
  **Captures**, and the hint says so now.
- Two settings forms editing Breve config at once can no longer clobber each
  other's saves or silently drop an unsaved draft on navigation.

## [0.53.0] - 2026-07-30

### Added

- **The chat can edit your notes now.** A new `update_note` tool lets the
  model rewrite an existing note when you ask — "clean up my summary on this
  note" becomes a real edit, not an apology. It rides the same write lane the
  editor uses (frontmatter and metadata preserved), may only touch notes it
  is allowed to READ (secure gates enforced in Rust, unchanged), and a chat
  carrying secure content can only edit notes that are themselves secure. If
  the note's tab is open, it refreshes live — and your own unsaved edits in
  that tab always win.
- **A landing light for pane focus.** When focus moves between split panes —
  by hotkey or click — the arriving pane flashes a brief accent outline that
  fades, so your eye lands where your keyboard did.

## [0.52.0] - 2026-07-30

### Changed

- **The Library selects like a Finder.** Folder tiles join the selection
  grammar items always had: ⌘-click gathers several, ⇧-click ranges across
  the folder band, and the empty-space marquee sweeps folders and items alike
  — in Icons and List views (Columns keeps its click-opens-the-next-column
  law). ⌘-click also mixes folders and items in one selection.
- **The Library stops showing its plumbing.** The `_templates` and `Captures`
  tiles are gone from the Library grid — both looked like broken empty
  folders, and neither is a browsable area: `_templates` is the vault's
  contract-owned template lane (the organizer deliberately skips it), and
  `Captures` was the `_inbox` staging lane, whose notes already live in the
  Captures front (sidebar + board). Nothing was deleted from disk — they were
  never rotli's to delete.

## [0.51.0] - 2026-07-30

### Added

- **Chats can be reorganized inside their folders.** Drag a chat onto another
  chat in a folder to place it exactly there (the same drop-line grammar as
  Main); dropping on the folder row still files it at the end. The manual
  order lives in the same rebuildable sidecar as the folders themselves.
- **Every reply can be stopped.** The send button becomes a Stop while rotli
  is working — connected CLI models are killed for real, the local model's
  in-flight reply is discarded — and your prompt returns to the composer
  intact, ready to edit and resend.

### Changed

- **Naming a chat is optional by design.** The title field says so — press ⏎
  on it empty and you drop straight into the message box; the chat names
  itself from your first message.
- **New chats land where you'd look for them.** A chat started while you're
  in a foldered chat files itself into that same folder; the loose list now
  sorts most-recent-first (pinned still float), so a fresh chat is always at
  the top, never buried at the bottom.
- **Working looks alive.** The static "thinking…" now ambles through a warm
  little vocabulary — reading the shelves…, connecting dots…, brewing an
  answer… — beside the pulsing dots, and real tool statuses still take over
  when something concrete is happening.
- **The local model answers like it means it.** The Gemma prompt now carries
  an explicit answer contract — lead with the facts themselves, never "that's
  documented in the family/ subfolder", with a BAD/GOOD example it can
  imitate — and asks for Markdown structure (bulleted lists, bold names), so
  replies come back direct and formatted instead of vague and flat.
- **One sidebar row grammar.** A consistency audit of the whole left menu:
  every first-level row now starts at the same left inset across Inbox, Chat,
  and Notes (chat and inbox rows sat 6px deeper for no reason); chat-section
  icons match the tree's sizes; chat folder rows drop their bold (the chevron
  and folder glyph carry folder-ness, exactly like Main's folders) and share
  the tree's chevron column; the open chat now wears the same solid accent
  pill as the open note (one active-item state, replacing the lighter wash);
  and the "+N more" / connect-a-memex rows hover with the shared wash like
  every other interactive row. Verified in all four environments — Warm
  Light, Warm Dark, Paper, Charcoal — with every semantic token the sidebar
  consumes resolving in each.

## [0.50.0] - 2026-07-30

### Changed

- **Chat folders read as folders.** The Chat section's folder rows now carry
  the Notes tree's disclosure grammar — a rotating chevron beside the folder
  glyph, with chats indented one clear step beneath — and you can **drag a
  chat onto a folder** to file it (same pointer-drag as the Main tree: the
  row dims, the folder tints, drop assigns).
- **Chat rows match note rows.** The right-click menu gains Open in new tab,
  Open to the right, and Show in Finder (revealing the real `chats/<slug>.md`
  on disk), alongside the existing Pin, Rename, Move to folder, Copy file
  path, Archive, and Delete.
- **The active tab lost its blue top line.** The 2px accent edge that marked
  the focused pane's active tab is gone — the tab already reads active by
  merging into its editor.

### Fixed

- **The chat's note button opens only the note.** With "open beside the chat"
  set, clicking the note icon used to split the pane with a duplicate of the
  chat and then add the note next to it; the split now carves the new pane
  with the note alone.

## [0.49.0] - 2026-07-30

### Fixed

- **A note that can't save says so.** A failed note write (read-only volume,
  permissions, disk full) now surfaces an inline error above the text —
  “This note isn’t saving” — keeps your words in the buffer, and retries on
  its own every few seconds (quit still attempts one final write). Before,
  every failure except a deleted note was silently swallowed and the only
  hint was a muted dot. (Perf audit 2026-07-30, correctness #1.)
- **Sheet embeds joined the quit-flush lane.** A ```sheet fence edited inside
  a note now registers its unsaved cells with the same hide/quit flush the
  full sheet editor uses, parks them across scroll-away remounts, resumes a
  parked session instead of showing stale rows, and surfaces write failures
  inline. And while the sheet's own tab is open anywhere, the embed goes
  view-only — two live savers can no longer overwrite each other's cells.
  (Correctness #2.)
- **Main can't lose an arrangement quietly.** `.rotli/main.json` writes now
  carry the same latest-wins sequence guard named views always had, and the
  sidebar's Main header shows Saving…/Saved — with an inline error if the
  write fails. (Correctness #3.)
- **Settings survive a transient write failure.** The debounced settings/
  viewstate writer only marks a payload written once it lands, so a failed
  write retries instead of silently reverting your theme, keybindings, and
  panes at next launch. (Correctness #4.)
- **Captures multi-select no longer resets mid-flight.** Selecting several
  capture cards survives unrelated background changes (Main edits, Quick
  access changes) — the reveal-and-select effect now fires once per reveal
  instead of on every list refresh. (Correctness #5.)

### Changed

- **The window stops freezing for background work.** The commands that used to
  run on the main thread — web fetch/search for agent tools (up to 20s each),
  document conversion, memex validation, Breve's email/Signal delivery tests,
  the model-download progress walk, and the system profile — now run on worker
  threads, so the app keeps painting while they work (every security guard
  unchanged and in place). The corpus walk behind every note list is memoized
  against a change generation — your own writes and external file changes
  (via the watcher) refresh it, everything else answers from cache — and
  search and the Tasks list reuse that one parse instead of re-reading every
  note twice. A chat's first token no longer waits on ~350 serial per-note
  permission probes: one batched Rust check (same enforcement, same secure
  detector) answers for the whole hit list. And the 750ms `rotli open`
  mailbox poll (~115k IPC calls/day) is gone — Rust forwards the CLI's
  activation as a `rotli:open-request` event instead.

- **Startup got ~35% lighter and typing got dramatically cheaper.** The quokka
  illustrations (~450 KB, 29% of startup JS) now load on demand — same inline
  line-art, same theme tinting, just fetched the moment a quokka moment
  appears; katex is bundled once instead of twice (−260 KB and no more
  double-load); and Settings, Breve, and Onboarding code-split off the entry
  chunk. Typing in a note no longer refetches the whole notes universe every
  400ms — the editor patches its own save straight into the caches (full
  refreshes still run for create/move/trash/external changes, and the Tasks
  list re-derives only when checkbox lines actually change). Launch hydration
  reads its files in parallel, batched file drops and multi-archive/trash run
  their independent writes together (with exact per-item failure reporting),
  and a dead-code sweep dropped ~470 lines of orphaned CSS, four unused
  exports, and an unused native devDependency.

- **The Breve watchlist reads before it edits.** Topics now render as compact
  scannable rows — name, source domain, one-line guidance — under their group
  headers instead of a page of always-open forms; clicking a row (or its
  explicit Edit) expands one in-place editor with a Done to fold it back.
  Every group header carries its own “+ Add topic” button, so adding to a
  group no longer requires hunting; “Add group” stays in the sticky manager
  bar beside Save. Validation moved off the page banner and onto the
  offending row (“Name this topic, or remove it.”), with a compact
  fix-the-marked-rows hint next to the disabled Save and a needs-attention
  note on collapsed groups hiding invalid rows. Same watchlist Markdown
  contract, same capabilities — presentation only.

## [0.48.0] - 2026-07-30

### Added

- **Code blocks read like an IDE.** Fenced code with a language tag (```ts,
  ```json, ```python, ```rust, ```bash and twenty-some more, aliases
  included) renders with real syntax colors — keywords, strings, comments,
  numbers, functions, and types each in their own voice, tuned per theme by
  riding the accent palette. Languages load lazily so notes stay fast, an
  unknown language stays plain (never wrongly colored), and the markdown
  source is untouched.
- **Table columns resize by drag.** Grab any column boundary in a rendered
  Markdown table and drag; widths persist per table on this Mac (the .md never
  changes) and a double-click on a boundary returns the table to automatic
  layout.
- **Reviews now teach the tooling.** A tracked, sub-second pre-commit hook
  (staged-file Prettier + conflict-marker guard; enable with
  `git config core.hooksPath .githooks`) plus a standing rule in
  CONTRIBUTING: when a review flags a class of issue, the same PR lands a
  mechanical guard for that class.

### Fixed

- **Images load in notes from every location — and repair themselves.**
  Relative and `storage:` image links resolved only against the primary
  corpus, so notes living in a connected brain showed empty broken boxes —
  they now resolve against the note's own root. And a link that stops
  resolving is classified, not abandoned: a MOVED image heals the link to its
  new home, an ARCHIVED image still renders (the link stays untouched so a
  restore heals it naturally), an image in the TRASH says "photo deleted — in
  the Trash", and only a truly gone file reads "not found".
- **Images follow their note.** Trashing or archiving a note takes its images
  to the same place — unless another note also uses them (the check is
  conservative: any doubt keeps the file put). A General setting, on by
  default; restoring a file from Trash or Archive returns it to its original
  path, so the note's link works again immediately.
- **Settings reads as one column.** Every control now holds a single shared
  width — the four themes sit in one row, segmented choices are compact
  controls instead of full-width bars, and the App icon area no longer floats
  against a stretched segment above it.

## [0.47.0] - 2026-07-30

### Added

- **Chat folders.** Right-click a chat → Move to folder to group the Chat
  section into collapsible folders — organization is virtual (chats never move
  on disk), folders rename and delete from their own menu, and a renamed chat
  keeps its folder.
- **⌘N speaks digits.** The chooser tab is a centered grid with a number on
  every card — ⌘N then 1 opens a chat, 2 a Markdown note, 3 a Document, and so
  on. Chat joined the chooser as a first-class card.

### Fixed

- **Local replies no longer freeze the app.** The model transport ran on the
  main thread, so every on-device generation beachballed the whole window and
  even your just-sent message painted late — it now runs on a worker, keeping
  the app responsive (and send instant) while a model thinks.
- **Local models search smarter and follow up properly.** The agent prompts
  now teach 1-3-keyword searches (the engine matches exact substrings, so
  whole-question queries found nothing) and that a follow-up asking for
  specifics requires re-reading the source note — proven against a live
  whole-vault evaluation (`scripts/eval-vault-sweep.ts`, a reusable harness
  that reads the real vault only through the workspace CLI's security
  boundary). The full findings and the retrieval roadmap live in
  `docs/design/local-model-retrieval-notes.md`.
- Clicking All chats no longer leaves the previously open chat highlighted
  beneath it — one selection at a time.

## [0.46.1] - 2026-07-29

### Fixed

- **Local-model chat reads your notes before answering about them.** Asking the
  on-device model things like "who are the people in my vault?" used to get a
  wrong list parroted from note titles, search snippets, and `links:` stems
  (e.g. a project offered as a person) — the model never opened the note, and
  when it did, the body was cut at 2,000 characters with no warning. The agent
  prompts now carry an explicit search → read → answer workflow, teach that
  `[[wikilinks]]` and frontmatter are references/metadata rather than content,
  the 128k local family (Gemma 3) reads up to 6,000 characters per note with a
  visible `[…truncated]` marker when a note is longer, and final answers are
  steered to concrete facts instead of note titles. Verified with live evals
  against the local MLX server (`scripts/eval-local-chat.ts`).

## [0.46.0] - 2026-07-29

### Added

- **The chat composer grows with you** — up to seven lines while you type,
  then it scrolls inside, so long messages stay visible instead of hiding
  behind one cramped line.
- **A real thinking indicator** — three quietly pulsing dots ahead of the
  status line while a model works (still, for reduced-motion users).
- **Chat models can create and open notes.** Ask for a note in chat and the
  model writes it through the same intake lane as the CLI (staging/Inbox, the
  organizer files it later) and can open any note on screen in a tab.
- **Copy file path** on a chat's right-click menu — the chat is a real
  `chats/<slug>.md` file, and now the menu says so.

### Changed

- **Text selection wears your primary color** — a translucent wash of the
  theme accent instead of the fixed peach tint, in the editor and everywhere.
- **The chat's attached note is real conversation notes now.** The model that
  answers also keeps a "Conversation notes" section — decisions, facts, action
  items, open questions — like a colleague taking notes, replacing the old
  speaker-labeled transcript, its visible HTML markers, and the stray "> chat:"
  blockquote (old notes migrate on their next update; without a usable model
  the section falls back to a topics digest).

### Security

- **Secure-note content can no longer reach a remote model through chat
  history.** When a local model reads a secure note during a chat turn, the
  chat is permanently marked `secureContext` — remote and routed models leave
  its picker, web search locks off, sends to non-local models refuse, its
  transcript is excluded from remote models' chat-memory retrieval, and no
  unlabeled memory note is written from it.
- **A secure-context chat writes secure notes.** When chat carries secure-note
  content, any note the model creates is stamped `secure: true` — the model
  can't launder secure prose into an open note (Greptile P1, PR #4).
- **Boards joined the remote egress gate.** Connected agents (CLI/MCP) can no
  longer read, list, or rewrite a board whose scene carries secret-shaped
  content — the boards mirror of the note lane's rule.
- **Breve's keychain unlock password left the process table.** Unlocks and
  secret writes now ride `security -i` over stdin instead of argv, and the
  image-generation sandbox explicitly denies the Breve keychain file.
- **`Uninstall` for a local model only trashes inside the models store.** A
  corrupt or hostile registry path can no longer point the delete at an
  arbitrary folder.
- **The memex read lane refuses symlink escapes** — spine reads resolve
  through the same containment as every corpus lane instead of a string
  check, and real read errors are no longer reported as empty files.

### Fixed

- **Unreadable notes fail closed.** A note that can't be read (permissions,
  invalid UTF-8) now refuses blank-discard and body saves instead of being
  treated as empty — previously it could be trashed or have its frontmatter
  (including `secure: true`) silently regenerated. The brain journal and
  corpus `.gitignore` gained the same protection against wholesale rewrite.

- **Visual mermaid shapes are visible again.** A generic button reset was
  outranking the shape styling, leaving nodes as bare labels until selected;
  shapes now render their fill and border in every theme, and connections
  stop at each shape's border — arrowheads land on the shape instead of
  hiding under the label.

## [0.45.0] - 2026-07-29

### Added

- **Mermaid grew a camera — everywhere.** The diagram in your note pans and
  zooms in place (scroll zooms, drag pans, double-click fits, a still click
  opens the workspace), and the Visual editor gained the same camera: scroll
  to zoom at the cursor, drag empty canvas to pan, − % + Fit controls, with
  node dragging staying exact at every zoom level.
- **Converting to Excalidraw lands beside the note** — same Main folder, same
  named view — and offers **Convert & replace in note**, swapping the mermaid
  fence for the new board embedded right there.
- **Mermaid diagram is a New… item**, next to Board: a note born with the
  starter flowchart.
- **⌘N opens a blank chooser tab** — pick Markdown / Document / Sheet / Board
  / Mermaid and the tab becomes it. **⌘⇧T is New board** now; reopen-closed-tab
  moved to ⌘⌥T (everything stays rebindable).

### Fixed

- Files added to a Main folder that a named view mirrors now show in that
  view too.
- Embedded boards (and sheets/documents) remember their resized height across
  edits and restarts.
- Protection toggles in the row menu (Lock from the AI, Mark secure) wear a
  lock in the gutter — the star belongs to Quick access alone.

## [0.44.0] - 2026-07-29

### Added

- **Quick Look.** Press Space on anything selected in the System browser — or
  pick Preview from any row menu — for a modal peek without opening the full
  surface: images, PDFs, audio, video, text and CSV heads, and a readable
  note render. Formats without a faithful cheap preview show an honest
  metadata card. Open escalates to the real surface; Esc closes, and focus
  returns to where you were.

## [0.43.0] - 2026-07-28

### Added

- **Pictures look like pictures.** Image assets in the System browser show a
  real thumbnail instead of a generic glyph — in the icon grid and in the new
  **Gallery view**: Finder's fourth view, a big preview over a filmstrip
  (←/→ walk it, ⏎ opens). The view switcher now wears the standard Finder
  icons, with the words in tooltips.
- **Duplicate.** The row menu's new copy verb: a full copy titled
  "title copy" that opens on create. Placement routes like every new note —
  in place for a plain folder, Brain staging for a curated memex folder —
  and failures say so instead of mislaying the copy. ("Move to…" is retired:
  it listed Library areas no matter which view you were in.)

### Changed

- **The path bar moved home.** The System browser's crumb trail now sits at
  the bottom, Finder-style — every segment navigates, and the selected item
  is the leaf. Right-clicking empty space offers New folder and Sort by
  Name / Kind / Date modified / Date created (pick again to flip direction).
- **The Library tells the whole truth.** It now lists the files and boards
  living inside wiki folders (brief PDFs, images, canvases) — not just
  notes, which read as broken next to Assets.
- **The sidebar footer.** Files · **Librarian** · Settings share one quiet
  row (the Activity row renamed — it's the Librarian's journal). The
  New-board header icon folded into the New… menu, the header keeps to one
  row with the vault name shrinking to "…" first, and header tooltips can no
  longer clip off a narrow sidebar.

## [0.42.0] - 2026-07-28

### Added

- **Bare links are links.** A plain `https://…` typed into a note now renders
  as a real link — ⌘-click opens it in the browser, same as `[text](url)`
  links. The chat surface opens them on a plain click.
- **Close every tab.** The last tab's × is no longer hidden: close it and the
  pane rests with the quokka and three quiet ways back in (⌘N new note ·
  ⌘K search · ⌘⇧T reopen). ⌘⇧T restores exactly what you closed.

### Changed

- **The sidebar breathes.** Section chevrons (Inbox · Chat · Notes) moved to
  the row's right edge and the Main tree lost its wasted first indent step —
  icons and labels start flush left. The pinned System zone is smaller and
  quieter: compact muted rows that warm up on hover.
- **One selection grammar.** The redundant accent bar beside active rows is
  gone everywhere (menus, sidebar rows, chat rows) — the tinted background
  alone marks the active item.
- **Wikilinks tell the truth.** `[[links]]` survive renames (the old title and
  filename ride along as aliases) and keep working for archived notes; a link
  whose note was deleted — or never existed — now renders dimmed with a dashed
  underline and says so, instead of silently doing nothing. `[[target|shown]]`,
  `[[target#heading]]`, `[[target.md]]`, and path-style targets all resolve.

### Fixed

- **⌘K arrows work with the mouse parked over the list.** Scrolling the
  selection used to fire synthetic hover events that snapped it back under the
  cursor — arrow keys read as dead. Selection now only follows real pointer
  movement.
- **Assets no longer claims "Nothing here" beside a real count.** The
  Assets/Archive/Trash browsers compared destination names against on-disk
  memex lane paths (`Storage` vs `storage/…`), so the listing always came up
  empty. Paths are now read through the destination's namespace.

## [0.41.1] - 2026-07-28

### Changed

- **Browsing doesn't pile up tabs.** A plain click opens a note (or board, or
  file) into one reusable _preview_ tab — shown in quiet italics — and the
  next click reuses it. Click the same item again, or start editing, and the
  tab stays for good. ⌘-click and ⌘T still open real tabs, exactly as before.

### Fixed

- CI-only e2e flake: select-all in the editor now uses the platform modifier
  (⌘A was a dead key inside CodeMirror on Linux runners).

## [0.41.0] - 2026-07-28

### Changed

- **Main rows gather.** ⌘-click Main rows to select several, then one drag
  moves the whole selection into a folder — a plain click still just opens.
- **Capture cards read at a glance.** The card shows up to six lines of the
  capture (they're one-off quick notes — the card is often all you need);
  click still selects, double-click still opens, and "Make a note" graduates
  it.
- **The left menu settles.** Main is no longer collapsible — its header is
  purely the view switcher; the Recent row is gone (All notes already sorts by
  recency); **System is pinned at the sidebar's bottom**, always visible,
  never collapsing; and a quiet **Files** button under it opens the vault
  folder in Finder. Active System rows drop the wash and bar — the open
  surface on the right already says it.
- **The System browser selects like Finder.** ⌘-click toggles, ⇧-click
  ranges, and dragging on empty space rubber-bands a selection; **⌘⌫ moves
  the selection to Trash**. The Kind column now shows real file types (PDF,
  PNG image, Spreadsheet…), echoed on grid tiles.
- **A third view: Columns.** The Finder column view — each column lists one
  folder, clicking a folder opens the next column, double-click opens the
  item.
- **Pick your primary color.** The active state, folder tint, and selection
  wash can follow you across themes: Default (each theme's own), Blue, Green,
  Violet, Rose, or Amber — tuned per light/dark scheme, chosen in
  onboarding's theme step or Settings → Appearance. Charcoal with a blue
  primary is now a thing.

## [0.40.0] - 2026-07-28

### Fixed

- **Bullet indenting handles foreign notes.** Notes written by external
  editors or AI tools indent lists with tabs — those bullets rendered as raw
  text, Shift-Tab did nothing, and Tab just typed spaces. Tab-indented
  bullets, tasks, numbered items, and quotes now render at their proper
  depth, and Tab/Shift-Tab quietly normalize the line to rotli's two-space
  levels as part of the gesture.

### Changed

- **Splits and tabs forgive.** Closing a pane merges its tabs into the
  neighbor instead of discarding your working set; **⌘⇧T reopens the last
  closed tab** at its old slot; ⌃⇧Tab cycles backward; and the tab menu
  gained "Split right/down with this tab".
- **"Open to the right"** in the note menu splits with the _target_ — "this
  note beside that one" is one gesture now instead of split-open-close-the-duplicate.
- **Panes read clearer**: unfocused panes' tab strips mute slightly, dividers
  show their grab line on hover and double-click to even out (drag is also
  smoother — one resize per frame), and ⌘⌥-arrow focus now finds any pane
  that actually shares an edge.
- **The left menu speaks one grammar**: a System/smart row whose surface is
  open carries the same accent wash + bar as an open chat; selection no
  longer bolds (labels stop re-truncating); zero counts hide instead of
  badging "0" and the Notes header stops duplicating the All-notes count;
  Activity gets its own pulse icon (Recent keeps the clock); the text "▾"
  carets became real glyphs; drag-drop indicator lines and the added-folder ×
  no longer shift the layout; the full Quick-access star stays visible and
  explains itself when clicked; empty states share one voice; and Main
  folders answer the keyboard "m" menu (rename and friends) with proper
  aria-expanded state.

- **Boards stop rewriting themselves.** Opening, panning, zooming, or
  selecting on a board no longer touches the file — only durable content
  (elements, images, canvas background, grid) persists, and an unchanged
  scene never writes. In a vault that's a git repo this ends the phantom
  diffs, and serialization now runs once per save instead of on every
  pointer move — the big-board stutter is gone.
- **The canvas owns its keys.** ⌘D used to duplicate a shape _and_ split the
  pane; ⌘0 reset canvas zoom _and_ toggled the sidebar; ⌘=/⌘− were dead over
  a board. Inside a board those chords now belong to Excalidraw — zoom where
  you are. The vendor's own theme toggle is gone too; the titlebar sun is the
  one theme owner.
- **Boards look like rotli.** The canvas accent, islands, and default
  background now follow the app's theme family in all four environments —
  no more stock-violet island floating in a warm app.
- **Embedded boards can't fight their tab.** While a board's own tab is open
  anywhere, its note embed goes view-only (two live editors used to silently
  overwrite each other's strokes). Embed save failures now show the same
  warning strip the full canvas has, and pending board saves register with
  the quit-flush handshake — ⌘Q inside the save window can no longer drop
  your last strokes.
- **Board rename failures say why** (read-only vault, name collision) in the
  sidebar's error lane instead of silently snapping back.

- **Manual filing is back.** The System fold had quietly removed every by-hand
  move: right-click a note → **Move to…** now refiles it into a Library area
  (through the Librarian's journaled, undoable lane when it's on) or any plain
  folder — which also un-strands raw vaults, where captures had no way to
  leave the intake folder at all.
- **"New folder" works again.** The toolbar button had been a silent no-op —
  and the last folder-creation UI — since the System fold. The Library browser
  now has its own **New folder here** (the toolbar button routes to it while a
  browser is open; elsewhere it starts a Main folder). Vault rules still
  apply: a memex's curated tree politely refuses, plain vaults create anywhere.
- **A note can no longer be born in Assets.** Browsing Assets then ⌘N used to
  drop a markdown note inside the managed `storage/` lane; creation now routes
  to intake/Inbox like every other non-home selection.
- **Activity opens beside your work, not over it** — it was the one surface
  that replaced the tab you were on instead of appending.
- **The sidebar is fully keyboard-walkable again**: Captures and Activity
  joined the j/k order (the cursor used to teleport past them), and pinned
  Main notes no longer desync the keyboard order from the visual one.
- **⌃⇧Tab cycles tabs backward**, and the tab menu gained **Close tabs to the
  right**.
- **Shrinking the window respects the pane floors** — the sidebar now
  auto-collapses on resize when splits need the room (it only checked at
  split time before).
- Main's empty-state copy no longer references the removed ⊕ affordance, and
  ~700 lines of unreachable sidebar code left behind by the System fold are
  gone (the dead thicket that hid these regressions).

## [0.39.0] - 2026-07-27

### Fixed

- **The current view is visible again.** The view switcher's active row used a
  tint that vanished on the dark themes — it now carries a small accent bar and
  an accent-mixed wash that reads at a glance in all four environments (still
  no checkmark gutter; labels stay flush).
- **Collapse-all no longer reopens folded sections.** The toolbar's
  collapse-all folds the trees, but it used to reset the Chat/Notes/Main
  section fold states back to open as a side effect. Sections now stay exactly
  as you left them.

### Changed

- **The sync answer, in words.** SUPPORT.md now documents "your folder, your
  sync": recommended setups (iCloud Drive · git · any folder-sync tool), the
  one-app-per-vault caution, and the honest mobile story — plain files any
  editor can read.
- **The System browser is now a real Finder.** You're _in_ one folder and see
  only its direct contents — subfolders as folders, notes as items. Double-click
  a folder to enter it, climb back with the breadcrumb (or ‹), single-click to
  select, double-click to open: the exact conventions your hands already know.
  **Folders** is the icon grid; **List** is the columned list (Name · Date
  Modified · Kind) with disclosure triangles and sortable columns. Search still
  flattens across the whole root, "Show in Library" now lands you _inside_ the
  note's folder, and empty folders render as real tiles.

## [0.38.0] - 2026-07-27

### Changed

- **The Library browser shows empty folders.** A folder with zero notes is
  still a real folder (Finder truth) — it now renders with a 0 count instead
  of vanishing. Searching still hides match-less folders.
- **"Show in Library" lands on the note's exact folder.** The note menu and
  the editor's location chip now open the Library browser with the note's
  folder expanded, the row marked with the app's one active state, and the
  list scrolled to it — not just the browser root.
- **Raw vaults are visible in Settings → Location.** The notes-folder row and
  each linked library card show the same quiet `raw` badge the vault switcher
  uses when a vault runs without the Librarian.

### Fixed

- **Editor paper-cut sweep** — a focused QA pass over tables, navigation,
  indentation, and checkboxes (16 defects confirmed by adversarial review;
  all 16 fixed):
  - **A pipe typed into a table cell can no longer eat its neighbor.** Cell
    pipes now serialize as GFM `\|`, pasted tables with escaped pipes parse
    correctly, and serialization pads short rows but **never truncates** long
    ones — the three paths that silently deleted cell content are closed.
  - **Prose + `---` is not a table.** A delimiter row must match the header's
    cell count (the GFM rule), so "Alpha | Beta" above a `---` divider stays
    text instead of being swallowed into a table widget that rewrote the `---`.
  - **Tab is never stuck in a ragged table row** — missing cells are skipped
    and Tab past the last real cell grows the table, as always.
  - **Fenced code is grammar-free.** Space after `[]`, Enter after a dash
    line, and Tab inside a ``` fence no longer rewrite your code with list
    markers or task boxes.
  - **Numbered lists renumber on Enter.** Inserting an item mid-list bumps
    every following sibling (1. 2. 2. is gone); nested items ride along.
  - **Format-bar toggles respect indentation.** Bullet/numbered/checklist on
    a Tab-nested line toggles its own marker instead of stacking a second one
    at column 0 — and over a multi-line selection they now toggle every
    spanned line and keep the selection.
  - **The task shorthand is more forgiving**: `- []`+Space upgrades an
    existing bullet, and a pasted tab indent normalizes to spaces so the task
    renders.
  - **Enter at the very start of an empty list item** inserts a line above
    instead of silently eating the marker.
  - **Back/Forward forgets discarded notes** — closing an untouched new note
    removes it from the trail, so Forward can't reopen a note that no longer
    exists; filing a note to the Brain now retargets trail entries the same
    way it retargets open tabs (board and chat renames follow suit, and a
    file moved to Trash leaves the trail).
  - **Back/Forward remembers boards, chats, and files** — every content
    surface now enters the trail, so Back from a board returns to the board's
    predecessor instead of skipping to the last note. Replay also reuses the
    surface's open tab in _any_ pane — no more duplicate tabs spawning in
    whichever pane happens to hold focus.

## [0.37.0] - 2026-07-26

### Changed

- **System opens like a Finder, not a dropdown.** The Destinations section is
  now **System** (Library · Assets · Archive · Trash · Activity), and each row
  opens a real file browser on the right instead of an inline tree: a search
  box on top, a Folders ⇄ List toggle, real folder structure (never synthetic
  groupings), and rows that open, right-click, and drag into Main like every
  other list. "Add a folder…" moved to Settings → Location where vault
  management lives.
- **Main collapses.** The Main header's label is now a disclosure — one click
  folds the whole section. Changing views got its own quiet ▾ beside the name,
  and a new-note button joined new-folder in the header.
- **One header row.** The vault switcher and the create toolbar share a single
  line — less chrome before your notes begin.
- **The cursor points, it doesn't grab.** Draggable rows and images show the
  familiar pointing hand at rest; the open-hand grab only appears mid-drag.
- **The left menu got quieter.** The vault header sits lighter (regular
  weight, tighter rhythm) and the always-visible create marks fell to a
  whisper at rest — present when you reach for them, invisible when you read
  past them. The vault switcher also grew up: **New vault…** scaffolds a
  fresh vault wherever you point it, and raw vaults carry a quiet "· raw"
  suffix so you always know which vaults the Librarian looks after —
  Librarian-on stays unmarked, because the default shouldn't shout.

## [0.36.0] - 2026-07-26

### Added

- **Meet the Librarian.** The AI layer has a name and a face: the quiet
  on-device helper that files your notes into the **Library** and fills in
  their metadata is now the Librarian, with the quokka to match. Settings →
  Librarian is its home — the switch, the explainer, and how much it may do —
  and its change log is **Librarian Activity**. Same behavior, warmer name;
  nothing about your files or settings changes. A connected vault now reads
  "Linked library" so it can't be confused with your own Library.
- **A practice vault, one click from onboarding.** Want to try rotli (or walk
  a friend through it) without touching your real notes? Onboarding's location
  step gained "Try a practice vault": rotli scaffolds a scratch vault, carries
  your settings over, and keeps your current vault registered — untouched, and
  one click away in the vault switcher.

- **A vault can now be raw — no AI touches it.** Settings → Brain gained a
  master switch, and onboarding now leads with the promise ("your vault is
  just a folder") before asking the one question: a **brain** (rotli's AI
  files and tags your notes, logged and undoable) or a **raw vault** (just
  your files, organized by you). Raw means the organizer never runs, nothing
  files or enriches — enforced independently in the daemon and the write
  boundary — while security never turns off: secure notes, the secret
  detector, and repairs work identically in both modes. Flipping the switch
  never moves or rewrites a file, an untouched vault keeps today's behavior
  exactly, and turning the Brain back on resumes gently at Suggest.

## [0.35.0] - 2026-07-26

### Added

- **Tasks — every open checkbox, one view.** A new Tasks row beside All notes
  gathers every `- [ ]` you've written across your notes, grouped by note with
  a live count. Check one off right there — it's a real edit to the note (the
  note stays the only truth), re-validated against the exact text so a note
  edited meanwhile refuses instead of flipping the wrong line. Fenced code is
  ignored; Archive and Trash never nag.
- **The sidebar header is a vault switcher.** The top of the sidebar names the
  vault you're in; one click lists your known vaults (current one highlighted),
  switches between them — honestly labeled, since switching relaunches —
  connects another vault, or jumps to Location settings.

### Changed

- **Storage is now Assets.** One system home for every image, video, PDF, and
  file — same lane on disk, clearer name everywhere it appears (sidebar,
  Settings, file surfaces, note locations).
- **Sidebar create affordances are always visible, and system rows have none.**
  The per-folder new-note/new-folder pair and the Main-header new-folder mark
  no longer hide until hover — they sit quietly beside the counts at reduced
  strength. Storage, Archive, Trash, and Secure notes rows drop their create
  affordances entirely: those are system surfaces, and the toolbar's New…
  actions still target them when selected.

## [0.34.1] - 2026-07-25

### Changed

- **Exclusive choice menus mark the current option with a highlight, not a
  checkmark.** The Main view switcher and both "Move to view" submenus (note
  menu and Main-folder menu) now show the current view as a tinted active row,
  so sibling rows sit flush left instead of carrying a checkmark indent.
  Ordinary ✓/★ toggle menus (Pin, Lock, Secure, Star) keep their macOS-style
  gutter — those are on/off states, not a choice among options. The chat model
  picker drops its redundant trailing checkmark for the same reason: the
  highlighted row already is the answer.

## [0.34.0] - 2026-07-24

### Added

- **Notes that look sensitive now ask you, right in Brain Activity.** A
  non-secure note whose content trips the secret detector shows up as a review
  row — open it, **Make secure** (the existing protected move), or say **Not
  sensitive** and rotli remembers that answer for that exact content, re-asking
  only if the note changes in a way the detector can see. Nothing is ever
  auto-marked from this lane, and the AI keeps refusing to read or move the
  note while you decide.
- **Settings gained a Security section.** What a secure note is, how one is
  born (quick captures, detection, your own mark), and the fail-closed rules —
  never sent to remote models, kept out of git, organizer hands-off, on-device
  access opt-in per note — in plain language, plus where repairs live.
- **Spreadsheets and CSVs gained a Details popover.** The sheet header's
  Details button shows the file's canonical location (with one-click copy),
  size, created/modified stamps, format facts (CSV/TSV delimiter, UTF-8), and
  every sheet's dimensions — computed fresh when you open it, stored nowhere.
  Truncated previews say "2,000+ rows" instead of pretending to be exact.

- **Brain Activity can repair legacy secure notes stuck in intake.** A note
  explicitly marked `secure: true` that still sits physically in Brain intake
  (`wiki/_inbox/`) — pre-lane state from an older version, or an external move —
  could never leave: the organizer correctly refuses to read secure notes, and
  nothing else moved them. The Activity pane now previews these notes by title
  and, on one explicit click, Rust re-validates each on disk and completes the
  protected move into `wiki/_secure/` (destination `.gitignore` entry lands
  before the move, prose stays byte-identical, the same stable id survives).
  The repair refuses non-secure targets, symlinks, and read-only corpora, and
  its journal rows are content-free — ULIDs and lane names only, never a title,
  summary, body, or tag. Secure organization itself remains unimplemented; the
  organizer still never reads a secure note.

## [0.33.6] - 2026-07-24

### Changed

- **Sidebar menus are aligned, scrollable, and explicit about data lifecycle.**
  Ordinary actions no longer carry an empty checkmark indent, long menus keep
  their Trash actions reachable, named views say “Remove from <view>,” and
  “Move to Trash” is reserved for the durable file operation. Virtual folders
  can move their nested contents to Trash through a second confirmation, while
  Copy File Path exposes the native file location beside Show in Finder.
- **Note filenames are now readable, deterministic title slugs.** A note titled
  “Strategy master” is stored as `strategy-master.md`; same-title siblings use
  `strategy-master (2).md`, and stable ULIDs remain in frontmatter instead of
  leaking into filenames. Typing a new title or using Rename updates the file,
  preserves old title/file selectors in human-readable `aliases`, and lets
  wikilinks and `rotli rename` resolve exact titles, filenames, aliases, or IDs.
  Untouched legacy files are not rewritten merely by opening the memex.
- **Frontmatter now has an explicit record contract for filesystem querying.**
  Identity, human selectors, user organization, and AI enrichment have declared
  ownership and types; aliases participate in local search while unknown user
  metadata continues to round-trip.
- **Memex v3.8 adds deterministic structured queries.** The packaged CLI
  accepts expressions such as `area:projects tags:payments
updated:>=2026-07-01`, and the read-only `rotli_query` MCP tool exposes the
  same implicit-AND grammar with inspectable parsed clauses. Rotli applies its
  secure-content gate before matching and never writes an index or normalizes
  files during a query.
- **The title rule now matches the foundation contract exactly.** The first H1
  wins even when prose or lower-level headings precede it; Rename edits that H1,
  while deliberately renaming an H1-less legacy note promotes its former title
  line to H1. Unicode title words remain readable in filename slugs.
- **Legacy filename repair is explicit and reviewable.** The foundation
  `repair-v38-filenames.ts` command defaults to a JSON plan showing collisions,
  aliases, and wikilink effects; Rotli itself still performs only guarded
  per-note adoption and never bulk-renames during listing or startup.

### Fixed

- **PDFs, DOCX files, sheets, and other file surfaces now stay visible in the
  sidebar.** The focused file uses the same active-row identity as notes and
  boards, and opening it expands the folder chain that contains it.
- **Editing a long Markdown table cell no longer reshapes the table.** The
  inline editor preserves the rendered column widths and minimum row height,
  wraps long values, and grows vertically when the edit needs more room.

## [0.33.5] - 2026-07-23

### Changed

- **Markdown tables now edit as tables.** Clicking a rendered cell opens one
  focused inline editor while the surrounding rows and columns stay rendered;
  Tab continues through cells, keyboard focus is visible, and pipe-delimited
  source remains available through the explicit `</>` escape hatch.
- **Raw Markdown now has a restrained IDE-like syntax theme.** Rotli’s active
  accent marks source punctuation while a contrast-safe blue carries headings
  and emphasis; fenced code, links, quotes, and table structure remain legible
  across Warm Light, Warm Dark, Paper, and Charcoal. Appearance settings can
  switch the same grammar to a user-selected monochrome palette.
- **PDFs can become editable local DOCX copies.** A compact action in the PDF
  header extracts embedded text offline, preserves page boundaries, creates a
  new managed DOCX, opens it for editing, and leaves the PDF untouched.
  Image-only/scanned PDFs refuse an empty conversion and ask for OCR; complex
  layout still carries an explicit review warning.

### Fixed

- **DOCX files with Word lists open in the editor again.** Rotli now maps
  bullets and numbering to Univer’s registered presets instead of invalid
  lowercase aliases that crashed list-heavy documents during mount.

## [0.33.4] - 2026-07-23

### Added

- **Mermaid diagrams now have a real working surface.** Click a rendered
  diagram to open a keyboard-safe View/Visual/Code workspace with drag-to-pan,
  wheel/button/keyboard zoom, fit, loading/empty/parse-error states, explicit
  source apply, and an unapplied-change guard. Visual mode builds supported
  flowcharts with draggable shapes, labels, direction, node colors, and labeled
  arrow variants while keeping readable Mermaid as source truth; advanced
  syntax refuses lossy visual rewriting. `/Mermaid` inserts a valid starter.
  Desktop users can optionally convert an applied diagram into a separate,
  independently editable Excalidraw board while the Markdown fence stays intact.
- **The packaged CLI can rename a note and its file directly.**
  `rotli rename "CURRENT TITLE OR ID" "NEW TITLE"` resolves one exact note,
  refuses ambiguous title matches, preserves Markdown heading syntax and
  managed frontmatter, and routes the physical filename change through the
  guarded corpus write path.

### Changed

- **Moving between related notes no longer depends on the sidebar.** Visible
  wikilinks open with a normal click, the note date now shares a compact labeled
  back/forward trail, and tree rows omit a parent folder name repeated at the
  start of a child title without rewriting the underlying Markdown.
- **Agent and model context is explicitly untrusted and bounded.** Model Mapping
  0 now emits escaped structured JSON instead of prompt-shaped Markdown; note
  and tool-result framing resists role/delimiter injection, and copied private
  prose is refused before an enabled web/image tool can send it off-device.
  MCP requests and outputs are size-capped, returned note/board content is
  labeled untrusted data, and replacement/removal/move tools advertise their
  destructive behavior so clients can require approval.

### Fixed

- Full-screen rename, render expansion, and Mermaid workspace backdrops now use
  the same flat semantic scrim as Command Palette and WhichKey, with static and
  four-environment browser regressions preventing pale glow effects from
  returning.
- **Corrupt or oversized Excalidraw files are preserved instead of becoming an
  autosavable blank canvas.** GUI, CLI, MCP, and Rust writes share bounded scene
  validation for file size, elements, embedded files, strings, coordinates,
  nesting, and semantic action count. The full canvas offers reveal, retry, and
  a separately confirmed blank-board repair.

### Security

- Corpus reads and mutations now resolve every existing path component with
  no-follow metadata and canonical registered-root containment. Symlinked note,
  board, office-file, folder, move, sidecar, and atomic-temp parents fail closed
  instead of redirecting work outside the memex.
- Markdown SVG fences now rebuild a strict allowlisted SVG tree. Event handlers,
  scripts, `foreignObject`, external resources, unsafe URL schemes, inline
  styles, and unexpected namespaces never enter the live document; production
  CSP remains a second layer.
- The secure-organizer proposal was revised before implementation: secure
  creation remains in `wiki/_secure`, legacy intake files require an explicit
  protected-lane repair, and only a registered on-device model may produce final
  allowlisted metadata when both the default-off global setting and the note's
  `local_ai_allowed: true` permission are present. No secure-derived envelope
  may reach a remote filer.

## [0.33.3] - 2026-07-21

### Changed

- **Rotli's product surfaces are flat across all four environments.** Tooltips,
  dialogs, popovers, cards, drag previews, canvas/render overlays, and selection
  states no longer use glowing backdrops, blur, decorative filters, or drop
  shadows. Hierarchy now comes from semantic surfaces, borders, outlines, and
  state layers; component CSS can no longer bypass those roles for fixed brand
  colors.

### Added

- **Main now opens focused named views without becoming another store.** Main
  remains the global reference tree; uniquely named views add their own virtual
  folders and subset arrangement through a compact header switcher. `⌘T`, new
  items, and new folders follow the active view, while right-click menus move
  notes, boards, files, and folders between views without removing their Main
  reference. Markdown membership is synchronized as managed `view_tag`
  metadata; boards/binaries stay frontmatter-free. The JSON CLI, stdio MCP,
  workspace metrics, live external-write refresh, compatibility refusal, unit,
  Rust, and browser regressions cover the same workflow.

- **Rotli now has one agent-safe headless workspace surface.** The packaged app
  binary provides a structured JSON CLI and a local stdio MCP server for Claude,
  Codex, and scripts: list/search/read/create/update/move notes, manage Main and
  folders, create and semantically edit Excalidraw boards, and open an item in
  Rotli. New memex notes still land in intake and appear in Main immediately;
  secure/secret-shaped notes are omitted, locked notes refuse external-agent
  writes, and every edit requires a fresh revision to prevent stale overwrites.
  A grouped `agent` surface now prints copy-ready Claude/Codex setup, validates
  the configured root read-only, and runs an isolated end-to-end self-test.
  Note results explicitly declare Markdown/frontmatter semantics and provide
  readable document and agent-visible workspace metrics.

### Fixed

- **The workspace MCP server now negotiates only a protocol version it actually
  implements.** An initialize request carrying an unknown future version no
  longer gets that value echoed back as a false compatibility claim; Rotli
  returns its supported protocol and lets the client accept it or disconnect.
- **Production builds and regression emails are clean and actionable.** Vite's
  generic chunk warning is replaced by tested startup/lazy bundle budgets, and
  only JSXGraph's exact unreachable compiler warning is suppressed while the
  interpreter-only CSP guard remains enforced. The advisory RustSec job now has
  permission to publish its report and cannot fail the workflow merely because
  tracked upstream advisories remain.

### Security

- The Rust lockfile now uses patched `anyhow` 1.0.103 and `quick-xml` 0.41.0
  (through `plist` 1.10.0). The remaining RustSec unsoundness is explicitly
  scoped to Tauri's Linux-only GTK3 dependency graph; current JS and Rust
  transitive findings and their removal paths are refreshed in
  `docs/development/security.md`.

## [0.33.2] - 2026-07-20

### Added

- **Changes now carry their proof with them.** Project-level `ARCHITECTURE.md`,
  `DESIGN.md`, and `SYNTAX.md` contracts define system, interaction, naming, and
  formatting rules. The documentation guard now proves the contributor/Claude/
  CARL graph, release/CI proof chains, and CARL domain catalog stay aligned;
  structure checks enforce folder and Rust module naming as well as filenames.
- **AI evals and Main creation have named regression gates.** The regression
  chain runs deterministic offline model, prompt, tool-loop, retrieval, and
  memory-workflow evals, while Playwright proves Command-T from a Main note opens
  a new tab and exposes the intake-backed note in Main immediately.

### Fixed

- **New notes now work from Main and the Brain view.** `⌘T`, New Note, and the
  tab-strip plus route Markdown notes through Brain intake (`wiki/_inbox`) even
  when the virtual Brain header or a curated Brain area was the last selection.
  Opening a note from Main also makes its Main folder the active creation
  context, so a stale physical-folder selection can no longer steal the next
  note. The new file is referenced in Main immediately; the organizer still
  waits for its quiet window before filing the same file into a Brain area.

## [0.33.1] - 2026-07-18

### Security

- **The webview can no longer be served arbitrary `$HOME` files.** The asset
  protocol's static scope is now empty; the only grants are the runtime
  per-corpus-root allows, so `asset:` URLs resolve inside registered memex
  roots and nowhere else (decision 1, docs/development/security.md).
  Deliberate consequence: a note embedding an image by ABSOLUTE path outside
  your memex (e.g. `![](/Users/you/Desktop/x.png)`) no longer renders — move
  the file into the memex (drag it in) to show it.
- **The agy image job is OS-sandboxed.** It ran with
  `--dangerously-skip-permissions`; it now runs under a `sandbox-exec` profile
  that denies `$HOME` except the chat's assets dir and the CLI's own state
  (`ROTLI_IMAGE_SANDBOX=0` opts out). Decisions 2/3/5 (safe-fetch rebinding
  residual, image-attachment scanning, prose-overlap egress) are recorded as
  deferred/accepted with rationale in docs/development/security.md.

### Added

- **Drift guards, so the repo reads like one author.** Per-tree filename law
  (src camelCase; scripts/e2e/docs/breve-runtime kebab-case — six breve files
  renamed to comply), tsconfig strictness parity across the three compilers
  (with measured, dated divergence entries), orphan-script and orphan-check
  guards, testing.md command-map completeness, minimal identifier
  naming-convention linting, CSS kebab-case + functional-color bans, and
  snake_case IPC command naming — every rule mechanical, all mutation-tested.

## [0.33.0] - 2026-07-18

### Security

- **New security layer (`check:security`) + audit remediations.** A mechanical
  guard now pins the whole egress surface: every ureq / raw-`fetch` /
  network-CLI call site must be declared in a tracked allowlist
  (`scripts/fixtures/egress-allowlist.json`), no second HTTP-client crate can
  enter Cargo.toml, keychain account names may only appear via their named
  constants, and the `tauri.conf.json` CSP / `assetProtocol` scope / updater
  endpoints / granted capabilities are snapshotted so any widening fails the
  lint. Alongside it, several audit findings are fixed: the chat transport now
  **clamps its destination** to registered loopback model servers or the pinned
  Gemini base (an arbitrary webview-supplied endpoint is refused), the local
  llama.cpp Bearer **never rides to a remote base**, the file-read IPC lanes
  (`corpus_file_text/_bytes/open_file`) now run the same `../`-traversal guard
  as the write lanes, the AI `read_file` tool applies the secret screen before
  sending file contents to a remote model, tool results are fenced as untrusted
  **data (never instructions)** with framing-keyword neutralization, the
  `generate_image` prompt is framed as data to the nested agent, `web_fetch`
  gained a URL-length exfil cap, and Breve's local-model tier now **fails closed
  on a non-loopback endpoint** unless `llm.allowRemote` is set. CI gained an
  advisory dependency-audit lane (`bun audit` + rustsec). Threat model, egress
  map, and the reported-not-fixed list live in `docs/development/security.md`.

- **Chat's `web_fetch` tool is SSRF-hardened** (remediation batch 0). Hostname
  resolution now happens on a dedicated agent whose resolver rejects private,
  loopback, link-local, and cloud-metadata address ranges — vetting the
  connected IPs themselves, so DNS rebinding cannot slip past a pre-check.
  Schemes are http(s)-only, redirects are followed manually (≤ 3 hops,
  same-host only), and the response cap is one named 2 MB constant. TypeScript
  (Breve's safe-fetch) and Rust enforce egress independently and are both held
  to the same adversarial fixture suite
  (`scripts/fixtures/egress-fixtures.json`). DDG search and local-model chat
  traffic are unchanged.

### Added

- **New notes are ephemeral until you write.** A note you create and close
  without typing simply ceases to exist — no "Untitled" clutter in Main, and
  nothing lands in the in-app Trash (it goes straight to the OS trash /
  `.rotli/trash` fallback, recoverable but out of sight). Any keystroke,
  frontmatter edit, or lock/secure toggle makes it permanent. Rust re-verifies
  blankness before every discard, so content can never be destroyed. The same
  lane now powers "dismiss an empty note from Main" — which had been silently
  dead since 2026-07-07 (its emptiness check was unsatisfiable).

### Fixed

- **Clicking a new Main folder no longer deletes it.** Every Main folder row
  rendered an always-visible remove-× with note-row-only styling, so it sat
  unstyled mid-row — right where a click on the folder lands — and one click
  silently rewrote `main.json` without the folder. Removal now lives only in
  the right-click menu (like note rows), a freshly created folder scrolls into
  view instead of being appended out of sight below every note, and
  `main.json` writes are refused from the quick/capture webviews (which hold
  an empty manifest and could have wiped it).
- The Main header's "new folder" button now wears the IDE-style
  folder-with-plus glyph (same as the toolbar) instead of an anonymous "+".

### Added

- **rotli knows your name.** Onboarding asks (optionally) what to call you —
  editable any time in Settings → General — and chat's local and connected
  models address you by it. The name lives in `.rotli/settings.json` inside
  your memex, on this Mac only.
- **New mechanical guards.** `check:secret-parity` fails CI the moment the
  TS/Rust secret-pattern mirrors drift; `check:architecture` now walks the
  vendor seams (exceljs, Excalidraw, Univer, JSZip must stay behind their
  codec/engine adapters); `cargo clippy -D warnings` joins the CI regression
  lane; and `breve-runtime/` gets a strict TypeScript pass.
- **TS↔Rust parity harness** (remediation batch 1). Values shared across the
  language boundary — sheet byte cap, convertible document extensions,
  keychain service/account literals, CLI binary candidate paths,
  endpoint-locality verdicts, memex permission values — now live in named
  constants asserted on BOTH sides against one fixture
  (`scripts/fixtures/parity.json`) by hand-written cargo and bun parity
  suites; `check:parity` guards the harness itself in the lint chain. Known
  drift was reconciled first: the TS endpoint-locality check now requires
  http(s) like Rust, the sheet editor passes its byte cap explicitly, and the
  CLI candidate lists are byte-identical.
- **ESLint joins the lint gate** (batch 2): floating/misused promises,
  `no-explicit-any`, and react-hooks correctness on `src/`. Adoption caught a
  real rules-of-hooks bug (onboarding called a hook inside a callback —
  fixed). `breve-runtime/scripts/` was measured and deferred at 75 findings;
  the rationale is recorded in CONTRIBUTING.md.
- **A deterministic duplication miner** (batch 6, `bun run check:dup`):
  within-language shingling plus rare-literal and lifecycle bundles over
  TS + Rust, with a committed allowlist and an opt-in cached model judge for
  triage. Validated one-time against the pre-remediation tree: it rediscovered
  the pointer-drag and clamp clusters exactly and the rename-input cluster
  indirectly; the two sub-30-token fragment findings sit below the
  function-level mining floor by design (the full record is pinned in the
  miner's header comment). Never a blocking gate.
- **The adding-things placement contract** (batch 7,
  `docs/development/adding-things.md`): one table for where new surfaces,
  dialogs, overlays, features, vendor libraries, utilities, Tauri commands,
  TS↔Rust shared values, Breve runtime code, and CARL domains go — and which
  check enforces each row. New ROTLI_EDITOR and ROTLI_KEYS CARL domains close
  the editor/hotkey recall gap; `check:docs` now measures CARL coverage
  mechanically (every top-level `src/` dir over 2,000 lines needs a mapped
  domain or a recorded exemption) and verifies every path the contract cites
  exists; `check:code-shape` enforces the surface/dialog naming homes.

### Changed

- **One spreadsheet library.** Read-only sheet viewing and chat file-reads now
  run on the same exceljs codec as the editor. The abandoned SheetJS (`xlsx`)
  dependency — CVE-2023-30533, unpatched on npm — is removed and banned by
  `check:structure`. TSV files now parse into real columns.
- **Dedupe and re-homing sweep** (batch 3). One home each for ext/filename
  parsing (`src/lib/fileKind.ts`), day-bucketing, clamp, the inline rename
  input, the editor block menu (now on the shared context-menu host, gaining
  keyboard nav), Breve's markdown→text strip (one imported helper inside
  breve-runtime plus a cross-boundary behavioral fixture,
  `scripts/fixtures/markdown-strip.json`), switch knobs, and empty-state CSS.
  Misplaced modules moved to their owning layers (briefs model →
  `src/routines/`, board/chat rename → `src/services/`).
- **All four pointer-drag surfaces ride one shared drag session** (batch 4,
  `src/lib/pointerDrag.ts`): threshold, ghost lifecycle, Esc/pointer-cancel,
  click-swallow, and window-listener teardown are implemented once; drop
  semantics stay in each caller. Migrated one surface per commit (main
  add-drag, tab drag, board cards, sidebar tree).
- **Structural seams** (batch 5): boards share one session core behind the
  canvas surface and the Markdown embed; sheets/boards/noteChat/editor are
  now _named_ clean-architecture exemptions, so opt-in-by-file-presence is no
  longer a silent state; `MemexPerms` is a real Rust enum end-to-end instead
  of stringly-typed compares.
- **Formatting decisions recorded** (batch 8, decision-gated): Prettier at
  `printWidth` 110 is adopted for TypeScript — the one-time repo-wide
  reformat commit lands after diff review and will be blame-ignored via
  `.git-blame-ignore-revs`. `cargo fmt` is permanently out: measured at
  4,770–7,604 structural diff lines regardless of width configuration while
  only 287 of 18,080 Rust lines exceed 100 columns; clippy `-D warnings`
  remains the Rust gate.

### Removed

- **`.xls` and `.ods` passive previews.** They rendered through SheetJS only —
  no editor, no save — which the workspace-not-preview-catalog rule forbids.
  Open them externally, or convert to `.xlsx`.
- **Dead code sweep.** Nine unused exports, three unwired scripts, a duplicate
  slugify (chat renames now share the canonical slug law with chat creation),
  and two duplicate Rust atomic-write helpers.

### Fixed

- **⌥Q / ⌥C no longer surface the main window uninvited.** Summoning a
  floating panel makes macOS fire a spurious Reopen; the suppression was a
  700 ms time-box that could lose the race under startup load, opening main
  alongside the panel (the old "⌥. also opened main" bug, back). The latch is
  now consumed by the first Reopen and the grace is 2 s — one summon swallows
  exactly one Reopen, and a genuine Dock click always gets through
  (unit-tested).
- **Slash and block menus flip upward near the window's bottom edge** instead
  of being clipped — in the short Quick Note window a bottom-row `/` menu was
  cut off, which read as "slash doesn't work". (Quick notes have always had
  the full editor: slash commands, wikilinks, and embeds included.)
- **The quit flush now covers the Quick Note and capture webviews.** The
  handshake only reached the main window, so ⌘Q with the Quick Note focused
  could drop its last half-second of typing; Rust now waits for every live
  webview's ack (still bounded — quit can never hang).
- **Settings → Hotkeys tells the truth when the OS refuses a chord.** If a
  launcher owns a default (⌥Space lovers), the chord now shows unbound
  instead of claiming a shortcut that silently never fires.
- Keyboard focus is visible on the capture card and the Quick Note search
  (accent hairline on focus), and the app-icon call no longer runs three
  times at boot (once per webview).
- **⌘Q can no longer eat your last keystrokes.** The note editor's debounced
  save and the settings/viewstate writer are now registered with — and actually
  awaited by — the quit handshake; previously a quit with the window focused
  could drop up to 400 ms of typing and in-flight settings writes.
- **A body save can't resurrect a stale pin.** Rust preserves `pinned` from
  disk on every write (like `origin`), closing the read-modify-write race and
  removing one IPC round-trip per save.
- **Atomic writes survive power loss.** The shared write helper fsyncs the
  parent directory after the rename; before, a crash was safe but a power cut
  could drop the final save.
- **Breve datestamps respect your timezone.** Five runtime scripts stamped
  "today" in UTC, so late-evening briefs, transcripts, and generated files
  carried tomorrow's date; all now flow through the timezone-aware helper.
  The strict typecheck also caught `audio-topic.ts` crashing on start (an
  unimported constant) and an unread-mail scan crash when an IMAP search
  fails.

- **Breve no longer multiplies after Rotli restarts.** Its scheduler now has a
  crash-recoverable singleton lock, exits with its owning app even after an
  ungraceful parent death, and claims each job across processes before running.
  Signal/email delivery, provider fallback warnings, creator alerts, and watcher
  failure notices are concurrency-safe, preventing duplicate briefs and alert
  floods while preserving retries and durable receipts.
- Untouched DOCX drafts now disappear when their final tab is closed, note
  headers and menus expose a direct secure-gated “Chat with this note” flow, the
  obsolete “File to the Brain” menu is gone, and editor popovers use quiet
  borders instead of glow shadows.

## [0.32.3] - 2026-07-12

### Fixed

- **DOCX font controls stay readable in dark app environments.** The fixed
  light document toolbar and its portaled font menus now use black labels,
  visible disabled text, and explicit hover and keyboard-focus states instead
  of inheriting Univer's white-on-dark option styling.

## [0.32.2] - 2026-07-12

### Changed

- **DOCX now opens as a predictable Word page.** Documents settle before they
  become interactive, open at the top with one complete page fitted to the pane,
  use white paper with black Arial defaults, and omit Univer’s margin-corner
  guides. Table insertion retains the caret while its dialog is open, recovers
  a dropped editor command into a real OOXML table, and remounts the structural
  edit so the table appears immediately. Numeric fields remain legible in dark
  app environments, content changes activate Save, and zooming alone no longer
  marks a document dirty.
- **Sheet embeds now finish loading.** The Markdown `sheet` fence keeps its
  Univer host mounted beneath loading and error states, allowing an existing
  workbook selected from the slash command to initialize and become editable.

## [0.32.1] - 2026-07-12

### Changed

- **Files now stay recoverable inside the memex.** Archive and Trash move
  storage assets beneath the corresponding memex folder while retaining their
  original storage path for collision-safe restore. These actions never invoke
  macOS Trash, and stale file tabs/Main/Quick references are removed cleanly.
- **DOCX is conventional paper in every environment.** The Word editor now uses
  fixed light chrome and white pages, automatically fits a complete page to the
  pane without horizontal panning, survives app-theme switches without remount,
  and hides Univer’s Markdown-like paragraph/block handle. PDF frames likewise
  request their normal light rendering. Context menus no longer cast a glow.

## [0.32.0] - 2026-07-11

### Added

- **Word tables are editable in Rotli.** DOCX tables now travel through the
  framework-free document model and Univer adapter, and cell edits, formatting,
  rows, columns, widths, and supported merges round-trip through the OOXML codec.
  Unrelated package parts and unsupported Word objects remain preserved.
- **Legacy documents have a local copy-to-DOCX path.** `.doc`, `.rtf`, and
  `.odt` files can create a new managed DOCX through the macOS system converter
  without an account, cloud service, or overwrite of the source. Formats without
  a faithful route are labeled unsupported rather than shown as document previews.

## [0.31.0] - 2026-07-11

### Changed

- **Secure notes now live inside the Brain.** New and explicitly migrated secure
  notes use the protected `wiki/_secure/` lane, preserve their previous physical
  home for removal of protection, remain gitignored through moves, and are hard-
  blocked from organizer writes and remote AI reads. “Show in Brain” now targets
  the requested note directly, and file metadata shows its derived absolute path.
- **Managed files have an honest lifecycle and editable document boundary.**
  Storage files can move to recoverable Trash from their context menu, open
  duplicate tabs are closed safely, and DOCX files now open in Rotli's local
  document editor. Saves round-trip the Word package through a replaceable
  codec, preserve unmodeled package parts, keep a one-time backup, and work from
  both dedicated tabs and Markdown embeds.
- **Rotli is explicitly a workspace, not a preview catalog.** Images and video
  are the only preview-only surfaces. Other file formats must provide native
  editing and saving or an explicit local conversion/import workflow before the
  product describes them as supported. Document slash commands now list only
  DOCX-family files that the embedded editor can actually edit.

## [0.30.0] - 2026-07-11

### Changed

- **Secure notes are private by construction.** Quick captures and Quick Notes
  are secure at birth; remote/frontier models can never receive their titles,
  snippets, or bodies, while loopback-local AI requires an explicit per-note
  permission. Secure files are also gitignored and have a dedicated destination.
- **New item creation is one consistent workflow.** New menus offer Markdown,
  DOCX documents, XLSX sheets, and boards; every entry point uses the same
  memex routing, refresh, Main-reference, and tab-opening sequence. ⌘T remains
  Markdown by default and its item type is configurable in General settings.
- **The repository now enforces its structural rules.** Source modules use
  camelCase filenames, domain/application boundaries are checked, database
  dependencies are denied, and slash embeds are kept inside Markdown surfaces.
- **Brain retrieval adapts to the selected model.** Model Mapping 0 generates a
  bounded table of contents from context capability and transparent user
  signals (pins and recency), without a database or duplicate knowledge files.
- **Past notes and chats form one master memory.** Every persisted chat now
  maintains a linked background Markdown summary note, while `search_memory`
  expands keywords across organized notes and original chat transcripts before
  `read_memory` grounds the answer in the selected source. Remote retrieval
  skips secret-shaped chats and keeps the provider egress backstop.
- **Gemini 3.5 Flash can manage the Brain.** The organizer can use the existing
  authenticated, sandboxed Antigravity lane while retaining secure/locked-note
  egress protection and the provider's process-wide concurrency gate.
- **Rotli Documents now follows an enforced clean-architecture boundary.**
  Framework-free document models and use cases depend on injected storage,
  encoding, and preview ports; one composition root selects the Tauri, DOCX,
  and Mammoth adapters. A build check prevents vendor or UI dependencies from
  leaking back into the domain/application layers.
- **Regression coverage now protects product behavior and visual consistency.**
  Every push and pull request runs the frontend, Breve runtime, Rust, architecture,
  structure, and production-build checks. A fast design lane additionally verifies
  all six app themes, shared semantic tokens, focus and reduced-motion behavior,
  theme resolution, Univer mapping, and WCAG contrast for every Breve PDF preset.

## [0.29.0] - 2026-07-11

### Added

- **Breve is a first-class Rotli workspace.** The coffee control swaps the
  sidebar into Briefs, Watchlist, Routines, and Models without disturbing open
  note panes. The same control becomes the Rotli mark inside Breve and returns
  to the main workspace; adjacent note controls remain visible but safely
  disabled until the user switches back.
- **A complete Breve product workspace.** Briefs is now an operational delivery
  history instead of a passive landing page, while Watchlist, Routines, Models,
  and Configure share one restrained desktop form system with readable guidance,
  clear save state, compact status communication, and responsive layouts.
- **Breve PDF appearance is user-controlled.** Choose a built-in restrained PDF
  theme or customize its paper, ink, muted, rule, and accent colors. The same
  versioned theme contract is used by preview and delivery rendering.
- **Documents belong in the note workflow.** Rotli can create local DOCX files,
  securely preview Word-compatible files, and embed documents and sheets inside
  Markdown notes. Embedded files expand in place without changing the parent tab,
  can be resized, and offer an explicit open-in-new-tab action.
- **Document samples for hands-on validation.** A development-only seeder creates
  representative DOCX and spreadsheet files in the active local corpus without
  touching production content.
- **Copy-only Breve migration.** Rotli can import the fixed `~/breve` library
  into the active memex: Markdown briefs and watchlist become reference notes,
  creators/pages become app-private routine data, and companion artifacts move
  under `storage/breveBriefs`. The importer never deletes legacy files or edits
  launchd and is safe to run again.
- **Rotli can take complete ownership of Breve.** The explicit takeover moves
  private configuration, watcher/creator state, Signal sessions and transcripts,
  logs, the brief engine, TTS, mail, rendering, and provider fallback into the
  active corpus's managed `.rotli/breve` runtime. One restartable Rotli
  scheduler replaces the seven Breve launchd jobs, follows timezone/travel and
  live routine edits, prevents overlapping or duplicate delivery, catches up
  after sleep, and supervises the always-on Signal assistant. Once takeover is
  verified, Rotli can move `~/breve` to Trash and discard migration-only backups.

### Changed

- **Breve now uses the active Rotli memex.** Development reads the configured
  corpus instead of inventing a separate `tauri-dev-corpus`; production data
  remains write-protected and Breve configuration edits remain temporary in dev.
- **Model policy is explicit and provider-independent.** Breve exposes Claude
  Sonnet 5 and the authenticated Codex catalog even when a model is hidden from
  the general chat picker, while intentionally blocked models remain unavailable.
- **Breve implementation seams are swappable.** Scheduling, document preview,
  embedded-file controls, PDF theme resolution, and spreadsheet creation are
  isolated behind small modules instead of accumulating inside surface components.
- **The chat model picker reflects real connections.** Models are grouped by
  local Mac, Claude Code, Codex, Antigravity, and the advanced Gemini API lane;
  only enabled, installed, authenticated providers appear. The popover is now
  border-only in Charcoal, has no pale glow, removes duplicate Claude models
  from Antigravity, and supports complete arrow-key navigation.
- **Embedded boards resize and expand in place.** Drag the bottom grip to make
  a `/Board` embed taller or shorter. Its always-visible **Expand** control now
  grows the board inside the current note tab, switches to **Collapse**, and
  restores the prior dragged height instead of opening another tab.

### Fixed

- **Doctor alerts are edge-triggered.** An unresolved invariant failure is sent
  once, suppressed on subsequent 30-minute checks, and reported again only if it
  resolves and later returns. A stale `legacy-repo.bundle` is relocated from the
  managed memex to Rotli's private app-data backups without weakening validation.
- **Slash commands preserve the current note context.** Board, sheet, document,
  and note-link commands create or select their own files, embed them in the active
  note, and expand in place; tabs change only when Open in new tab is requested.
- **Brain reveal follows the file, not only its shelf.** Notes now retain both
  their shelf projection and physical Brain folder. A filed note whose shelf is
  still Inbox therefore reports its real area in metadata and **Show in Brain**
  expands and scrolls to the exact Brain row.
- **Spreadsheets fully occupy Charcoal.** Univer's workbench now fills the file
  pane to its bottom edge, and live theme changes rebuild its chrome with the
  current palette so Charcoal stays neutral instead of inheriting warm clay.
- **Corpus watcher writes stay quiet.** Watch paths are normalized across
  macOS aliases and metadata-only events are ignored, preventing app-authored
  writes from returning as false external-change notifications.

## [0.28.1] - 2026-07-09

### Fixed

- **Sheet chrome under charcoal.** Univer no longer paints warm cocoa chrome
  when the app theme is charcoal (or paper/glass) — cool neutrals match the
  shell. Raw / Save sit next to **Open externally** in the file header, and
  the grid host fills the pane edge-to-edge (no side gutters).
- **Show in Brain actually reveals.** Staged notes open Captures (forced, not
  toggled) and highlight the card; Main-curated staging notes highlight in
  Main. Filed notes expand the Brain chain. An open editor also adopts clean
  disk reloads so an external/agent edit never looks like a second version.

## [0.28.0] - 2026-07-09

### Added

- **Slash: link a note.** `/Link note` (aliases `note` / `wiki` / `link`) opens
  a searchable picker over the same note universe as ⌘K and inserts a
  memex-native `[[Title]]` (or `[[id]]` when titles collide). Wikilinks render
  as quiet dotted accent links; ⌘-click opens the target note.
- **Slash: embed a board or sheet.** `/Board` and `/Sheet` insert a short fence
  that points at a corpus `.excalidraw` / `.xlsx` (pick existing or create new).
  The note holds the pointer only; a compact live Excalidraw / Univer surface
  edits the file on disk, and **Expand** opens the full pane.

### Changed

- **The new spreadsheet engine IS the editor now.** The "New engine · beta"
  toggle is gone — editable `.xlsx` / `.csv` files open straight into the
  Univer engine (the full Excel grammar 0.27.0 introduced), and **⌘S saves
  through the faithful bridge** — the file on disk stays the truth. The clay
  brand theme, the themed ⇄ raw color toggle, and the quit/hide flush all ride
  the new path, repackaged under `src/sheets/` (codec · engine · session ·
  shell) so a future engine swap is a few-file change.
- **Editor opens lighter.** KaTeX, Mermaid, and JSXGraph load only when a
  matching fence first renders; Excalidraw / Univer embed hosts load only when
  a ` ```board ` / ` ```sheet ` fence mounts; SheetJS (`xlsx`) loads only when
  a read-only sheet or chat attachment needs it. Features unchanged — the
  default note-editor path no longer pays for those libraries up front.

### Fixed

- **Clicking an image no longer turns it into text.** A click now selects the
  image as an object — outlined, Backspace deletes it — instead of dissolving
  it into raw markdown; arrow keys into the line remain the way to edit the
  `![…](…)` source by hand.
- **Moving an image shows where it's going — and comes with you.** Dragging an
  image lifts a small ghost of it that rides the pointer (the original dims in
  place — the same grammar as dragging tabs and board cards), and draws a live
  drop-indicator line at the exact landing spot (upper half of a line = before
  it, lower half = after; the blank space below the note = the end), the note
  auto-scrolls near the edges, and Escape cancels the drag. Two silent bugs
  died with it: a downward drag used to land one image-line _above_ the drop
  point, and a mid-drag redraw could scatter the image to the wrong place
  entirely. Drops also snap out of tables and code fences instead of
  splitting them.
- **Resizing a bulleted image no longer eats the bullet.** The resize grip
  used to rewrite the whole line and wipe the `- ` prefix.

## [0.27.0] - 2026-07-09

### Added

- **A new spreadsheet engine, in beta.** Editable `.xlsx` files grew a
  **"New engine · beta"** toggle: the full Excel grammar — row/column header
  selection, ⇧-click ranges, a formula bar with live-calculating formulas,
  fill handle, copy/paste, undo/redo, resize, merge, freeze — powered by
  Univer's free Apache-2.0 engine. The file on disk stays the truth (rotli
  keeps its own codec); edits in the beta don't save yet — the faithful save
  bridge is built and round-trip-tested, and flips on after the soak.

### Fixed

- **The formula trap.** Typing `=SUM(…)` into the current editor used to be
  silently saved as literal text; it now refuses loudly and saves nothing.
- **The context menu tells the truth now.** _Show in Finder_ actually reveals
  the note (its Rust command never learned that notes travel as ids, not
  paths — it failed silently for months); _Pin to top_ actually pins — pinned
  notes **float** above your hand-arranged Main order and the Captures order
  (the arrangement itself is never touched) with a quiet pin marker; _Open in
  Brain_ became **Show in Brain** and handles staged notes (a capture's brain
  home is the Captures board, so that's what opens — the old reveal visibly
  did nothing). And when any of these fails, the sidebar says so instead of
  swallowing it.
- **Images work inside bullets.** An image on a list line (`- ![…](…)`)
  renders inline after the bullet/number/checkbox instead of staying raw
  markdown forever.
- **The phantom gap next to the star is gone.** Main rows reserved an
  invisible hover-× slot that read as a broken hole; removing from Main lives
  in the right-click menu.

## [0.26.1] - 2026-07-08

### Added

- **Back / Forward.** The titlebar grew ‹ › buttons beside search — walk your
  trail of opened notes like a browser (⌘[ and ⌘] too). The history was being
  recorded all along; now there's a way to travel it.
- **The ⌘K palette finds more.** Files by name (that PDF in Storage is one
  keystroke away) and chats by title now show up alongside notes and actions.
  Result rows got richer, too: a title match highlights the matched letters,
  and a body match shows the note's home _and_ the snippet instead of one or
  the other.

### Fixed

- **Other themes no longer creep in.** Three real leaks, all sealed: native
  dropdown menus and scrollbars now follow _rotli's_ theme instead of the OS
  appearance (`color-scheme` per theme); the ⌘-hold shortcut overlay's blur
  was hardcoded warm-cocoa and painted the warm theme over Paper/Charcoal/
  Glass — it now uses the theme's own scrim (glass got a proper one); and a
  latent CSS block that quietly re-applied warm-dark colors on dark-OS Macs
  was removed.

## [0.26.0] - 2026-07-08

### Added

- **A real spreadsheet editor.** The sheet surface grew from cell edits into a
  Sheets-style suite: a formatting bar (font family + size · bold / italic /
  underline · text + fill color · borders · wrap · alignment), **range
  multi-select** (drag a rectangle, ⇧ extends, ⌘ toggles single cells in or out,
  arrows walk and ⇧+arrows extend), **insert / delete rows and columns**
  (right-click a row number or column header), and a **Live ⇄ Theme** color
  toggle — _Live_ shows the sheet's true colors on a paper canvas exactly as
  Excel would, _Theme_ lets it blend into rotli. Display only; the file always
  keeps its real colors, and ⌘S remains the only write.
- **Chats are first-class in the sidebar.** Right-click a chat for **Pin to
  top** (rides the chat's own frontmatter), **Rename…** (inline), **Archive**,
  and **Delete** — archive/delete move the file into hidden `chats/archive/` /
  `chats/trash/`, so nothing is ever hard-deleted.

### Fixed

- **Deleting a storage file from Main no longer errors.** A binary in the memex
  `storage/` is an asset, not a note — removing it from Main just unpins it
  (the old path tried to trash a "note" that didn't exist and failed).
- **Main only shows what really lives in your memex.** A note moved to
  Archive/Trash (or living in an external vault) no longer lingers as a phantom
  Main row; trashing or archiving a pinned note also unpins it.
- **Open in Brain actually opens the Brain.** It now reveals the note's real
  `wiki/` home even when the note is also pinned in Main (Main used to win).
- **The destination highlight tells the truth.** Brain/Storage/Archive/Trash
  rows only read as selected while the content you're focused on actually lives
  there — a stale ⌘N target no longer glows while you work elsewhere.

## [0.25.0] - 2026-07-08

### Fixed

- **Excalidraw boards save in a memex again.** A board like `call-w_Jorge` living
  in the memex's `storage/excalidraw/` was refused every save ("this board isn't
  saving — read-only here"), because `storage/` is read-only to rotli. Boards now
  have their own writable lane: `storage/excalidraw/` is a rotli-owned surface, so
  boards edit and save while the rest of `storage/` stays read-only. New boards in
  a memex land there too.
- **Spreadsheets in your memex are editable now.** An `.xlsx`/`.csv` living in the
  memex `storage/` (like `company-overview.xlsx`) opened read-only, because
  `storage/` is read-only to rotli. Existing sheets there now edit **in place** —
  double-click a cell, ⌘S saves, and a one-time `.bak` keeps the original — the
  same writable-lane idea as boards. Creating brand-new files in `storage/` stays
  refused.

### Changed

- **rotli's docs now live in the memex, not this repo.** The living docs (model,
  design-system, philosophy, vision, the Main/Brain daemon spec, design notes,
  audit logs) moved into `memex-vault/wiki/projects/rotli/`, surfaced under a
  **Rotli** folder in Main — so project planning + docs are organized in rotli
  itself. The repo keeps only the README (+ `docs/media` assets and `docs/archive`
  history). CARL + code references now point at the memex.
- **The in-chat model picker is a real picker.** The composer's plain dropdown
  became a quiet grouped popover — **On this Mac · Connected · Presets** — with a
  local-vs-"this chat leaves your Mac" cue, a 👁 badge for vision models, a
  `default` tag, and the current pick checked. Same low-pulse grammar as the width
  menu.
- **AI Models settings read at a glance.** Constructive actions (Install / Add /
  Save / New) now take a restrained accent while destructive ones (Uninstall /
  Delete / Remove) step back to muted — hierarchy without any loud fills.
- **Sidebar create icons are centered.** New note · New folder · New board ·
  Collapse all now sit as a centered cluster.

### Added

- **More ways into Main.** Right-click a tab → **Add to Main** (note and board
  tabs). And you can now **drag into Main** from two more places: an editor **tab**
  and a row in the **All notes** list — the hovered Main row highlights and the
  note lands where you drop it (a plain click still just opens it).
- **Settings → Plugins: "Use rotli for your docs."** A copy-paste command for
  Claude Code that routes a project's planning + docs into rotli instead of the
  repo (README excepted).
- **Rename a chat** — right-click (or double-click) a chat tab → **Rename…**
  renames `chats/<slug>.md` on disk and re-points the open tab.
- **Find any note.** Right-click → **Show in Finder** (reveals the file) and
  **Open in Brain** (opens it and reveals where it lives in the sidebar — Main is
  just a view). The editor's location chip now shows the note's Brain folder + its
  absolute on-disk path in its tooltip.
- **First-run model setup.** Onboarding now has an _Its mind_ step: grab a small
  on-device model in one click (the download keeps going if you continue), or skip
  and connect a subscription later in Settings — so a fresh install lands with a
  working chat. Optional; it never blocks setup.

Onboarding + demo-mode polish.

### Fixed

- **Demo mode no longer forces you through onboarding.** It swaps only the notes
  memex now — your per-machine settings (look, shortcuts, and the onboarded flag)
  keep reading your real corpus, so turning demo on just changes what notes you're
  looking at, temporarily.

### Changed

- **Onboarding no longer offers Liquid Glass.** "Pick a look" is four solid base
  themes; Liquid Glass stays an advanced mode you discover in Settings.
- **Onboarding's Continue button is locked in place.** Skip moved next to the
  progress dots, Back holds its slot on the welcome step, and the primary button
  has a fixed width — so Continue never shifts between steps.
- **The seeded demo library is public and about rotli itself.** Replaced the
  personal/work sample notes with a general getting-started set (Welcome, Main &
  the Brain, note-taking, local-first) and seeded a hand-arranged **Main** so the
  demo shows the same note reachable two ways — in Main and in the Brain.

## [0.24.7] — 2026-07-07

Archive/Trash/boards work in a memex now, plus a seeded demo library.

### Fixed

- **Archive, Trash, and new boards work when your notes folder is a memex.** They
  were silently refused by the memex write-gate (Archive/Trash/new-board targets
  weren't writable), so they appeared to do nothing. Archive/Trash are now a
  sanctioned rotli lifecycle lane, and **⌘⇧N** (new Excalidraw board) stages into
  the memex. Any refused lifecycle move now shows an inline error instead of
  silently failing.

### Changed

- **Dismissing a note from Main deletes it when it's empty** (no title + no body);
  a note with content just unlinks from Main.

### Added

- **Demo mode** (Settings → General): switch to a **seeded demo library**
  (`memex-demo`, next to your real memex) with sample notes, boards, and a chat —
  for clean screenshots or trying things out. It's marked demo-only in its own
  config, so onboarding never sees it, and your real notes are never touched.
  Toggling relaunches.

## [0.24.6] — 2026-07-07

Titlebar search, a calmer charcoal, and an app-icon picker.

### Added

- **App-icon picker** (Settings → Appearance): choose the Dock icon — **Default ·
  Paper · Charcoal · Clay** (the quokka re-tiled in each palette). Persisted and
  applied on launch; shows when **Show in the Dock** is on.

### Changed

- **Titlebar search reworked.** The field is wider, the rotli mark moved off the
  far left and **into** the field as a circular badge (in place of the search
  glyph), and the **⌘K** hint is quieter (no card). The sidebar's **"Filter
  notes…"** field is gone — the global search covers it (and `/` opens it).
- **Liquid Glass is "Coming soon"** — the section still previews, but the toggle
  is disabled for now.

### Fixed

- **The ⌘K palette no longer reads warm-brown in Charcoal.** Its dim is a theme
  token now — warm in the warm themes, neutral in the mono ones.

## [0.24.5] — 2026-07-06

Pin + a global titlebar search, a repo-wide cleanup (brand & docs now live
in-repo, aligned to the current three-fronts model), and a new minimal
marketing site.

### Added

- **Pin a note to the top.** Every note now has a real **Pin** — the row's
  right-click menu gains **Pin to top / Unpin from top**, and **⌘⇧P** pins (or
  unpins) whatever note you're on. Pinned notes float above everything in **All
  notes** (and sort first in their sidebar folder), marked with a small pin.
  Pinning writes the note's `pinned` frontmatter fact and **never bumps
  `updated`**, so it doesn't reorder the note by recency. Locked/secure/Main
  rules are unaffected. (New `corpus_set_pinned` command.)
- **Global search in the titlebar.** The rotli mark moved to the **top-left**
  beside the sidebar toggle, and a **Search…** field now sits at the top center
  — click it (or ⌘K) to search every note and action.

### Changed

- **Settings toggles lost the hard outline.** The on/off cards are now soft
  filled panels instead of bordered boxes — the bright accent outline the "on"
  state drew (near-white in the dark themes) is gone; the switch alone shows
  state.
- **All notes = every note except Archive and Trash, newest first** (pinned
  above that) — and a staged **Capture** shown there now gets the full
  right-click menu instead of a dead **Restore** that did nothing. Restore is
  reserved for genuinely archived/trashed notes again.

### Fixed

- **Folder-row hover icons no longer drift apart.** The **New note** / **New
  folder** pair on a folder's hover now rides the right edge together instead of
  splitting the free space between them.

### Website

- **New marketing site** (`site/`, Astro) — a minimal, Ollama-style landing page
  built around the **quokka mark** as the logo, in the **Paper (light) / Charcoal
  (dark)** black-&-white theme pair. Self-contained; its own deps, doesn't touch
  the app's lockfile.

### Docs, brand & repo

- **Brand + docs now live in the repo.** rotli's brand kit is the app-embedded,
  hex-enforced `src/brand/` (single source of truth); provenance/history is under
  `brand/engine-history/`; docs are in `docs/`. (Migrated out of smLab.)
- **Everything aligned to the current model.** README, the brand copy
  (`brand.json` / `kit.json`), and the promoted docs (`docs/vision.md`,
  `docs/philosophy.md`, `docs/design-system.md`) were rewritten from the old
  "six fronts / Voice / Memory / bundled LLM" framing to the three-fronts memex
  model; stale/duplicate rough-drafts were removed.
- **CARL refreshed** — the project rules now describe the in-repo brand/docs and
  the correct contract band **[3.4, 3.7]**.

## [0.24.4] — 2026-07-03

The tab model, the note-location finder, and the Batch 2 sidebar pass — plus the
first foundations of the Breve→rotli merge.

### Added

- **Every note now shows where it lives.** The editor header has a clickable
  **location** — e.g. `Projects`, `Storage › Images`, `Captures`, and **★ Main**
  when the note is in Main (Main membership stays out of the frontmatter by
  design, so this is the signal). Clicking it **reveals + scrolls to the note in
  the sidebar** (expands its Main-folder chain, else its Brain area). Notes not in
  Main can be added from All Notes via the row's right-click menu.

### Changed

- **Clicking a file follows the standard editor model now.** A plain click in the
  sidebar **activates that file's tab if it's already open**, otherwise opens it in
  a **new tab** — it never replaces the file you're working in. ⌘-click / ⌘T still
  force a fresh tab. (Previously a plain click _replaced_ the active tab, so opening
  a second file lost your place.) Applies to notes, boards, files, and saved chats;
  "New chat" always opens fresh.

### Sidebar structure & navigation (Batch 2)

- **Chat list shows 5 by default** (feedback #17), with a **5 / 10 / 15** picker in
  Settings → AI Models ("Chats in the sidebar"). The old flat cap of 12 is gone.
- **The current file is highlighted in the sidebar and its folder auto-expands**
  (feedback #25) — the Main copy wins the highlight; a note not in Main is revealed
  in the Brain. Only reveals on navigation, never fighting a manual collapse.
- **IDE-style create icons** (feedback #7 / #13): the old "+" dropdown became
  explicit VS Code-style **New note · New folder · New board · Collapse all** icons
  in the sidebar toolbar, plus a **new-note + new-folder pair on each folder's
  hover** (content lands in that exact folder). The toolbar wraps on a narrow rail.
- **Stars-column whitespace fixed** on Main rows (feedback #9): the star and × now
  ride flush to the trailing edge instead of leaving an awkward gap on short titles.
- **Back/Forward navigation history** substrate (feedback #14): a new
  `src/state/navHistory.ts` trail records every opened note (replayable, capped).
  The ‹ › buttons + the filter's move up by the wordmark, and the IDE-style search
  dropdown (feedback #26), are deferred to a dedicated follow-up.

### Fixed

- **No more ghost tab on launch.** With the new tab model, the app's pristine
  startup tab is now _filled_ with your freshest note instead of leaving an empty
  tab beside it (caught by the pre-release review).

### Internal

- **Breve→rotli merge, P0 foundations:** a pure `src/routines/` layer (types, a
  tz-aware `nextRun` scheduler, a watchlist parser) and an additive Rust
  `provider_chain` fallback helper — groundwork for scheduled briefs, not yet
  wired to anything. Design in `docs/design/breve-merge.md`.

## [0.24.3] — 2026-07-03

Feedback sweep, day 2: organizer controls (pick the model + idle delay), the Breve
check-up fix, and the metadata/onboarding polish from Seth's live pass.

### Added

- **Pick the organizer's model** (Settings → Brain). Choose **On this Mac** (the
  local MLX model — default, nothing leaves the machine) or **Claude Sonnet 5**
  (via `claude -p`). With the Claude lane, non-secure notes are sent to Anthropic
  to file; **secure and locked notes are never sent anywhere** (a hard guarantee
  in the daemon). The Rust daemon re-reads the choice each cycle.
- **Set the organizer's idle delay** (Settings → Brain): 1 / 2 / 5 / 10 / 15 min.
  A note is only scanned after it's sat **untouched** that long — the default is
  now **5 minutes** (was 45s), so the organizer waits until you've moved on.

### Changed

- **The metadata (≡) icon is now an instant toggle** (feedback #23). Clicking it
  shows/hides the note's frontmatter immediately — no more popover. The controls
  that lived in that popover — **Lock from the AI**, **Mark secure**, and **File
  to the Brain** — moved into the note's **right-click menu** (alongside the
  existing Add-to-Main / Star / Rename), reachable by right-clicking a note in the
  sidebar or the editor's header chrome. The old `MetaPanel` popover is retired.
- **An open note now shows "★ In Main"** in its header status line when it's in
  Main (feedback #1). Main membership is deliberately _not_ in the note's
  frontmatter — it lives in `.rotli/main.json` so the AI reorganizing the Brain
  never disturbs your arrangement — so this is the glanceable indicator that was
  missing, plus Add/Remove-from-Main in the right-click menu.

### Fixed

- **Dropped images no longer create "broken asset" refs.** `import_file` copied a
  dropped file into `storage/` with its original name, so a macOS screenshot
  ("Screenshot 2026-… AM.png") produced a spaced `storage:` link that breaks
  markdown _and_ the memex validator's `[A-Za-z0-9._/-]` regex — the recurring
  Breve check-up failures. Names are now slugified on import
  (`screenshot-2026-…-am.png`); the existing rotli-feedback note's 16 refs + files
  were de-spaced so `validate.ts` passes.
- **Onboarding no longer shows your one brain twice** (feedback #6). When the memex
  rotli auto-detects on the Mac IS your current notes location, the "Use …" card
  was the same folder as "Keep my current location" — two cards, one folder,
  where picking "Use" just relocated you to where you already were. The detected
  list now drops any memex whose path equals the current location, so you're never
  offered the same folder twice. (Pulled forward from Batch 7.)

## [0.24.2] — 2026-07-03

The 2026-07-03 feedback sweep begins (26 items, shipped in subsystem batches —
tracker in `docs/design/feedback-2026-07-03.md`). This release is **Batch 1 of 7 ·
Tabs & Main core**.

### Changed

- **⌘T opens a new _blank_ note, not a duplicate** (#8). The tab-strip "+" and ⌘T
  both created another tab of the _same_ note; now they open a fresh note in a new
  tab — the IDE "new tab" gesture. The old duplicate-the-active-tab `newTab()` store
  method is retired (splits still duplicate, unchanged).
- **Every new note auto-files into Main** (#15). ⌘N, the "+" menu, and ⌘T now drop
  the new note into Main the moment it's created — Main is your main work area, so a
  new note shows up there immediately instead of only in Captures/Brain.
- **A new note inherits the Main folder you're working in** (#16). Create a note
  while an in-a-Main-folder note is active (or with a Main folder selected) and it
  lands in that same folder; otherwise it lands at the Main root. A `main:<path>`
  selection is treated as a view, never a disk path, so physical creation still
  routes normally (memex staging / local Inbox) — only the Main slot follows.

## [0.24.1] — 2026-07-02

The first-contact fixes from Seth's live pass over 0.24.0.

### Fixed

- **The lane toggle now actually flips.** The bare switch in a lane card was missing its
  ON-state styling (the knob styles only existed under the old full-row toggle), so an
  enabled lane looked OFF — the "enabled UI is confusing" report. Enabled lanes now show a
  filled accent switch.
- **Preset cards are readable.** The one-line summary that ellipsized into raw model ids
  ("gemma-3-12b-it-qat-4bit · MLX → ge…") is now a stacked flow: who organizes, each
  route's "when → model" on its own line, and the fallback — with human model names.
- **Model pills read at a glance:** allowed = filled with a ✓, hidden = dashed +
  struck-through, and the label says what clicking does. Version chips are clean
  ("ready · v2.1.199").

### Changed

- **The Brain organizes by default.** The trust ladder's default rung is now **Organize**
  (was Suggest) — across the UI default, the settings parse, and the Rust daemon — because
  the daemon only ever changes a note's **location + metadata** (journaled, undoable); the
  words inside notes are never touched. An explicit settings choice always wins; the design
  doc carries a dated amendment.
- **Brain pane copy rewritten** around that promise: what it touches (location + metadata,
  never your words), what **locked** means (lock a note in its metadata panel → the
  organizer skips it entirely), and when it runs.

The AI Models pane grows up: verification, per-model control, starter presets, and
"Scan my Mac".

### Added

- **Connected lanes are now cards that prove themselves.** Toggling a lane on runs one
  tiny REAL reply in the background on the lane's cheapest model (detection only proves a
  binary + a credential; a ping proves the path) — the card shows "working ✓ · haiku ·
  2.1s" or the actual error, and a **Test connection** button re-checks any time. Saving
  a Gemini key verifies immediately.
- **Setup instructions where they're needed:** a lane that isn't installed or signed in
  grows a "How to set this up" disclosure with the exact install + login steps.
- **Per-model control inside a lane:** click a model pill to block or allow it in the
  picker (e.g. keep Sonnet, block Opus). Blocked models also leave the preset editor.
  Persisted.
- **Starter presets** — three ready-made hybrids (Everyday · Private by default ·
  Frontier delegate) with stable ids; add one and tweak it like any preset.
- **Scan my Mac:** reads the chip, unified memory, and free disk (this M4 Max: 64 GB),
  says what weight class the machine comfortably runs, and badges every catalog pick
  (great fit / workable / too big). The catalog also gained **Qwen2.5 14B and 32B** for
  the Macs that can carry them.

### Changed

- The whole AI Models pane breathes: sectioned groups with real spacing, roomier rows,
  cards instead of packed toggles.
- The shared registry's `updated` field is now stamped on every install/uninstall.

The pre-test verification sweep: every connected lane's exact invocation was executed
live against the installed CLIs before handing the build over for testing.

### Fixed

- **The Codex lane was broken on arrival** — `codex exec` (0.137.0) has no
  `--ask-for-approval` flag (exec mode never prompts; that flag belongs to interactive
  mode), so every codex chat turn and codex image job would have died on argv parsing.
  Both recipes drop the flag and gain `--ephemeral` (no session litter — the codex twin
  of claude's `--no-session-persistence`). A regression test now pins the flag OUT.

### Verified (no changes needed)

- The exact claude argv end-to-end (haiku ping → `result`/`is_error` envelope parses),
  the corrected codex argv end-to-end (`item.completed` → `agent_message`), the agy argv
  end-to-end ("OK" on stdout), the claude Keychain detect probe, and all five curated
  catalog repo ids (HTTP 200 on Hugging Face).

## [0.23.0] — 2026-07-02

Install on-device models straight from Settings — and pick any of them per chat.

### Added

- **Local model installer (Settings → AI Models → On this Mac):** browse a curated set of
  MLX chat models or paste any Hugging Face repo id, and rotli downloads the weights (via
  the memex-ai venv's `hf` CLI) into the shared store with a live progress bar + Cancel,
  then registers them. Installed models can be **uninstalled** (registry entry dropped,
  dir trashed — never a hard `rm`).
- **Every installed model is pickable per chat.** The shared MLX server (bumped to 0.3,
  live-verified) now honors the request's `model`: a known id (registry id or models/ dir
  name, resolution locked inside the shared store) swaps the single loaded slot on demand.
  Models load lazily and idle-unload after ~10 minutes — nothing runs 24/7. A request
  without a model (Breve, voz, warmup) gets the pinned default, byte-for-byte unchanged.
- **Default model control:** one local model is the **default** — what no-model callers
  get. "Make default" repoints the server's launchd env (PlistBuddy `Set` + a reload); the
  default model refuses uninstall so other memex apps never lose their model.

### Changed

- rotli now _writes_ two shared memex-ai artifacts (it only read them before): spliced
  `registry.json` model entries and the MLX server's `MEMEX_MLX_MODEL` launchd env. Both
  are surgical and reversible — the registry rewrite preserves every other key (atomic
  tmp+rename), and the plist edit is a single value `Set`.

### Notes

- Connected models (Claude/Codex/Antigravity CLIs, Gemini API) are entirely separate
  lanes and unaffected by local model choices.
- Downloads shell the venv's `hf` binary (`~/.memex/ai/mlx-venv/bin/hf`); a repo id is
  validated `owner/name` and the install dir name is a safe slug, so a download can't
  escape `~/.memex/ai/models/`. Success is verified by config + weight files on disk, never
  by the CLI's stderr.
- The shared `~/.memex/ai/mlx-server.py` was updated in place (0.2 → 0.3, backup kept at
  `mlx-server.py.bak-0.2`); its registry `lifecycle` note documents the new behavior.

## [0.22.0] — 2026-07-02

The AI Chat flow, rethought: connected subscription models, hybrid routing, and the
chat that organizes itself.

### Added

- **Connected models (Settings → AI Models):** chat can now run on the subscriptions
  already signed in on this Mac — **Claude Code** (Claude Pro/Max), **Codex** (ChatGPT),
  **Antigravity** (Google AI Pro/Ultra; bundles Gemini 3.x + Claude 4.6 models) — plus a
  bring-your-own-key **Gemini API** lane. Each lane shows a live status chip (installed /
  signed in / ready) and an enable toggle; the Gemini key lives in the **macOS Keychain**
  (native Keychain Services — never argv, never a config file, never IPC'd back out).
  Rust drives each CLI as a **tool-less, sandboxed completion backend** under the existing
  agent loop (hardcoded binary + model allowlist, kill-on-cancel, per-step deadline;
  agy runs single-flight). The picker groups **On this Mac · Connected · Presets** and is
  honest about locality; **secure notes stay refused** to every connected lane (the
  `endpoint: ""` locality check fails closed + a secret-shaped-transcript egress backstop
  in the CLI bridge itself).
- **Hybrid presets:** settings-defined routing — an **organizer** model reads each message
  and picks a route ("when …" → model); the routed model runs the normal agent loop; an
  optional **fallback** retries a failed executor once. Presets ride the model picker as
  pseudo-models, statuses narrate the hops ("routing via gemma… → Gemini 3 Pro"), and
  routing never fails a turn (garbage/organizer-down → first route). **Generate
  templates** drafts three presets from "what do you mostly use chat for?".
- **Every chat carries a note:** the chat header's note button opens the chat's attached
  note — materialized lazily into `wiki/_inbox/` staging on first open (`attachedTo:`
  frontmatter + the note's `## Chat` backlink) — as a **new tab or a right split**
  (Settings → AI Models → Chat & its note).
- **Chat width:** Narrow / Comfort / Wide from the chat header — the notes Aa measure
  vocabulary, per-chat, persisted, carried from an unsaved chat to its slug on first send.
- **`generate_image` chat tool + assets drawer:** chats on a connected engine (Codex
  gpt-image / Antigravity Nano Banana — a Settings radio) can generate images; PNGs land
  in `storage/chats/<slug>/` (path pinned by Rust from a registered root + safe slug —
  the model never shapes it; postcondition: the file exists non-empty). The header's
  assets button opens a thumbnail drawer; a click opens the file in a tab. Image prompts
  ride the same secret-egress guard as the web tools.

### Changed

- **The send button is a button now** — a filled circular ↑ (ChatGPT/Claude style);
  spinner while a local model thinks, a real **stop** square for connected models
  (Rust kills the subprocess mid-step).
- The agent loop grew a **frontier adapter + 200k budget tier** for connected models
  (terser system-style scaffold, same one-JSON tool protocol, deeper read/history/step
  caps) — local models keep the tuned Gemma scaffold and their exact tiers.

### Notes

- Personal-use lane: rotli drives the **user's own** installed, signed-in CLIs on their
  own machine. Distributing this to other users would need each vendor's blessing
  (Anthropic requires approval for third-party subscription auth) — fine for 0.x.
- Gemini CLI's OAuth/subscription lane died 2026-06-18 (Google's transition to
  Antigravity); that's why the Google-subscription path is `agy` and Gemini is
  API-key-only.

## [0.21.1] — 2026-07-02

### Added

- **Three new quokka poses** — `waving`, `searching`, and `celebrating` — generated against the
  base character as a style reference (gpt-image-2), binarized, and vector-traced back into the
  set's single-path `currentColor` format. Same character, same line weight, big catchlight eyes.
- **Onboarding got its moments:** the welcome step now greets you with the waving quokka, and
  the final "You're set" step celebrates (confetti). `searching` is vendored and registered,
  reserved for a future search surface.

## [0.21.0] — 2026-07-02

The quokkas, properly.

### Fixed

- **The eyes read as eyes now.** Every character's eye-highlight hole doubled (17→34 viewBox
  units) — at empty-state sizes the eyes now carry a visible catchlight instead of collapsing
  into blobs. (The set is single-path evenodd line art; the holes were simply too small to
  survive rasterization below ~120px.)
- **Every character file was mislabeled.** The original export's filenames were rotated one
  pose off — "base" was the shield, "stays_local" the easel, "knowledge_system" the laptop, and
  so on around the whole set. Re-vendored with each file carrying the pose its name claims, so
  every placement finally shows the RIGHT quokka: onboarding's "stays local" step gets the
  shield+padlock, the chat empty state gets the laptop+speech bubble, Settings pane accents all
  match their panes.

### Added

- **A new `rest` character** — closed eyes, same hand-drawn line grammar (derived from the base
  pose) — for quiet empty states.
- **Quokkas in more empty states:** All notes ("No notes yet" → the notepad quokka), All chats
  (the laptop quokka), Captures ("Nothing captured yet" → the resting quokka), and Brain →
  Activity ("Nothing yet" → the knowledge quokka). Search "no matches" states stay art-free —
  they're transient, not empty worlds.

## [0.20.0] — 2026-07-02

**The audit release.** A deep adversarial review of v0.19.0 —
[`docs/audit-2026-07-forge.md`](docs/audit-2026-07-forge.md), **97 verified findings**
across structure · UX · AI, from one critical to small polish — followed by a fix train
that landed **54 of them** in four batches: the security batch first (several findings
were armed against a vault that really holds SSNs and card numbers), then data-safety +
daemon correctness, then the bug-class UX fixes and cheap enhancements, and finally this
honesty pass over the docs. The rest of the findings stay tracked in the report (the
performance batch and the mega-refactors are sequenced there, not forgotten).

### Fixed — security & secrets (the batch that shipped first)

- **A secure note's `.gitignore` line now follows the file** _(the audit's one
  critical, #1)_ — flagging a note `secure:` gitignores it, but renaming it, filing it
  to the Brain, moving or undoing it used to leave the OLD path in `.gitignore`,
  silently making the secret committable. Every relocate/rename now re-syncs the
  gitignore entry (remove old, add new), test-pinned through the flag→file→assert loop.
- **"Local model" is verified, not assumed** (#2) — secure notes were gated by a
  hardcoded `true`; locality is now derived from the picked model's actual endpoint
  (loopback check, TS + Rust in lockstep), so a registry entry can't masquerade as
  local and walk off with a secure note.
- **Secret detection runs at the AI boundary too** (#21, #23) — a note that _looks_
  secret (even if its metadata panel was never opened) is refused to remote models,
  and the detectors on both sides now catch **separator-less** card numbers
  (Luhn-checked 15–16 digit runs) — the exact shape in the migrated notes. Dash-less
  SSNs carry no checksum, so a bare 9-digit run still isn't flagged (too many false
  positives) — dashed SSNs are caught, and the `secure:` flag covers the rest.
  The transport itself now re-checks too: `chat_messages` refuses a secret-shaped
  transcript to any non-local endpoint, the same backstop web search/fetch already had.
- **The write gates got their missing teeth** (#3, #22, #20, #44) — a brain's
  "read-only" perms + contract band are now enforced in Rust, not just TS;
  `corpus_set_field` refuses AI-owned keys and honors `writable()`; the `memex_*`
  commands only accept **registered** roots (a webview can no longer point them at an
  arbitrary path); and the daemon-owned `organizer.json` can't be wiped from the
  webview settings lane.
- **Contract honesty** — the TS/Rust contract band re-locked at [3.4, 3.7] with a
  lockstep test (#24); the file-lock now **fails closed** instead of proceeding
  unserialized after 10s (#42); five registered-but-unwired commands — including
  `corpus_purge`, the only hard-delete lane — are unregistered until something real
  calls them (#68); an inverted secure-policy comment that a future re-sync would have
  propagated is corrected (#31); and the contract surface is narrowed to what actually
  runs: the TS "Filer tier" is documented as the Rust lane's mirror, not a live TS
  path (#95), and `inbox.md` — a declared write surface **no code ever wrote** — is
  out of both write gates (#96; captures stage in `wiki/_inbox/`, Breve owns its own
  inbox appends).

### Fixed — data safety & correctness

- **Dirty spreadsheets survive quit** (#4) — unsaved sheet edits used to die silently
  with ⌘Q; every parked dirty session now flushes through the real save path the
  moment the window hides (the same seam settings flush on) — **and quit itself is
  intercepted**: ⌘Q and tray-Quit ask the webview to flush first and hold the exit
  (bounded at 2s, quit can never hang) until it acks, so edits survive even when no
  hide ever fired ("Stay open" mode, quitting from the focused window). Explicit Save
  stays the law while you work.
- **⌘N can't create a note in Archive/Trash** (#5), the **⌥Q quick-note target can no
  longer be pointed at a folder the gate refuses** (and a refused capture says so
  instead of breaking the hotkey forever, #6), and a **fresh chat no longer inherits
  web-ON** from a stale unsaved-chat toggle (#7 — the silent-egress default stays off).
- **Vision actually sees** (#8) — the MLX generate path never forwarded the attached
  image; the composer's only vision model was confidently answering about pictures it
  never received. The image bytes now ride the request.
- **The chat agent searches full text** (#9) — `search_notes` now rides the real
  `corpus_search` (title + body, ranked, snippets) instead of keyword-ranking 140-char
  snippets; long conversations are budget-trimmed instead of overflowing small-model
  context (#65); futile tool calls count toward the loop's two-strike exit (#93).
- **Daemon correctness** — a failed mid-apply write can no longer strand a capture as
  "already classified" (state mutates only after the writes succeed, #25); index
  proposals get the same supersede + approve-time freshness grammar file/field rows
  always had (no more zombie rows or stale-approve overwrites, #26); a frontmatter
  edit made _during_ a model call is no longer clobbered by the apply window (#27);
  **approving a proposal now teaches the daemon** the approved value is daemon-owned
  (it used to freeze the field forever — cooperation reduced maintenance, #28); an
  explicit **Run now** on battery is queued instead of silently swallowed by the power
  gate (#29); and approved filings carry the same `filed_by`/`filed_at` audit trail as
  auto-applied ones (#90).
- **State that survives a relaunch** — open spreadsheet/Activity tabs no longer vanish
  at startup (the viewstate validator knows all five tab kinds now, #34); a hand-set
  unknown key in `settings.json` (like the daemon's documented threshold knob) is
  round-tripped instead of destroyed by the next theme toggle (#35); renaming a board
  keeps its committed Main slot instead of letting the manifest GC eat it (#33); and
  the two long-lived persisted maps that never forgot a chat/folder are GC'd (#78).
- **Small but real** — ⌘K opens boards as boards, not dead note panes (#55); j/k no
  longer wedges on phantom rows in a linked library's `_`-folders (#45); the sidebar
  and All-notes counts agree (one universe, and Recent dropped its meaningless total,
  #60); collapse-all collapses Main too (#83); a real folder named "all" no longer
  collides with the All-notes query key (#77); Settings hotkey copy shows your actual
  chords after a rebind (#86); a chat pane header shows the stored title, not the
  de-dashed slug (#87).

### Changed / Added — the UX batch

- **Failures surface where you work** (#11) — a failed board write shows a data-loss
  strip over the canvas; a failed chat save renders an inline "won't survive a reload"
  note; a failed file-to-Brain or board rename lands as a dismissible sidebar note.
  Nothing important dies in the console anymore.
- **Re-onboarding keeps your notes where they are** (#12) — a 0.x update's onboarding
  now pre-seeds a selected **"Keep my current location"** card; clicking through can
  never relocate the corpus. (A true first run still requires the explicit choice —
  the v0.8.7 no-silent-default rule stands.)
- **Generic code fences render as code** (#13) — a `js block (or a bare `) keeps a
  mono voice; its contents are never markdown-styled, and a pipe-table _example_ inside
  any fence is never turned into a live table widget (the slash menu shipped the repro).
- **Links open** (#14) — **⌘-click** a markdown link (raw or beautified) to open it,
  with a tooltip that says so; plain click stays the edit path. Rendered links (chat
  bubbles, previews) open on plain click. Everything routes through one
  scheme-allowlisted Rust opener — http/https/mailto only, so a link can never launch
  a file path, app scheme, or flag.
- **Main folders are renameable** (#16) — inline rename (context menu or the row),
  and the ⊕ is now **name-first**: it opens an input instead of minting a permanent
  "New folder 2".
- **Honest labels** — the Aa panel's global rows say "· all notes" instead of hiding
  behind the per-note footnote (#52); a read-only sheet says _why_ ("view only · .ods"
  / "· too large", #53); the PDF pane takes keyboard focus so space/arrows page
  immediately (#54); the Captures board quietly explains that a curated card
  _graduates_ — it leaves the board and lives with your notes — and the cards carry
  the app's right-click menu (star · Add to Main · File to the Brain · archive), so
  graduating happens where the captures live (#56).
- **Small pleasures** (#80–#85) — a theme-aware checkerboard behind transparent
  images; middle-click closes a tab; Main's empty state only mentions the Brain when a
  Brain exists; Approve gets a quiet accent (no longer Dismiss's twin) and "· 78%"
  became "· 78% sure"; Run now stops claiming "Running…" forever and its errors render
  styled.

### Docs

- **The design doc tells the shipped truth** (#30) — `docs/design/main-brain-daemon.md`
  now marks `reach:` scoping (§4.2.6), the configurable battery budget (§6.3), and the
  Settings → Brain capability checkboxes (§4.8) as **Phase-5 deferrals** instead of
  implying they shipped with the daemon. `docs/model.md` refreshed for everything
  user-visible above.

## [0.19.0] — 2026-07-01

One release, three batches. **Phase 4 of the Main/Brain plan**
(`docs/design/main-brain-daemon.md`): the organizer daemon — your notes get organized
**while you're not looking**, on-device, logged, reversible, and easy on the battery.
Plus the files/metadata batch and an editor · search · viewer batch.

### Added — the organizer daemon (Phase 4)

- **The Suggest daemon** (`organizer.rs`) — an event-driven Rust background worker that
  runs three narrow jobs against the local model: **Classify** (staged `wiki/_inbox`
  captures → an area, or a `suggested_area` hint below the confidence threshold),
  **Enrich** (fill _empty_ `summary`/`tags`/`links` — a field you edited is never
  clobbered; link candidates come from keyword ranking, the model only confirms), and
  **Refresh index** (deterministic `wiki/<area>/_index.md` overviews — same members, same
  bytes, no thrash). Gated to run politely: per-note quiet period, user idle or app
  backgrounded, on AC, thermals OK, and it always yields to an interactive chat.
- **It preserves your computer** — the daemon never polls and is never "running 24/7."
  Work is scheduled only by the file watcher (a quiet-window debounce folds a typing
  burst into **one** run after the last save settles), by an Approve/Dismiss/Undo you
  make (which owes it one reconciliation sweep — the old 15-minute polling sweep is
  gone), or by **Run now**. With nothing staged it **parks outright**: zero wakeups, no
  tick, no timers, no settings reads, no `pmset` shell-outs (locked by a scheduler test —
  an idle corpus plans exactly `Park`). **Off on battery by default** (the design doc's
  §6.3 call); a hot machine backs it off; and it never keeps the model warm — no
  keep-alive/warm-up calls exist, so the model server's own idle-unload governs.
- **"Run now"** — Settings → Brain and the Brain Activity header both carry the explicit
  nudge: one pass immediately (even on battery — it's your deliberate call), then back to
  sleep. It still never interrupts an in-flight chat.
- **Approve/Dismiss review lane** — proposals land in **Brain → Activity** ("🧠 Proposes:
  File 'Foo' → Projects · 91%") with one-click Approve (files/annotates through the same
  gated Filer lane) or Dismiss; the sidebar Activity link carries an unreviewed-count badge.
  History rows stay undoable — including applied index rewrites.
- **Settings → Brain: the trust ladder** — **Off / Suggest / Tidy / Organize** (default
  **Suggest**), persisted and pushed to the daemon. Suggest applies **nothing** — journal
  proposals only, provably write-free on your notes. Tidy auto-applies annotations + filing
  brand-new captures; Organize applies everything — every rung journaled + undoable.
- **⌥A — summon chat** ("ask") — a new global chord: from anywhere, surface rotli and land
  in your most recently touched chat (or a fresh one). Rebindable like every action
  (Settings → Hotkeys → Chat).

### Added — files & metadata

- **Editable spreadsheets** — `.xlsx` and `.csv` open in an **editable grid** (typed
  values + bold/text-color/fill styling, multi-sheet) when the file's store is writable;
  a vault / linked-library / memex-`storage/` sheet keeps the read-only table. Explicit
  **Save** only (button or ⌘S — a binary rewrite never autosaves on keystrokes); the
  first save keeps a one-time **`.bak`** of the pre-rotli original beside the file (it
  shows up in Storage — that's your escape hatch). Unsaved edits survive a tab switch
  (the dirty session parks in memory until you Save). Formula cells are read-only in v1
  (styling them still works and never touches the formula). CSV is values-only and loads
  **exactly** — no type coercion (a `007` code or a 16-digit card number stays text),
  blank rows kept — with a one-click **convert to .xlsx** sibling when you want styles;
  `xls`/`xlsm`/`ods`/`tsv` stay the read-only viewer. Files over the 8 MB read cap (or the
  row/column caps) stay read-only — a truncated read can never be written back.
- **"Open externally" is a dropdown** — default app · **Reveal in Finder** · installed
  **"Open with …"** apps (Numbers/Excel/Preview/TextEdit — only what's actually on the
  machine, allowlist-gated in Rust so no caller-supplied binary ever runs).
- **Show file metadata** — a new toggle (Settings → General, or the note's metadata panel):
  the note's **raw frontmatter block** renders at the top of the file — monospaced,
  editable as plain text, exactly as it sits on disk. Commits ride a guarded lane that
  restores the reserved `id`/`owner`/`created` keys and refuses read-only notes; the
  metadata panel slims down to the Lock/Secure switches + Brain filing (the old key:value
  field editor is gone — the file itself is the editor now).
- **Drag ghosts everywhere** — dragging a Main row (reorder _and_ pull-in from the brain)
  or a Board capture card now paints the same floating label ghost tab-dragging always
  had: what you drag literally comes with you. One shared implementation
  (`lib/dragGhost`), pointer-events-transparent so drop hit-testing is untouched — and
  **Esc / pointercancel now abandons** those drags mid-flight, same as tabs.

### Added — editor · search · viewers

- **Full-text search, everywhere you type a query** — All notes, the sidebar filter, the
  palette picker, and Quick Note now search **note bodies**, not just titles, across the
  whole searchable universe (staged captures + the brain + the Vault + added folders).
  Title hits rank above body hits; a body hit shows a ±60-char snippet with the **match
  highlighted**. Trash is the one place search never surfaces (Archive stays findable).
  The ranking/snippet grammar is one pure core in Rust (`corpus_search`) with a TS twin
  for the dev surface — mirrored test vectors keep them in lockstep, and offsets are
  char-counted so no emoji ever shifts a highlight.
- **`html fences render** — same code ⇄ preview model as `svg: the markup renders in
  a **sandboxed, script-free** iframe (verified against the shipped CSP — no
  `allow-scripts`, opaque origin; fence content is untrusted the moment a note is
  shared); click the block to see/edit the source.
- **Tables you can actually edit** — inside a markdown table, **Tab/⇧Tab hop cells**
  (Tab past the last cell appends a row), **↑/↓ hop rows** in the same column, **Enter
  moves down instead of splitting a row** (and exits below the table from the last row).
  The rendered table carries row/column menus — insert · delete · move · align — the
  slash menu inserts a fresh scaffold, and every op serializes back to ordinary padded
  pipes (a deliberate edit only; never a background reformat).
- **Image zoom done right** — an image opens at its **natural size in points**
  (`naturalWidth ÷ devicePixelRatio`, matching Preview — a small screenshot is crisp,
  not inflated), with a live % readout in the header. Click the readout for 100%,
  pinch-zoom or ⌘+/⌘−/⌘0/⌘1 after clicking the image, and scroll-pan when zoomed in.
  (This deliberately revisits "small images fill the pane" — crisp-at-natural won.)
- **Honest big sheets** — a read-only sheet clipped by the row/column caps now says so
  in a banner instead of silently showing a slice; an over-cap `.xlsx` in a linked
  library refuses with a friendly message (not a zip error); sticky header row + column
  stay correctly layered under two-axis scroll, and a clipped read-only cell shows its
  full value on hover.

### Changed

- **Sidebar polish** — the live filter now narrows **Main** too (it used to skip the one
  section you curate by hand) and matches **snippets**, not just titles — with the j/k
  roving cursor kept honest (it never lands on a filtered-out row). Main's always-visible
  "+ New folder" row quieted down to a hover **+** on the section header (still
  Tab-reachable).

### Fixed

- **Main no longer forgets staged notes** — Main, tab titles, and the row menu now read
  the FULL note index (staged Captures + Archive + Trash + Vault), not just the default
  listing. A staged note placed in Main used to vanish from the row _and_ get GC'd out of
  `.rotli/main.json` on the next save (the "seeded Main emptied itself / tab says
  Untitled" bug), and "Add to Main" on a staged note was a silent no-op. A Main ref now
  survives anywhere its file actually lives.

### Notes

- **Secure/locked are absolute:** a `secure` note (or one that merely _looks_ secret) never
  enters **any** model — local included — at any trust rung; a `locked` note is never
  touched. That includes the _edges_: secure/locked notes are **omitted from the generated
  `_index.md` overviews** (a quick capture's title is often the secret itself) and their
  title-derived filenames are **kept out of the link-candidate lists** sent to the model.
  Activity quietly counts skipped secret-looking captures for you to review yourself — a
  durable count that stays up across cycles until the capture is actually reviewed. The
  daemon is local-only: no web tools, nothing leaves the machine.
- The daemon writes only through the contract-v3.7 Filer lane (`file_note` / `set_ai_field`
  / `write_index`); your interactive write lane is byte-identical, and Main
  (`.rotli/main.json`) is structurally out of its reach.
- **Stale proposals retire themselves:** edit a note after the daemon proposed something for
  it and the next pass dismisses the outdated row before proposing fresh — and Approve
  re-checks the note's current state (moved note / user-edited field ⇒ it refuses instead of
  applying a stale decision). Journal rows carry the note's ULID, so approving one proposal
  (which moves the file) never strands its siblings. Turning the ladder **Off/down
  mid-run takes effect at the next note**, not the next cycle — and a debounced settings
  save can no longer flip it back up.

## [0.18.2] — 2026-07-01

A whole-codebase dead-code + consolidation sweep (three parallel audits: TS dead code, TS
duplication, the Rust shell) — less to manage, nothing user-visible lost. The Rust side came
back clean (no unused deps; write paths already share one `atomic_write`/`relocate` core).

### Changed

- **One menu system.** The sidebar's old keyboard row-popover (RowMenu) is gone; the **m key
  now opens the same right-click menu**, anchored under the row — so keyboard users get the
  FULL action set (Star, Add to Main, Rename…, File to the Brain, Archive, Delete) instead of
  the old three-item subset. The menu host gained first-item autofocus, ArrowUp/Down
  navigation, and hands focus back to the row on close. Right-clicking an **archived/trashed**
  note now correctly offers **Restore** (it used to offer Archive again).
- **All notes + Recent are one component.** The two content lists had grown as twins; both now
  render a single `NoteListSurface` (All notes = the searchable flavor). Same look, one file.
- **One Main drag.** The "reorder Main" and "drag a note into Main" pointer gestures shared
  their whole move/hit-test body — now a single `startMainDrag(mode)` with two commits.
- Shared `useBrainAreas()` (the metadata panel and the right-click drill derived the area
  vocabulary separately) and one `invalidateBoth` for the lifecycle mutations.

### Removed (dead code)

- The **HTML5 note-drag dropzones** in the sidebar (`NOTE_DRAG_TYPE`/`dropProps`): nothing has
  started an HTML5 drag since the pointer-drag era — the handlers could never fire. (Moving a
  note is the ⊕/drag-into-Main gesture + Archive/Trash; a pointer-based move-to-folder can
  reuse the Main drag pattern when wanted.)
- The retired `chatAllOpen` browse state and the retired `"chat"` content view (chat is a pane).
- Unwired wrappers + helpers: `chatComplete` (the agentic `chatMessages` path replaced it),
  `showQuickWindow`, `memexInspect`/`memexListDir` + the service's `inspect`/`listDir`,
  `useCreateFolder`, `useMoveNote`, `addQuickNote`, `EMPTY_CONFIG`, six unused glyphs, and the
  `@types/katex` dev-dependency.

## [0.18.1] — 2026-07-01

### Fixed

- **Manual "File to the Brain" actually works now.** A `.md` note travels the app as its
  frontmatter ULID, but the Filer's commands expected a file path — so the metadata panel's
  filing section never recognized a staged note, and 0.18.0's right-click drill never showed.
  Every filing entry point (`set_ai_field` / `file_note` / `filer_move`) now resolves through
  a ULID→rel bridge (new `corpus_note_path`), the panel and menu detect staged notes by their
  real path, and the journal keeps recording paths for undo. Locked by a Rust test that files
  and un-files a note by its ULID. The right-click "File to the Brain" drill also appears on
  notes already in an area (re-file to another area).

## [0.18.0] — 2026-07-01

A reported-issues sweep before Phase 4 (the organizer daemon): everything open from the
left-menu / Quick-access / hotkey reports, resolved.

### Added

- **j/k keyboard nav reaches Main.** The sidebar's roving cursor now walks your Main rows
  (notes and folders, in your arrangement order) the same as the rest of the tree — j/k to
  move, Enter/l to open, h to collapse a Main folder, m for the row menu. Main notes ride
  with their own roving ids, so a note pinned in Main and visible in the Brain are two
  distinct stops.
- **Contextual ⌘+ / ⌘− zoom.** Zoom _where you are_: with focus in the sidebar it scales the
  whole section tree (persisted, clamped 0.8–1.4×); in a note it steps that note's body-text
  size (the per-note Aa render layer — never written into the .md). "Reset zoom" is in the
  palette; all three are rebindable in Settings → Hotkeys.
- **Right-click works on boards and tabs.** A board row now opens the full context menu
  (Open in new tab · Add to Main · Rename… · Delete — Rename drops into the familiar inline
  input), and middle-click opens a board in a new tab like notes. **Tabs** got their own
  right-click menu: Rename… (boards and notes) · Close tab · Close other tabs.
- **"File to the Brain" from the right-click menu.** A staged note's menu now carries the
  area drill (the 0.17.0 fast-follow) — pick People/Projects/… right from the row; same
  Filer gate + Activity journal as the metadata panel, one shared code path.

### Changed

- **Captures shows only real captures.** A staged note you've **curated** — added to Main or
  ★ starred for Quick access — is a full note you keep, so it leaves the Captures board (and
  the sidebar count). Your "main note — seth" no longer poses as a sticky note.

### Fixed

- **Tab drag-reorder landed one slot right of the preview line** (the hit-test counted the
  dragged tab itself; audit CMP-1) — now it lands exactly where the line showed, locked by
  a new `moveTab` test suite.
- **Row menus could overflow the window edge** (audit CMP-4) — the sidebar row menu now
  clamps into the viewport and flips above its row near the bottom.
- **A fresh Main folder ignored its first click** — folders default open, but the toggle
  assumed closed; the first click now collapses as expected (keyboard h too).

## [0.17.0] — 2026-07-01

### Added

- **Right-click context menu on notes.** Right-click any note (in the Brain, a folder, Main, All notes or
  Recent) for: **Open in new tab · ★ Star / Unstar** (Quick access) **· Add to / Remove from Main ·
  Rename… · Archive · Delete**. Files get a slimmer menu (open / star / Main / delete). Built on a small
  context-menu host + a shared `useNoteMenu` hook, so every list wires it the same way; drill-in sub-lists
  are supported for future submenus.
- **Rename from the menu.** "Rename…" opens a small dialog that rewrites the note's title (its first line),
  preserving a `#` heading if it had one. (Pure `replaceTitleLine`, unit-tested.)
- **Open in a new tab without a modifier.** Besides ⌘-click, **middle-click** a row now opens it in a new
  tab, and the menu's "Open in new tab" does the same — build up multiple tabs by clicking, no need to make
  a blank tab first.

### Notes

- **Move-into-a-Brain-area** from the right-click menu is a fast follow (it needs the note-id → path bridge
  the Filer uses); today, file a note into an area from its metadata panel's **File to the Brain**.

## [0.16.0] — 2026-07-01

### Added

- **All chats — a searchable list, the twin of All notes.** Clicking **All chats** in the sidebar used to
  just toggle an inline expand (and did nothing when you had only a few chats). It now opens a proper
  content view: every chat in a searchable list, click a row to open it in a pane. (New `AllChatsSurface`
  - an `allChats` content view.)

### Changed

- **Every pane surface fills its pane.** Follow-through on the chat-centering fix: images, PDFs,
  spreadsheets, markdown, canvases and the activity log all render in a full-width pane body — no more
  content-width collapse.

### Notes

- **CSV & Excel render in-app.** (Already built; now demoed.) A `.csv`/`.xlsx` opens read-only as a table
  with a tab per sheet. Two sample files are seeded into Main to show it off.

## [0.15.0] — 2026-07-01

### Changed

- **"Quick access" is now two things done right — Main + starred Quick access.** The sidebar section is
  back to **Main**: your hand-picked notes, arranged your way. **Quick access** is now what it should be —
  a **capped set (≤5) of starred notes** that live in Main. **★** a Main row to star it; anything starred
  is what the **⌥ Quick window** opens and cycles. Star / unstar any time; it layers on top of Main's
  arrangement without moving anything.

### Fixed

- **Chat is _really_ centered now.** The prior fix centered _inside_ the chat surface, but the surface
  itself had no `flex: 1` in the pane row — so it collapsed to its content width and pinned left, dead
  space on the right, and the internal `margin: 0 auto` had no room to work. Every pane surface
  (chat, file, canvas, activity) now fills the pane, so the chat column truly sits centered.

## [0.14.1] — 2026-07-01

### Fixed

- **Chat is actually centered now.** The conversation was left-pinned once it had messages — a flex-item's
  default `min-width: auto` let wide message content push the thread past its `max-width`. Switched to plain
  block centering (`margin: 0 auto` + `min-width: 0`), so the column is locked at its reading width and
  centered whether the chat is empty or full.
- **Only one chat row highlights at a time.** "All chats" no longer stays selected while a specific chat is
  open — it lights up only when you're actually browsing all chats (no chat active).

## [0.14.0] — 2026-07-01

### Changed

- **Onboarding picks your theme first.** The appearance step moved right after the welcome, so you set a
  theme you like _before_ walking the rest of setup — no more trudging through it in one that hurts your eyes.
- **Sidebar: "Quick access" + a collapsible Brain.** The "Main" section is now **Quick access** — your
  hand-picked, most-needed notes (add with **⊕** on a note row, or drag one from the Brain). The **Brain**
  is now a **collapsible row inside Destinations** (its Activity link + areas fold away when you don't need
  them).
- **Captures look like sticky notes.** The capture cards get a warm paper fill, real lift, and a slight
  hand-placed tilt — a board of sticky notes you can drag to arrange, not flat dark panels.
- **Cleaner chat.** Removed the divider lines (above the composer, under the header); the title now aligns
  to the same centered column as the conversation.

### Fixed

- **The quokka's face reads again.** The onboarding + empty-state quokkas were rendering with a heavy
  stroke that filled in the eyes and nose dot — swapped to the original artwork (a clean `evenodd` fill)
  recolored to `currentColor` so it still follows your theme. (The app icon was already correct.)

## [0.13.0] — 2026-07-01

### Added — Phase 3: manual filing + the Brain **Activity** log (see & undo the AI)

- **File a note into the Brain, by hand.** In a staged note's metadata panel (the Aa chip → metadata),
  a **"File to the Brain"** row lets you pick an area — the note files into `wiki/<area>/` through the
  v3.7 Filer gate, and its open pane retargets to the new location. A filed note shows **"🧠 Filed in
  <area>."**
- **Brain Activity** — a new pane (open it from **Brain → Activity** in the sidebar, or "Brain Activity →"
  in the metadata panel) that logs every Filer action to `.rotli/brain-journal.jsonl` and lets you **undo
  any of it**: a filed note moves back, a set field restores. This is the **trust surface** — see and
  reverse every AI write _before_ any of it becomes automatic (the background daemon is Phase 4). New Rust
  `filer_move` + journal append/read + a `surfaceKind:"activity"` pane; `src/services/brainJournal.ts`.

### Changed

- **Drag a note from the Brain (or any list) into Main.** Cross-section pointer-drag: grab a note in the
  Brain and drop it into your Main view — before/after a row, or into a Main folder (the **⊕** still works
  too). Areas like **People** stay auto-maintained _in the Brain_; **Main is your curated subset of
  individual notes**, never a mirror of the areas. (Replaces the dead HTML5 note drag with the pointer
  pattern that works in the WKWebView shell.)

## [0.12.0] — 2026-07-01

### Added — contract v3.7: the AI **Filer** write lane (capability only, no daemon yet)

- **The write-lane foundation for the background AI organizer** (Phase 2 of the Main/Brain/daemon plan,
  `docs/design/main-brain-daemon.md`). A second, narrower write actor — the **Filer** — may now write the
  curated `wiki/**` brain (which stays read-only for _you_), gated separately from your own writes. **Two
  actors, two gates, disjoint key-sets:** you write `chats/`+`_inbox` and never the curated brain; the
  Filer writes the brain (`area`/`summary`/`tags`/`links`/…) and never your Main arrangement, and it
  refuses any `locked` note. New Rust `filer_writable` gate + `set_ai_field` (AI-keys-only) + `file_note`
  (fs-atomic filing move into `wiki/<area>`, preserving id, not bumping `updated`) + `write_index`
  (`wiki/<area>/_index.md`), mirrored in `contract.ts` (`canFile`/`mayFile`/`AI_KEYS`/`USER_KEYS` + a
  `chats+inbox+file` perms tier only the daemon host runs with). `owner` is now reserved/immutable.
- **Nothing calls these yet** — the manual "file this note" + journal/undo (Phase 3) and the Suggest
  daemon (Phase 4) come next. The contract band extends to **[3.4, 3.7]**; we do **not** flip a brain's
  stored `memex.json` version (a 3.6 brain stays fully writable, so the Filer works today — the stored
  flip is a later coordinated step once Breve/voz ship). memex-vault's `STRUCTURE.md` moves to v3.7 in
  lockstep. Tests assert the two lanes stay disjoint (user closed to `wiki/**`, Filer allowlist enforced).

## [0.11.0] — 2026-07-01

### Added

- **Main — your hand-arranged view over the Brain.** A new sidebar section above the Brain where you
  arrange notes into your _own_ folders and order, independent of how the AI files them underneath. It
  holds no files of its own — it references your Brain notes by id, so it's **"one file, two views"**
  (edit a note in Main or in Brain, it's the same file). **⊕** on any note row adds it to Main; **drag**
  rows to reorder or move them into Main folders; **+ New folder** makes a Main-only folder. Persisted to
  a committed `.rotli/main.json` so your arrangement travels with your memex. This is Phase 1 of the
  Main/Brain/daemon architecture (`docs/design/main-brain-daemon.md`) — the background local-AI organizer
  that keeps the Brain filed lands in later phases; because Main references notes by id, it will stay
  exactly as you set it while the AI reorganizes underneath. (The pinned Brain README + full drag-into-
  Main from other sections + j/k keyboard nav for Main are follow-ups.)

### Fixed

- **Images and PDFs use the pane.** A small-resolution image (e.g. a Breve newsletter) no longer renders
  tiny at its natural size — it fills the pane (object-fit, so it scales up and stays readable); PDFs and
  the iframe fallback get a full-bleed block body instead of being shrunk by the centered layout.

## [0.10.1] — 2026-06-30

### Fixed

- **Metadata panel no longer hangs on "Reading…".** Opening it on a secret-adjacent note triggers the
  auto-secure-flag, which writes + updates `.gitignore` _during the read_; 0.10.0's security hardening made
  that write propagate errors, so any hiccup errored the whole read — and the panel had no `.catch`. The
  read-path auto-flag is now best-effort (still persists + logs; explicit "Mark secure" still hard-fails),
  and the panel surfaces the error instead of hanging forever.
- **Quick Note chord no longer _occasionally_ opens the main window too.** 0.10.0's visibility guard had a
  race — the spurious macOS `Reopen` could fire before the panel registered as visible. Added a
  deterministic backstop: a summon timestamp stamped before the panel steals focus + a grace window in the
  reopen handler (belt **and** suspenders).
- **The Brain hides internal scaffolding.** `_inbox` (note staging — surfaced as **Captures**) and
  `_templates` no longer appear as Brain areas (underscore-prefixed = internal, not user-facing).
- **The "Vault" (linked-library) destination is hidden until one is connected** — an empty Vault row next
  to your own `memex-vault` folder was just confusing. It returns automatically when a second memex is linked.

## [0.10.0] — 2026-06-30

### Changed

- **The Brain shows in the sidebar.** Your AI-organized wiki areas (People · Projects · Research ·
  Engineering · Theology · Reference) now render as a navigable **Brain** section under Notes — before
  they were invisible (the sidebar never asked for the `wiki` folder tree). Area labels are prettified.
- **One "Captures."** The duplicate capture concept is gone — there was a "Captures" row (under
  Notes, read the `Board` folder → always 0) AND a "Capture" destination (the `Inbox` folder). Now
  there is a **single Captures** under Notes: the default `Inbox` shelf projects there, and the bottom
  "Capture" destination is removed.
- **⌥C quick-capture lands in Captures.** A quick capture is now a **staged note** in `wiki/_inbox/`
  (it shows under Captures immediately) instead of appending to `inbox.md` (which surfaced nowhere).
- **"All notes" is a searchable list.** Replaced the card grid with a clean list (title + date) and a
  full-width search; binary files (mp3/pdf/png/…) are filtered out (they live under **Storage**). Recent
  filters files too.
- **Chat is centered + clean.** The conversation column is now reliably centered (flex-center), matching
  the md editor's reading measure.
- **Storage organizes itself.** The Storage section now groups your files — **by Type** (Audio · Images ·
  PDFs · Documents · Other) by default, or **by Date / by Folder** via a new Settings knob (Location →
  Storage). Computed in the frontend (`src/services/storageTree.ts`); your files never move on disk.

### Added

- **In-app file viewers (universal).** Clicking a surfaced file opens it in a right-pane **file surface**
  instead of shelling the OS default app: audio gets a real player with a play button (no more Apple
  Music), video/image/pdf render inline, text reads in-pane, and **anything else** falls back to an
  asset `<iframe>` preview + an "Open externally" escape hatch. New `file` pane surface
  (`src/components/FileSurface.tsx`) + `corpus_file_text`/`corpus_file_bytes` reads + `media-src`/
  `frame-src` `asset:` in the CSP.
- **Spreadsheet viewer + chat review.** `.xlsx`/`.xls`/`.csv` render as a clean read-only table (SheetJS,
  Apache-2.0; `src/lib/sheets.ts`). A new **`read_file`** agent tool lets the on-device chat read a file
  by name (text, or a spreadsheet as CSV) so it can answer questions about it — look, don't act.

### Fixed

- **The Quick Note chord opens ONLY the Quick Note.** Summoning the floating note (⌥Q, or a rebound chord
  like ⌥.) activates the app, which fired a spurious macOS `Reopen` — and the main window came up too,
  defeating the whole point. The reopen now uses our OWN window-visibility check (the OS
  `has_visible_windows` flag excludes the `alwaysOnTop`/`skipTaskbar` panel), so the chord surfaces the
  floating note alone.

### Internal (code-health pass)

- A codebase audit drove a cleanup. **Hardened security:** `gitignore_add` now propagates its write error
  (+ a symmetric `gitignore_remove` when a note is un-secured); the web-egress secret guard keys off
  `WEB_TOOLS`. **Removed dead code:** the unwired `captureToInbox`/`inbox.md` chain (TS + Rust command +
  state + persistence), 5 orphaned memex `invoke` wrappers, the ~120-line pre-CodeMirror line renderer,
  the `contextWindow` budget override, and assorted dead exports. **De-duplicated:** one `dateLabels.ts`
  (5 drifting copies), `openSummary()` for open-by-kind (also fixes a file ⌘-new-tab regression),
  `formatGlyphs`, `fileKind`, Rust filename/id helpers (`free_name`/`unique_id`), `forget_brain`→
  `forget_root`, and cached web.rs regexes. **Fixed:** the broken Ctrl+2 chat hotkeys; 5 silent
  save-failure `catch`es now log. Net −25 lines across 49 files; all tests green.

## [0.9.0] — 2026-06-29

### Added

- **The agentic memex client** — Chat is no longer a context-free one-shot. The on-device model now runs
  a multi-step **tool-use loop** over your memex (its knowledge base) and, opt-in per chat, the web:
  - **`search_notes` / `read_note`** — the model searches and reads your notes (their organization +
    metadata) to answer. Secure notes stay readable by the _local_ model (the remote gate still holds).
  - **Web search — DuckDuckGo, no API key** — a per-chat **globe** toggle in the composer (off by
    default) lets a chat reach the internet (`web_search` / `web_fetch`); the model only uses it when
    your notes don't cover the question.
  - **Image attachment** — a composer paperclip gated on a **vision-capability check**: only a
    vision-capable model accepts images; otherwise the UI prompts you to pick one.
  - Engine lives in `src/ai/` (host-agnostic — liftable to the shared `~/.memex/ai` client layer),
    driving a tolerant single-JSON-object ReAct protocol tuned for Gemma; a live status line replaces the
    static "thinking…" (no token streaming yet).
- **Web primitives in Rust** (`src-tauri/src/web.rs`) — `web_search` (DuckDuckGo lite + html fallback)
  and `web_fetch` (HTML→text), both behind a **secret-egress guard**: a query/URL that trips the secret
  detector is never sent to the web. The detector is now shared (`src-tauri/src/secret.rs`) by the
  secure-note flag and the web guard.
- **Multi-turn model bridge** (`chat_messages`) — flattens the transcript for MLX `/api/generate` (with
  JSON coercion), or sends a real messages array to llama.cpp **with the Bearer key** (fixes a latent 401) plus image content-parts, and lazy-kickstarts the on-demand llama.cpp server.
- **Vision serving** — gemma-3 is multimodal. Because the shared MLX server runs in a frozen py3.9 venv
  (Breve's) where the gemma3 mlx-vlm path can't install, vision runs in an **isolated py3.11 sidecar**
  (`~/.memex/ai/mlx-vlm-venv` + `mlx-vlm-server.py` on :11437); the text server **proxies** image
  requests to it and lazy-spawns it. The text path (mlx-lm) is byte-for-byte unchanged, so Breve/voz are
  unaffected. One-time setup: `~/.memex/ai/setup-vision.sh`.

### Changed

- The Chat composer gained the **globe** (web) and **paperclip** (image) controls beside the model
  selector; `chat_models` and the memex-ai registry now carry a **`vision`** capability (gemma-3 flagged).

## [0.8.9] — 2026-06-29

### Changed

- **Chat is a centered modern column** (ChatGPT/Claude style): the conversation + composer share a
  max-width and center in the pane; the **model selector moved into the composer** (bottom); AI
  replies render as **plain text** in the column, only your messages are bubbles.
- **Tighter chat prompt** — the on-device model answers only from the conversation and says "I don't
  know" rather than inventing facts/file names (the earlier "Fabel 5… see STRUCTURE.md" was a small
  model hallucinating with no real context).

### Fixed

- **The welcome quokka's face reads again** — 0.6.3's uniform `stroke-width:12` had filled in the eye
  cutouts; dialed `stays_local` back to 4 (the body's weight is the fill, so the face returns with
  minimal body change).

## [0.8.8] — 2026-06-29

### Added

- **onboardingVersion gate** — onboarding now re-runs reliably across updates. While `0.x` (beta),
  **every version change re-onboards** (the flow is still evolving); once `1.0`, the bar freezes at
  `1.0.0` so updates never re-onboard — **only a fresh install does**. The build version is injected
  at compile time (`__APP_VERSION__`), persisted as `onboardingVersion`, and compared on launch.

## [0.8.7] — 2026-06-29

### Fixed

- **Onboarding now requires choosing where rotli lives** — no more silent `~/Documents/rotli`
  default. The location step is required: **"Skip setup" jumps to it**, **"Continue" is gated** until
  you pick, and the third option is **"Use a plain folder…"** (choose a location) instead of a silent
  default. So every start is an explicit choice — use an existing memex · create a new one · or a
  plain folder.

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
  Vault tree. Memory is how things are _saved_, not a front.
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
  your one folder _is_ your brain (or a plain notes folder if you defer). New Rust `corpus_init_memex`
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
  - **Other brains** / **Connect a brain…**. The four separate folder pickers, the "rotli sync" card, and
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
  Plugins), organized around the idea that your notes folder _is_ — or can become — a **brain** (a memex):
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

_(Increment 1 is the structural left-menu rework only. Streaming chat, `@note`/`@board`/`@email`
context, the chat-owns-a-summary-note model, Breve `history/` rendered in Chat, and the real email
integration are later increments. Plan: `docs/notes-chat-inbox-rearchitecture.md`.)_

## [0.5.0] — 2026-06-26

The Chat front begins — a real on-device chat (Increment 1).

### Added

- **Chat actually talks now.** The Chat front (module switcher → **Chat**) is a real conversation:
  type a message and the **on-device model replies** — the same local MLX/Gemma server Breve uses,
  bridged through **Rust** (the webview's CSP can't reach `localhost`, so a `chat_complete` command
  POSTs the model). Messages render as **bubbles**; the thread **persists as `chats/<slug>.md`** in
  your memex (rotli's owned surface, v3.5 contract) and reloads from there. The left list is your
  **history**. Needs your local model running on `:11435`; if it's not, the chat says so in-line.
  _(Increment 1 — one-shot replies, no streaming yet. Next: streaming · `@note`/`@board`/`@email`
  context · the chat-owns-a-summary-note model · Breve `history/` rendered in this surface · the
  3-section left menu. Plan: `docs/notes-chat-inbox-rearchitecture.md`.)_

## [0.4.3] — 2026-06-26

### Added

- **Rename a board from its tab, too** — double-click a board's tab to rename it inline (joins the
  sidebar right-click rename from 0.4.2; both share one flow). And **⌘⇧N makes a new board** (⌘N stays
  new-note), opening it straight into its name field.
- **Board metadata for the AI** — each board now carries a **description + tags** via a small **ⓘ**
  button (bottom-right of a board). A board is just an image to a text LLM, so this is how it'll know
  what a board is about and pull it into a chat as `@board` context later. Stored top-level in the
  `.excalidraw` file (not Excalidraw's appState, which it strips) and preserved across drawing edits.
  _(Wiring it into rotli's own ⌘K search arrives with the Chat front.)_

## [0.4.2] — 2026-06-26

### Added

- **Name and rename your boards.** A new board's sidebar row opens an inline name field
  the moment you create it (name it first, no more "untitled"), and **right-click any board
  → rename** in place (Enter commits, Esc / click-away cancels). The `.excalidraw` file is
  renamed on disk and any open canvas tab follows the new name. (New `corpus_rename_board`,
  unit-tested.) _(Renaming via the tab, a dedicated new-board chord, and board metadata for
  AI search are the next step.)_

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
  from the tree. (A toggle to _reveal_ the AI metadata on a note is still to come — it's
  stripped at the read layer today.)
- **The connected memex is now `memex-vault`** (was `smBrain`). The maintainer's brain
  moved to `~/memex-vault` (repo `SethMed7/memex-vault`) to read as what it is — a private
  instance of the open-source **memex** structure. rotli's auto-bind default and all
  references follow it; the `vault:` root scheme and the **Vault** UI label are unchanged.
  A memex's binaries now live in an internal, gitignored `storage/` (the `storage:` root),
  so a connected memex is one self-contained folder. (No corpus migration — rotli keys the
  Vault by root _name_, not path; re-point it in Settings → Storage if you'd bound the old
  path, or rebuild so the new `~/memex-vault` default auto-binds.)

## [0.3.0] — 2026-06-25

The memex release — rotli now reads, writes, edits, and creates notes inside a connected
memex (your `~/memex-vault`) per the v3.5 note contract, plus the Vault, Excalidraw boards,
nested folders, and inline diagrams/math from the increments since 0.2.2.

### Added

- **Notes show by your folders, not the brain's filing** (memex integration, Phase 2 —
  shelf-projection, read side) — a note in a connected memex now appears in the sidebar
  under its `shelf:` (the folder _you_ put it in), never its disk path. So a note rotli
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
  and a `+` appears where the count was: one click drops a new folder _inside_
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
