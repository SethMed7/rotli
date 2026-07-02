# The rotli model — objects & vocabulary

> The canonical conceptual model. Everything else (the `.carl` rules, the UI copy,
> the other docs) defers to this. Settled with Seth 2026-06-28. The most
> load-bearing layer — read it before arguing about where anything lives.

## One sentence

**Your notes folder _is_ a memex** — one local folder that holds your notes, chats,
knowledge, files, and access — and rotli is a warm window onto it.

## The objects

**memex** — your one folder. Plain files you own; local-first; openable in any
editor. By default your rotli notes folder IS a memex. (Internally the code calls
the active folder the _corpus_; that word is **not** user-facing — say "your notes
folder.")

**Notes** _(front)_ — the note system, built on the memex. Its layers:

- **Capture** — you just jot a note; you do **not** decide where it goes. Frictionless
  by design: most people don't want a strict filing flow. Both a typed note and a ⌥C
  quick-capture land as a **staged note** in `wiki/_inbox/`, all surfaced under the **one**
  **Captures** view; the AI files them into the brain later. (There is no separate "Capture"
  destination — captures have a single home.) A staged note you **curate** — add it to
  Main or ★ star it — is a full note you keep, so it leaves the Captures view (its file
  stays staged on disk until it's filed).
- **The brain** — the **AI-organized** knowledge: areas like **People · Projects ·
  Research** (the memex `wiki/<area>/`). Mention a person in a note and the AI files
  it so they turn up under People. It is a **folder within Notes** — browsable and
  editable, but **most people never open it**; they just take notes and let the AI
  organize. "The brain" = **your organized areas**, nothing else.
- **The organizer** — the on-device **Brain filer** (a Rust daemon in the
  shell, `organizer.rs`). Three narrow jobs: **Classify** (a staged capture → an area,
  or a `suggested_area` hint when unsure), **Enrich** (fill empty `summary`/`tags`/`links`
  — never a field you edited), and **Refresh index** (regenerate each area's
  `wiki/<area>/_index.md` overview, deterministically). **Event-driven and lazy — it
  preserves your machine.** It never polls: work is triggered only by the file watcher
  (a quiet-window debounce folds a typing burst into one run after the last save
  settles), by an approval you make in Activity, or by the explicit **Run now**
  (Settings → Brain, or the Activity header). When nothing is staged it sleeps outright
  — zero wakeups, zero disk reads, no timers. It runs only while you're idle (or rotli
  is backgrounded), **on AC — never on battery** (Run now is the deliberate exception),
  backs off when the machine is hot, and always yields to an interactive chat. It never
  keeps the model warm: calls ride the normal transport with no keep-alive/warm-up, so
  the model server's own idle-unload applies. Everything it does lands as **journal
  records** in `.rotli/brain-journal.jsonl`, with its own progress in `.rotli/organizer.json`.
  How much it *applies* is the **trust ladder** (Settings → Brain), monotonic in risk:
  **Off** (dormant) · **Suggest** *(default — proposes everything, applies nothing;
  you Approve/Dismiss in Brain → Activity)* · **Tidy** (auto-applies annotations +
  filing brand-new captures; re-filings and index rewrites stay proposals) ·
  **Organize** (applies everything, fully journaled + undoable). Two absolutes at
  every rung: a **`secure` note never enters any model** — local or remote — and a
  **`locked` note is never touched**. Local only; it never reaches the internet.
- **Main** — your **hand-picked notes**, at the top of the sidebar. It holds no files of
  its own: it's a **curated subset of individual notes** you pick, arranged into **your
  own** folders and order — **not** a mirror of the areas. (An area like **People** is
  auto-maintained *in the brain* and just lives there; you pull the specific notes you
  want into Main — with the **⊕** on a note row, or by dragging a note from the brain in.)
  **One file, two views** — edit a note in Main or in the brain, it's the same file. So
  you keep it how *you* want while the AI organizes the brain underneath (it never moves
  when the AI refiles). Main points at notes **by id, wherever they live** — a staged
  capture, an archived note, a vault note — and a row leaves Main only when its file is
  truly gone (curating a staged note is exactly how it exits the Captures view while its
  file stays staged on disk). Persisted to a committed `.rotli/main.json`. Everything the AI does
  to the brain is logged + reversible in **Brain → Activity** (the Brain is a collapsible
  destination). Full spec: `docs/design/main-brain-daemon.md`.
- **Quick access** — a **capped set (≤5)** of your very-most-reached notes, **starred**
  from Main (the **★** on a Main row). It is *not* a place — it's a small favorites set
  that lives inside Main. Starred notes are what the **⌥ Quick window** opens and cycles
  (the frictionless "jump to my five" hotkey). Star / unstar any time; the set is separate
  from — and layered on top of — Main's arrangement.
- **Storage** — your files/images/PDFs. They live in the memex's internal `storage/`
  (binaries, gitignored), referenced from notes by a `storage:` link — never loose in
  the text tree. A dropped binary routes there. Files open **in-app** (image/AV/pdf/text/
  spreadsheet views); spreadsheets (`xlsx`/`csv`) are **editable in place** when their
  store is writable — a plain added folder, not the read-only memex `storage/` or a
  linked library, which stay a read-only table (the first save keeps a one-time
  `.bak` of the pre-rotli original beside the file). Viewers are honest: an image opens
  at its **natural size** (points, matching Preview) with pinch/⌘± zoom and a % readout;
  a sheet too big for the read caps **says it's truncated** (or refuses cleanly) instead
  of silently showing a slice. Every file view carries an **Open externally** dropdown:
  default app · Reveal in Finder · installed "Open with" apps.
- **Boards** — Excalidraw canvases, alongside notes.
- **Search** — typing in **All notes**, the sidebar filter, the palette, or Quick Note
  searches **full text** (not just titles) across the searchable universe: staged
  captures, the brain, the Vault, and added folders. A title hit ranks above a body hit;
  body hits show a highlighted-match snippet. Trash is the one place search never
  surfaces (Archive stays findable — restore is what resurrects Trash). The same
  ranking/snippet grammar lives twice (Rust `corpus_search` + the TS twin) and is
  test-locked in lockstep.
- **The editor** — notes stay **plain markdown you own**; everything rich is a
  render-only layer (the Aa/typography controls, live preview, widgets — never written
  into the `.md`). Fenced blocks render inline: ```math · ```mermaid · ```jsxgraph ·
  ```svg · ```**html** — the html preview runs in a **sandboxed, script-free** frame
  (fences are untrusted content; click the block to see/edit the source). **Tables are
  structurally editable**: Tab/⇧Tab hop cells (Tab past the end appends a row), ↑/↓ hop
  rows, Enter never splits a row, and the widget's row/column menus insert / delete /
  move / align — while the file keeps ordinary readable pipes.

**Chat** _(front)_ — your AI conversations (`chats/`). The on-device model is an **agentic client**,
not a context-free box: your memex IS its knowledge base, so it **searches and reads your notes** (their
organization + metadata) to answer. Flip the composer **globe** on for a chat and it can also reach the
**web** (DuckDuckGo, no key) — off by default, and only used when your notes don't cover the question.
Attach **images** to a vision-capable model (the composer checks). Everything can carry a chat.

**Inbox** _(front)_ — your **emails**. (Distinct from the memex `inbox.md` capture file
and from `wiki/_inbox/` note staging — same word, three different things; the FRONT
named "Inbox" is email.)

**Linked library** _(advanced)_ — a **second** memex you reference (a shared/team brain,
a public knowledge base, a colleague's). Renamed from the code's "connected brain";
tucked under Advanced. Default is **one** memex = your notes; most people never link a
second. Read or write per its perms.

**Access** — who may see/use a note is **metadata**, not a separate ACL: the note's
`reach` (who) + `owner` (origin) frontmatter, a per-note **`locked`** flag (the metadata
panel's lock — the AI filer skips a locked note), a per-note **`secure`** flag (secrets
auto-detected → the note is never sent to a *remote* model **nor out to the web** (the agentic client's
web tools refuse a query/URL that trips the secret detector) and its file is gitignored;
a local model may still read it), plus the memex access mode (`local`/`open`/`secure`).
The AI maintains both organization AND access via metadata.

Metadata is visible **in the note**: flip **Show file metadata** (Settings → General, or
the metadata panel) and the note's raw frontmatter renders at the top of the file —
monospaced, editable as plain text, exactly as it sits on disk. The write runs the same
per-store gate as every user write, and the reserved `id`/`owner`/`created` keys are
restored if touched — plain text in, contract intact. The metadata panel itself keeps
the lock/secure switches + Brain filing (its old key:value field editor is gone).

## What rotli writes (the contract — v3.7, band [3.4, 3.7])

Two write actors, two gates. **You** (the interactive editor) write only: **`chats/`**
(AI chats), **`inbox.md`** (captures), and **`wiki/_inbox/`** (new-note staging) — and
NEVER `history/`, `identity/`, `personality/`, `MAP.md`, or the curated rest of `wiki/`
(refused at both the TS `canWrite` gate and the Rust `is_writable` guard). The **AI
Filer** (v3.7) is the second actor: it writes the curated `wiki/<area>/` brain — the
`area`/`summary`/`tags`/`links` metadata + filing staged notes into areas + the
generated `wiki/<area>/_index.md` — through its own narrower gate, and it must skip any
`locked` note. The two lanes are disjoint: you never write the curated brain, the Filer
never writes your Main arrangement. So: **you capture + arrange, the AI organizes; neither
overwrites the other.** The Filer's daemon is **the organizer** (above): at the default
**Suggest** rung it writes *only* its two `.rotli/` sidecars (journal proposals + state)
— the corpus files are provably untouched until you approve, or climb the ladder. Full
spec: `docs/design/main-brain-daemon.md`.

## Vocabulary — say this, not that

| Say | Not | Because |
|---|---|---|
| your notes folder | corpus | "corpus" is an internal code term |
| the brain (your organized areas in Notes) | brain (= a connected memex) | the word means YOUR organized knowledge |
| linked library | connected brain · other brain | a *second* memex is a library you reference |
| Storage = the memex `storage/` | Storage = a local notes folder | one binary store, not two |
| Inbox = emails | Inbox = quick capture | the FRONT "Inbox" is email |
| summon chat = ⌥A ("ask") | open the chat window | ⌥A surfaces the app INTO a chat (newest, or fresh) — chat is a pane, not a window |

## Why this shape

Most people don't want to be forced into a filing flow — they want to take a note and
not think about it. So capture is frictionless and the **AI** does the organizing (via
metadata) into the brain. Power users _can_ work in the brain directly, but they never
have to. One memex by default keeps it simple; a linked library is there when a team or
shared brain is needed. Everything stays plain files you own.
