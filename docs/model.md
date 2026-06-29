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

**Notes** _(front)_ — the note system, built on the memex. It has four layers:

- **Capture** — you just jot a note; you do **not** decide where it goes. Frictionless
  by design: most people don't want a strict filing flow. New notes land in staging
  (`wiki/_inbox/`); the AI files them later. ⌥C quick-capture appends to `inbox.md`.
- **The brain** — the **AI-organized** knowledge: areas like **People · Projects ·
  Research** (the memex `wiki/<area>/`). Mention a person in a note and the AI files
  it so they turn up under People. It is a **folder within Notes** — browsable and
  editable, but **most people never open it**; they just take notes and let the AI
  organize. "The brain" = **your organized areas**, nothing else.
- **Storage** — your files/images/PDFs. They live in the memex's internal `storage/`
  (binaries, gitignored), referenced from notes by a `storage:` link — never loose in
  the text tree. A dropped binary routes there.
- **Boards** — Excalidraw canvases, alongside notes.

**Chat** _(front)_ — your AI conversations (`chats/`). Everything can carry a chat.

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
auto-detected → the note is never sent to a *remote* model and its file is gitignored;
a local model may still read it), plus the memex access mode (`local`/`open`/`secure`).
The AI maintains both organization AND access via metadata.

## What rotli writes (the contract — v3.6, band [3.4, 3.6])

rotli READS the whole memex but WRITES only: **`chats/`** (AI chats), **`inbox.md`**
(captures), and **`wiki/_inbox/`** (new-note staging). The AI/brain files staged notes
into `wiki/<area>/`. rotli NEVER writes `history/`, `identity/`, `personality/`,
`MAP.md`, or the curated rest of `wiki/` — refused at both the TS `canWrite` gate and
the Rust `is_writable` guard. So: **you capture, the brain organizes; rotli never
overwrites your organized brain, your history, or your identity.**

## Vocabulary — say this, not that

| Say | Not | Because |
|---|---|---|
| your notes folder | corpus | "corpus" is an internal code term |
| the brain (your organized areas in Notes) | brain (= a connected memex) | the word means YOUR organized knowledge |
| linked library | connected brain · other brain | a *second* memex is a library you reference |
| Storage = the memex `storage/` | Storage = a local notes folder | one binary store, not two |
| Inbox = emails | Inbox = quick capture | the FRONT "Inbox" is email |

## Why this shape

Most people don't want to be forced into a filing flow — they want to take a note and
not think about it. So capture is frictionless and the **AI** does the organizing (via
metadata) into the brain. Power users _can_ work in the brain directly, but they never
have to. One memex by default keeps it simple; a linked library is there when a team or
shared brain is needed. Everything stays plain files you own.
