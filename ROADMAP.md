# Roadmap

Direction, not commitment. Nothing here has a date, and order within a section
is rough priority. What's already released lives in [README.md](README.md); how
things get built lives in [AGENTS.md](AGENTS.md) and [docs/](docs/README.md).

| Word | Meaning |
|---|---|
| In the work | Being built. Lives in development builds only, not released, so not done. |
| Planned | Decided, not started. |
| Idea | Not decided yet. |

**Size:** S = hours · M = days · L = 1–3 weeks · XL = a month or more

## 1. In the work

- **Sheets** · L — spreadsheets (XLSX) inside Rotli. CSV editing already ships.
  Left: finish, polish, release.
- **Mermaid visual editor** · M — edit a Mermaid diagram by hand on a canvas
  instead of only in code. View and Code already ship.
- **MCP / Grok Bot plugin** · L — lets an AI agent work in the vault through
  Rotli's own rules: the `rotli mcp` server, the agent commands, and the remote
  relay a Grok Bot connects through
  ([contract](docs/architecture/agent-workspace.md)). Includes a custom Grok Bot
  that manages Rotli: create, file, search, and organize notes.
- **Read aloud** · M — select text and have it read to you, on-device.
- **Breve in public builds** · M — the morning brief and routines. Runs in
  development builds today.

## 2. Planned

- **Add-ons system** · L — one way for the user to install and manage add-ons
  locally. Email providers, drive providers, and the Grok Bot all plug into it
  instead of each being a one-off. Comes before email and drive sync, because
  it decides how they get built.
- **Backup now** · M — a scheduled zip of the vault to a folder or external
  disk the user picks, plus a "Back up now" button. The cheap first step toward
  drive sync: protection if you lose the computer, long before full sync
  exists.
- **Email inbox** · XL — a calm layer over your own email. Rotli reads and
  organizes it, never hosts it, and an email can be linked from a note the way
  notes link to each other. Same calm rules as the rest of the shell: no
  badges, no unread anxiety. Restore blueprint for the sidebar section:
  [docs/archive/notes-chat-inbox-rearchitecture.md](docs/archive/notes-chat-inbox-rearchitecture.md)
  (the `sec:inbox` expansion key is still honored by the persistence layer).
- **Drive sync** · XL — sync notes to Google Drive, OneDrive, Proton Drive, and
  others. The purpose is backup: your data also lives somewhere not tied to the
  computer, in case you lose the computer. Never on by default. The user
  connects it and controls it. It does not lower security.
- **Send email from a checklist** · L — makes checklists actionable: you do the
  task without leaving the list. Sent through add-ons the user sets up and
  manages locally, for example Proton Bridge; not a built-in full integration.
  After sending, the task is checked and becomes a link to the email, with the
  subject as the link text. A setting chooses where that link opens: the email
  app, Rotli, or a drop-down to pick each time.

  ```
  /email:send {person}-{subject}--body

  [ ] Email Gabriel - "/email:send {person}-{subject}--body"
  [x] Email Gabriel - {hyperlink to email}
  ```

- **Open with Rotli** · L — right-click any file on the Mac and open it with
  Rotli. Works like VS Code: the file stays where it is, outside the vault, and
  edits change the real file. The tab gets its own color so you can tell it is
  an outside file. ⌘S offers to put a copy in the vault, and you pick where it
  goes. Only if wanted.

## 3. Ideas

- **Pull Chat out into its own window** · L — hold and drag "Chat" out of the
  Home | Chat switch into an independent window that shows only what belongs to
  it; even its tabs are only chat tabs. An icon groups it back into its original
  place. Home can never be pulled out: the main app is where Home lives.
- **Per-note version history** · L — local snapshots of a note with a diff
  view, so nothing typed is ever lost.
- **Import from Obsidian, Notion, and Apple Notes** · L — bring an existing
  library in, links and images included.
- **Backlinks panel** · M — every note that links to this one, plus places that
  mention it without a link.
- **Actionable checklists as a family** · L — `/email:send` is the first one.
  The same pattern for `/remind`, `/event`, and `/open`, so a checkbox can carry
  an action.
- **Chat can look inside a folder** · M — access is managed via metadata, not a
  grant per chat. Still to define.
- **Beta channel** · M — a setting that lets testers opt into in-the-work
  features like Sheets. Today those only exist in development builds.
- **Shortcuts and Raycast hooks** · M — extend the `rotli://` link so other
  apps can create a note or a capture, for example `rotli://new?title=`. Only
  open and reveal exist today.
- **Touch ID on secure notes** · M — secure notes are hidden from remote AI
  today, but anyone at the Mac can open them. Ask for Touch ID first.
- **Due dates on tasks** · M — write `due friday` on a task, and the Tasks page
  gets a Today group. Pairs with actionable checklists.
- **Task board view** · M — the Tasks page as columns: open, in progress, done.
  The in-progress `[/]` state already exists in notes; the Tasks list needs to
  carry it (today it folds `[/]` into open), then this is one more view over
  the same notes.
- **Librarian weekly digest** · M — what you wrote this week, notes nothing
  links to, and stale tasks, delivered through Breve.
- **Tags browser** · M — a place to see every tag and the notes under it. Tags
  already exist in note metadata.
- **Freeform canvas** · XL — drop notes, sheets, PDFs, and images on one
  board, connect them, group them into frames, and present the frames as
  slides, like AFFiNE's Edgeless. Built inside Excalidraw. First slice (M–L, no
  contract change): real-size images on boards, drops onto a board, frames +
  Present. File cards and connectors need two
  owner calls: whether a connector is a link, and what a card may show
  ([evaluation](docs/design/canvas-tasks-logseq-eval-2026-09-23.md)).
- **Query fence** · M–L — a `query` code block that shows a live table of
  tasks or notes (`tag:`, `area:`, state, due), using the grammar
  `rotli notes query` already has. With **Export to .xlsx** (S–M) it gives a
  task table that opens in Excel while tasks stay in notes.
- **Daily journal** · S–M — a Journal folder, a "Today" command that opens or
  creates today's note, and Quick Note can land there. Logseq's best-loved
  habit.
- **Sheet templates** · M — "New from template": task tracker, weekly planner,
  habit tracker, with status dropdowns, colours, and a frozen header, saved as
  real .xlsx. Needs Sheets released, and dropdowns and colour rules carried
  through the grid first.
- **Block references** · L — point at one paragraph with `^id` and show it
  elsewhere with `![[note#^id]]`, in the same syntax Obsidian reads.

## 4. Known bugs

- **Confusing errors when files move** — these are just files moving; no one
  will know what these messages mean, so they should never show.
  - Part 1 · S: a view folder name can be typed with `/` or `:`, which Rotli
    then refuses on save. Fix: stop it when the folder is named, with a plain
    message.
  - Part 2 · M: when something else (the CLI or the Librarian) changes Main
    while the app holds an older copy, a raw revision conflict shows. Fix:
    re-read, merge, and retry quietly; plain wording if it ever still shows.
- **First drag and drop lands too high** · M — on the first drag, the drop does
  not line up with the pointer. Needs a reproduction first.
- **Image tags show up in the chat name** · S — a chat that starts with an
  image gets the raw image tag as its name.
- **Big images do not save on a board** · S/M — an image over about 75 KB goes
  over a board's 100k-character string limit, so the save fails. The board
  validator rejects a 110 KB image (`src/boards/validation.ts`; Rust twin in
  `src-tauri/src/board.rs`); not yet reproduced in the app. Fix S: let image
  data past the per-string limit (files still open in Excalidraw). Fix M:
  images as vault assets (smaller boards, but other apps show broken images).
- **A file dropped on a board lands somewhere else** · S — on the Mac a Finder
  drop onto a focused board has no board branch and falls through to another
  note or Assets. Suspected, not yet reproduced.
- **A typed `[[Board]]` link may open the board as a note** · S — the `[[`
  picker leaves boards out, but a typed link still resolves and opens as a note
  tab. Suspected, not yet reproduced.

## 5. Small enhancements

- **Remove the count on "Chat"** · S — the number in the Home | Chat switch. It
  will not hold up at 1k chats.
- **Name chats by meaning** · M — name a chat from the purpose of the first
  prompt, not its first few words.
- **Hotkey to switch views** · M — ⌘⇧W opens the views, then ⌘number picks one.
- **Hotkey to jump into the sidebar** · M — ⌘⇧S enters the sidebar, then
  ⌘number opens one of the top 9 notes in the current view. Reorder and pin
  notes in the sidebar so 1–9 stay put.
- **Two-step hotkeys** · M — needed first by the two hotkeys above. ⌘1–9
  already jump tabs, and Rotli has no "press one chord, then another" yet.
- **Send feedback in-app** · S — a button that opens a prefilled GitHub issue.

## 6. Keeping the web version in sync

- **Parity list** · L — every native command is marked "has a web version",
  "refused on web with a notice", or "Mac only on purpose". A check fails when
  a new command has no decision.
- **No silent gaps on web** · M — about 40 features quietly do nothing on web
  today. They should say "In the Mac app".
- **A real web contract doc** · M — the only one today is an old plan that
  still says web has no chat.
- **Rule:** every user-facing change is proven on the web build too, and adds
  or extends a web test.

## 7. Platforms

- **Windows** · XL
- **Linux** · XL
- **Mobile / Tablet** · XL — depends on drive sync: the notes come from a
  connected drive (possibly a home NAS). There will be a slight delay, so it
  needs a "Sync now" button. Later: instant sync through cloud options, only
  once the structure is consistent and the project is big enough to invest in
  cloud infrastructure; to explore through partnerships for secure cloud.

## 8. Later — to be placed

- **Handwriting to text notebook** — write by hand, keep real notes.
  Handwritten pages (Pencil on iPad, imported scans on Mac) are recognized
  on-device into Markdown that lands in the same memex. The handwriting stays
  as the artifact; the text becomes searchable and linkable. Recognition never
  leaves the machine.
- **Publish to Substack** — a note-level verb, not a surface. Deliberately
  parked (decided 2026-07-31): Substack has no official publish API, and every
  existing route is reverse-engineered private endpoints or browser automation,
  so we don't build on it. It lights up when Substack's official MCP gains
  write/publish. Design already sketched: a ⋯-menu/palette verb; draft-first,
  never auto-publish; credentials in Keychain; `secure:` notes blocked by the
  existing remote gate; state in `.rotli/`, never frontmatter; behind a
  provider abstraction so Ghost and Buttondown can follow. Interim option:
  "Copy for Substack" (rich-HTML clipboard), which touches no endpoints.
- **Calendar integration** — cal.diy base; Apple, Google, and Proton providers.
- **Secure organization** — needs its own session with injection evals before
  any build.
