# Roadmap

Direction, not commitment. Nothing here has a date, and order within a section
is rough priority. What's already released lives in [README.md](README.md); how
things get built lives in [AGENTS.md](AGENTS.md) and [docs/](docs/README.md).
The same list is on [rotli.co/roadmap](https://rotli.co/roadmap/), built from
this file, where anyone can vote for an item or ask for something new.

| Word | Meaning |
|---|---|
| In the work | Being built. Lives in development builds only, not released, so not done. |
| Beta | Ships in a release, labelled Beta in the app: usable, still being finished. |
| Planned | Decided, not started. |
| Idea | Not decided yet. |
| Coming soon | Decided and next in line for its platform; still no date. |

**Size:** S = hours · M = days · L = 1–3 weeks · XL = a month or more

**Item ids.** Every item carries a hidden id right after its title:
`- **Title** <!-- id: some-id --> · Size — summary`. The id is lowercase
words joined by hyphens, unique in this file, and it never changes once
published: votes on rotli.co attach to the id, not the title, so retitle
freely but keep the id. A
new item gets a new id; a finished item is removed with its id (never reuse
one). The sentence right after the dash is the summary the website shows, so
it should stand on its own. The site build fails if an item has no id or an
id repeats (`site/src/roadmap.ts`).

## 1. In the work

- **Graph and Canvas** <!-- id: canvas --> · L — see how your notes link up as
  a graph, and lay them out on a canvas saved as `.canvas` files that
  Obsidian also opens. The graph is built for the next release: ⌘K → Graph
  shows every note and every `[[link]]`, and Show in graph the notes around
  one; a secure note shows only its title. The canvas, JSON Canvas cards on an
  open plane, is in development builds: New → Canvas makes one beside your
  notes, found in ⌘K and All notes, and Archive and Trash take it like a note. Type a card, or put just `[[a note]]` in one
  to show that note; connect cards with lines and gather them into groups.
  A note card shows the note and opens it in a tab; lines stay drawings and
  never become links. A new canvas sits beside your notes. Excalidraw boards
  stay as they are, for drawing (owner decisions 2026-10-06,
  [design](docs/design/canvas-and-graph-2026-10-05.md)).
- **Sheets (Beta)** <!-- id: sheets-beta --> · L — spreadsheets (XLSX and CSV)
  inside Rotli, built for the next release in Beta beside Word documents. Left:
  keep undo across a theme or tab switch, carry dropdowns and colour rules
  through the grid, then drop the Beta mark.
- **Word documents (Beta)** <!-- id: docs-beta --> · M — DOCX files open and
  edit in Rotli, marked Beta in the next release. Chat already reads and edits
  the Word documents it made, and links, numbered lists, and comments
  survive an edit. Univer is the engine under both Sheets and Docs.
- **Charts (`/chart`)** <!-- id: charts --> · L — type `/chart`, pick one of
  ten kinds, and the chart is drawn from a plain-text fence in the note, so
  the data stays readable Markdown. Built for the next release.
- **`/ai` in a note** <!-- id: ai-inline --> · M — type `/ai` (or `/ask`), say
  what you want, and the answer lands in the note where you typed it. Secure
  and locked notes follow the same AI rules as everywhere else. Built for the
  next release.
- **Chat attachments you can see** <!-- id: chat-attachments --> · M — an image
  you attach to a chat sits where you mention it, so you can tell what went
  with each question. Built for the next release; in Rotli Web, chat images
  still need the Mac app.
- **Mermaid visual editor** <!-- id: mermaid-visual --> · M — edit a Mermaid
  diagram by hand on a canvas instead of only in code. View and Code already
  ship.
- **MCP / Grok Bot plugin** <!-- id: agents-mcp --> · L — lets an AI agent work
  in the vault through Rotli's own rules: the `rotli mcp` server, the agent
  commands, and the remote relay a Grok Bot connects through
  ([contract](docs/architecture/agent-workspace.md)). Development builds only
  for now (owner, 2026-10-02: not yet stable). Built: rename, trash,
  attachments, several vault roots, `rotli agent config` for each agent, Word
  documents through the running app, and a record of every AI edit. Includes
  a custom Grok Bot that manages Rotli: create, file, search, and organize
  notes.
- **Read aloud** <!-- id: read-aloud --> · M — select text and have it read
  to you, on-device.
- **Hand to AI, Refined** <!-- id: hand-to-ai --> · S–M — a fuller prompt
  for Claude Code or another agent: Refined has the Librarian's model rewrite
  it, and the note's files go along with their paths. Both are built for the
  next release, and Basic stays. Left: "Open in chat" to send it on in Rotli.
  Hand to AI itself shipped in 1.6: "Hand to AI…" in the palette and a note's
  menu writes the prompt from the note, editable, with Copy; a secure note,
  or one that looks like it holds a secret, is refused.
- **Breve in public builds** <!-- id: breve-public --> · M — the morning brief
  and its routines, in the builds everyone downloads. Runs in development
  builds today.

## 2. Planned

- **New notes from a highlight** <!-- id: librarian-new-notes --> · M — in
  `/librarian`, highlight part of a note and ask the Librarian to make it a
  note of its own, linked back to where it came from. The rest of
  Talk to the Librarian shipped in 1.6: the `/librarian` bar, the corner chat
  with proposals you apply, tagging, marking a passage, filing (creating
  People), people notes for someone you describe, and Open in Chat.
  - It never rewrites the note you wrote. It changes only its own metadata and
    where the note lives, or it writes a new note, such as a people note for a
    name you highlighted.
  - A locked note is off limits: the Librarian does not touch it and does not
    create a note that would clash with it. If you ask for something that
    would change a locked note, it tells you instead.
  - Mac first; on web it says "In the Mac app" until the Librarian runs there.
- **The Librarian writes into people
  notes and keeps folder indexes** <!-- id: librarian-people-indexes --> · L — let the Librarian add to an existing
  people note (never a locked one) and keep an `index.md` table of contents in
  each folder. Today it fills metadata, writes a generated index for each
  top-level area, and (since 1.6) makes new people notes when you tell it
  about someone. Writing into existing people notes changes the Librarian's
  contract, which says it only touches metadata and location, so the contract
  is decided first. Your own notes stay yours: it still never rewrites a note
  you wrote unless you ask. Librarian rules (filing sentences, People groups,
  secure keywords) shipped in 1.6.
- **Links that survive a rename** <!-- id: stable-links --> · M — a `[[link]]` keeps pointing at the same
  note when that note's title or file name changes, without you retitling
  anything to keep it working. Renaming a note in Rotli already rewrites its
  top title, and the file name follows, the way Markdown files work. What's
  missing is the link side: today a link finds its note by the old name saved
  in `aliases`, and nothing updates the notes that link to it. Decide between
  updating those links on an explicit rename (what Obsidian does) and links
  that carry the note's stable id.
- **Add-ons system** <!-- id: add-ons --> · L — one way for the user to install and manage add-ons
  locally. Email providers, drive providers, and the Grok Bot all plug into it
  instead of each being a one-off. Comes before email and drive sync, because
  it decides how they get built.
- **Backup now** <!-- id: backup-now --> · M — a scheduled zip of the vault to a folder or external
  disk the user picks, plus a "Back up now" button. The cheap first step toward
  drive sync: protection if you lose the computer, long before full sync
  exists.
- **Email inbox** <!-- id: email-inbox --> · XL — a calm layer over your own email. Rotli reads and
  organizes it, never hosts it, and an email can be linked from a note the way
  notes link to each other. Same calm rules as the rest of the shell: no
  badges, no unread anxiety. Restore blueprint for the sidebar section:
  [docs/archive/notes-chat-inbox-rearchitecture.md](docs/archive/notes-chat-inbox-rearchitecture.md)
  (the `sec:inbox` expansion key is still honored by the persistence layer).
- **Drive sync** <!-- id: drive-sync --> · XL — sync notes to Google Drive, OneDrive, Proton Drive, and
  others. The purpose is backup: your data also lives somewhere not tied to the
  computer, in case you lose the computer. Never on by default. The user
  connects it and controls it. It does not lower security.
- **Send email from a checklist** <!-- id: email-from-checklist --> · L — makes checklists actionable: you do the
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

- **Open with Rotli** <!-- id: open-with-rotli --> · L — right-click any file on the Mac and open it with
  Rotli. Works like VS Code: the file stays where it is, outside the vault, and
  edits change the real file. The tab gets its own color so you can tell it is
  an outside file. ⌘S offers to put a copy in the vault, and you pick where it
  goes. Only if wanted.
- **Work on a roadmap item from the site** <!-- id: roadmap-work-on-this --> · M — each
  item on rotli.co's roadmap gets a "Work on this" link, beside its vote once
  voting opens. It starts GitHub's own flow from the visitor's account: rotli is
  forked, a branch is made for the item, and a draft pull request named after
  it opens with a starter note, so the work starts against that item. Nothing
  merges without the owner's review; the site holds no GitHub token, and
  opening one takes a GitHub account. Comes after voting is back.

## 3. Ideas

- **Per-note version history** <!-- id: version-history --> · L — local snapshots of a note with a diff
  view, so nothing typed is ever lost.
- **Import from Notion and Apple Notes** <!-- id: import-notion-apple-notes --> · L — bring an existing library in,
  links and images included. An Obsidian or plain Markdown folder already opens
  as a vault.
- **Backlinks panel** <!-- id: backlinks --> · M — every note that links to this one, plus places that
  mention it without a link.
- **Actionable checklists as a family** <!-- id: actionable-checklists --> · L — a checkbox that carries an
  action. `/email:send` is the first one; the same pattern follows for
  `/remind`, `/event`, and `/open`.
- **Connect a folder to a chat** <!-- id: folder-chat --> · L — connect a folder on your Mac, such as
  a whole software project, and talk about it: ask questions and keep the
  project in mind across the conversation. (The owner's idea, 2026-10-01.)
  Read-only:
  it is not a coding agent (T3 Code and Claude Code do that); nothing in the
  folder is edited. The chat, its notes, and anything it learns stay in your
  vault and in Rotli; the folder stays where it is and never moves into the
  vault. To decide: how a connection is granted and remembered (a chat's
  metadata or a vault-level list, not a fresh grant every time), what is read
  (ignore rules like `.gitignore`, size limits, binaries skipped), how a big
  project fits a model's context (search and summaries rather than the whole
  tree), and the same secret gate the vault has (a remote model never sees a
  secret-shaped file).
- **Beta channel** <!-- id: beta-channel --> · M — a setting that lets testers opt into in-the-work
  features like the Mermaid visual editor, Breve, or Read aloud. Today those
  only exist in development builds.
- **Shortcuts and Raycast hooks** <!-- id: shortcuts-raycast --> · M — extend the `rotli://` link so other
  apps can create a note or a capture, for example `rotli://new?title=`. Only
  open and reveal exist today.
- **Touch ID on secure notes** <!-- id: touch-id --> · M — ask for Touch ID before a secure note
  opens. Secure notes are hidden from remote AI today, but anyone at the Mac
  can open them.
- **Due dates on tasks** <!-- id: due-dates --> · M — write `due friday` on a task, and the Tasks page
  gets a Today group. Pairs with actionable checklists.
- **Task board view** <!-- id: task-board --> · M — the Tasks page as columns: open, in progress, done.
  The in-progress `[/]` state already exists in notes; the Tasks list needs to
  carry it (today it folds `[/]` into open), then this is one more view over
  the same notes.
- **Librarian weekly digest** <!-- id: librarian-digest --> · M — what you wrote this week, notes nothing
  links to, and stale tasks, delivered through Breve.
- **Tags browser** <!-- id: tags-browser --> · M — a place to see every tag and the notes under it. Tags
  already exist in note metadata.
- **Edit a note inside its canvas card** <!-- id: canvas-card-edit --> · M–L —
  once the Canvas ships, write in a note card on the canvas instead of opening
  the note in a tab, the way Obsidian does. Needs one live editor per card
  that stays in step with the same note open in a tab.
- **Query fence** <!-- id: query-fence --> · M–L — a `query` code block that shows a live table of
  tasks or notes (`tag:`, `area:`, state, due), using the grammar
  `rotli notes query` already has. With **Export to .xlsx** (S–M) it gives a
  task table that opens in Excel while tasks stay in notes.
- **Daily journal** <!-- id: daily-journal --> · S–M — a Journal folder, a "Today" command that opens or
  creates today's note, and Quick Note can land there. Logseq's best-loved
  habit.
- **Sheet templates** <!-- id: sheet-templates --> · M — "New from template": task tracker, weekly planner,
  habit tracker, with status dropdowns, colours, and a frozen header, saved as
  real .xlsx. Needs dropdowns and colour rules carried through the grid first.
- **Block references** <!-- id: block-references --> · L — point at one paragraph with `^id` and show it
  elsewhere with `![[note#^id]]`, in the same syntax Obsidian reads.
- **Librarian questions** <!-- id: librarian-questions --> · L — the Librarian asks about what it can't place.
  A switch in the bottom right turns it on; then the Librarian marks a note it
  has a question about with a small dot. Click the
  dot and it highlights the text in question and asks, for example "who is
  Ana?". Your answer goes where `/librarian` would put it. Builds on the
  `/librarian` chat.
- **Chat as a work surface** <!-- id: chat-work-surface --> · XL — Chat working like Claude Cowork for work
  that isn't code: ask for a video, have a video tool you connected make it,
  and watch it in the chat. The model drives the tool; it does not make the
  video itself. Evaluated 2026-09-27
  ([evaluation](docs/design/chat-work-surface-eval-2026-09-27.md)). Built:
  replies show images and video from the vault, and a video shows as a video
  in the chat's files. Next: a video tool, background jobs, and the provider
  behind Add-ons (M to XL, owner call on the source); dropping a video into a
  chat comes with the tool, since nothing can use one before it. The
  connected CLIs stay tool-less.

## 4. Known bugs

- **First drag and drop lands too high** <!-- id: bug-first-drop --> · M — on the first drag, the drop does
  not line up with the pointer. Found on Retina screens and fixed for the next
  release (images dropped from Finder land where you drop them); it closes
  once a real Finder drop on a Retina Mac confirms it.

## 5. Small enhancements

Nothing open right now. The last four (⌘⇧W views, ⌘⇧S top notes, two-step
hotkeys, and Send feedback) shipped in 1.3.

## 6. Keeping the web version in sync

- **Parity list** <!-- id: web-parity-list --> · L — every native command is marked "has a web version",
  "refused on web with a notice", or "Mac only on purpose". A check fails when
  a new command has no decision.
- **No silent gaps on web** <!-- id: web-no-silent-gaps --> · M — about 40 features quietly do nothing on web
  today. They should say "In the Mac app".
- **A real web contract doc** <!-- id: web-contract-doc --> · M — the only one today is an old plan that
  still says web has no chat.

**Rule:** every user-facing change is proven on the web build too, and adds
or extends a web test.

## 7. Platforms

- **Windows** <!-- id: windows --> · XL — Coming soon. A native Windows app,
  for the same folder of plain files.
- **Linux** <!-- id: linux --> · XL — Coming soon. A native Linux app, for the
  same folder of plain files.
- **Mobile / Tablet** <!-- id: mobile --> · XL — depends on drive sync: the notes come from a
  connected drive (possibly a home NAS). There will be a slight delay, so it
  needs a "Sync now" button. Later: instant sync through cloud options, only
  once the structure is consistent and the project is big enough to invest in
  cloud infrastructure; to explore through partnerships for secure cloud.

## 8. Later — to be placed

- **Handwriting to text notebook** <!-- id: handwriting --> — write by hand, keep real notes.
  Handwritten pages (Pencil on iPad, imported scans on Mac) are recognized
  on-device into Markdown that lands in the same memex. The handwriting stays
  as the artifact; the text becomes searchable and linkable. Recognition never
  leaves the machine.
- **Publish to Substack** <!-- id: substack --> — a note-level verb, not a surface. Deliberately
  parked (decided 2026-07-31): Substack has no official publish API, and every
  existing route is reverse-engineered private endpoints or browser automation,
  so we don't build on it. It lights up when Substack's official MCP gains
  write/publish. Design already sketched: a ⋯-menu/palette verb; draft-first,
  never auto-publish; credentials in Keychain; `secure:` notes blocked by the
  existing remote gate; state in `.rotli/`, never frontmatter; behind a
  provider abstraction so Ghost and Buttondown can follow. Interim option:
  "Copy for Substack" (rich-HTML clipboard), which touches no endpoints.
- **Calendar integration** <!-- id: calendar --> — cal.diy base; Apple, Google, and Proton providers.
- **Secure organization** <!-- id: secure-organization --> — needs its own session with injection evals before
  any build.
- **Secure note rules** <!-- id: secure-note-rules --> — your own keywords that make a note secure, matched
  only on its title or file name, never read by a model. That is what keeps it
  clear of Secure organization's model risk. **Shipped in 1.6, with the
  owner's call: one protected folder** — a matching note moves into
  `wiki/_secure/` like any secure note; choosing other folders stays future
  work, since each would need the same Git and model protection.
