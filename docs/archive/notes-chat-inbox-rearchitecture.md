# Notes · Chat · Inbox — an information-architecture rethink

*Research + design doc. Authored 2026-06-26, from rotli's tree, against the
memex-vault v3.5 contract. RESEARCH ONLY — no code changed. This is a proposal for
the maintainer to redline. **Shipped:** the three-fronts model (Notes · Chat · Inbox)
proposed here is now live — current truth is `docs/model.md`; Voice/Memory
references below are the old state this doc moved away from.*

the maintainer's three early ideas, restated up front:

1. **Chats and notes live in the same surface.** Not a separate "Chat" module —
   "everything has a chat," so a chat is something a note *carries*, or a peer
   document beside it, not a different place you navigate to.
2. **Drop the module-switcher dropdown** in the titlebar.
3. **"Inbox" becomes EMAIL.** Today "Inbox" is a *notes destination* (a folder of
   captured markdown). the maintainer wants the word to mean an email inbox, a separate
   later module. The capture concept ("one-breath" ⌥C) does not go away — it just
   stops being called "Inbox."

The hard constraint that governs all of this: **rotli only ever writes
`chats/`, `inbox.md`, and `wiki/_inbox/` in a connected memex** (`memex.rs:106-133`
`is_writable`/`assert_writable`; mirrored in TS at `contract.ts:306-314` `canWrite`).
Nothing below may widen that boundary without a deliberate v3.x contract bump.

---

## 1. Current state (accurate, with file:line)

### 1.1 The module switcher dropdown

The titlebar identity button on the left opens `ModuleSwitcher`
(`Titlebar.tsx:79-92`): the button reads "Notes" with a chevron; clicking toggles
`switcherOpen` (`ui.ts:189,349-350`) and renders the popover.

`ModuleSwitcher.tsx` lists six modules over "one brain":

- **Notes** (`go("notes")`, current, ⌃1) — `ModuleSwitcher.tsx:50-56`
- **Chat** — NEW pill, live, `go("chat")` — `:57-61`
- **Memory** — NEW pill, live, `go("memory")` — `:62-66`
- **Voice** — "Next" pill, disabled — `UPCOMING[0]`, `:19,67-73`
- **Inbox** — "later" pill, disabled — `UPCOMING[1]`, `:20`
- **Board** — "later" pill, disabled — `UPCOMING[2]`, `:21`

Footer copy: *"One brain underneath. Notes writes it · Chat talks with it · Voice
speaks it · the Memory recalls it."* (`ModuleSwitcher.tsx:74-77`).

`go()` (`ModuleSwitcher.tsx:29-36`) switches the **main surface** by clearing
sibling flags: `setContentView("panes")`, `setSettingsOpen(false)`,
`setChatOpen(target==="chat")`, `setMemoryOpen(target==="memory")`. So Chat and
Memory are **full-surface fronts**, gated in `App.tsx:275-283`:

```tsx
{settingsOpen ? <SettingsSurface/>
 : chatOpen   ? <ChatSurface/>
 : memoryOpen ? <MemorySurface/>
 :              <NotesSurface/>}
```

They are *not* pane tabs. They replace the whole content area and have a "← Notes"
back button (`ChatSurface.tsx:78-83`, `MemorySurface.tsx:105-110`). Note: **the
on-disk "Inbox", "Voice", "Board" the switcher lists are NOT the same things** as
the sidebar destinations — the switcher's "Inbox/Board" are *unbuilt module
placeholders*, while a working **Board** view already exists in the sidebar
(`board.open`, `actions.ts:156-167`) and **Inbox** already exists as a notes
folder (below). This collision of names is part of what the maintainer is untangling.

### 1.2 "Inbox" as a notes destination (today)

The sidebar (`Sidebar.tsx`) is one compact tree. Its **Destinations** section is
five reserved roots (`DEST_ROWS`, `Sidebar.tsx:153-159`; `DEST`,
`destinations.ts:41-48`):

> **Inbox · Vault · Storage · Archive · Trash**

**Inbox** (`DEST.inbox = "Inbox"`, `destinations.ts:42`) is the default **note
creation target**:

- `resolvedParent()` falls back to Inbox whenever a smart row / sink / vault is
  selected (`Sidebar.tsx:679-685`), so a new note "never starts life inside a
  sink." `newNote()` in actions has the same fallback (cited at `Sidebar.tsx:676-678`).
- The quick-capture card drops captures as Board cards by default, OR, when
  "Send quick captures to the brain inbox" is on, appends to the memex `inbox.md`
  (`App.tsx:125-166`). Note: the **on-disk default capture sink is `Board/`**, not
  the `Inbox` folder — `notesService.createNote(DEST.board, body)` (`App.tsx:130`).
- In a connected memex, the Inbox row is a *shelf projection*: a note whose
  frontmatter `shelf: [Inbox]` is projected under "Inbox" regardless of its disk
  path (`corpus.rs:511-560` shelf-projection; the writeNote default is
  `shelf: ["Inbox"]`, `service.ts:189`).

So today **"Inbox" overloads three concepts**: (a) the default note shelf/folder,
(b) the capture landing zone (memex `inbox.md`), and (c) a disabled "Inbox" module
placeholder in the switcher. That overload is exactly the ambiguity to resolve.

### 1.3 How chats surface today

Two disconnected places:

1. **The Chat front** (`ChatSurface.tsx`) — a full-surface module. It lists named
   chats from the active memex's `chats/` (`useInstanceChats` → `memex_list_chats`,
   `memex.rs:460-490`), shows a chat as a raw `<pre>` transcript, and writes new
   ones via `writeChat` → `chats/<slug>.md` (`service.ts:111-132`,
   `memex.rs:670-682`). It already renders `attachedTo` ("↳ note", `ChatSurface.tsx:115`).
2. **The Vault tree** — `chats/` also surfaces as a *read-write folder* under the
   external Vault destination. `surfaced()` returns `NoteRW` for `chats/` and
   `chats/**` (`corpus.rs:855-858`), so each `chats/<slug>.md` shows up as an
   ordinary note row under `vault:chats` in the sidebar and opens in the **editor**
   (not the Chat front).

These two views of the same files do not know about each other. A chat is a
`<pre>` in one place and an editable markdown note in the other.

The **memex contract** for a chat (`contract.ts:135-156` `composeChatFile`):
frontmatter `id/title/source/attachedTo/participants/created/updated/tags:[chat]`,
a `# Title`, an optional `> attached to [[note]]`, then `## Messages` with
`**speaker** · DATE — text` lines. `ensureChatBacklink` (`contract.ts:188-193`)
keeps the attached note's `## Chat` list in sync. This is byte-mirrored from the
brain's `conversations.ts` — "everything has a chat" via `attachedTo: [[note]]`
(STRUCTURE.md `:120-133, :192-194`).

### 1.4 The pane/tab system (the seam that matters)

Panes host typed surfaces. `Tab = NoteTab | CanvasTab` (`types.ts:38-56`), a
discriminated union explicitly "ready to extend: `| { surfaceKind: "chat"; … }`"
(`types.ts:38`). `PaneTree` renders by `surfaceKind`; every pane helper keys on
`tab.id`, never `noteId`, so a third surface kind splits/detaches/reorders for
free (next-stages.md `:54-75`). **This is the structural reason chat-as-a-tab is
cheap and chat-as-a-full-front is the awkward path.**

---

## 2. What the maintainer is asking for — and the ambiguities

| # | Ask | Ambiguity to pin down |
|---|-----|-----------------------|
| 1 | Chats + notes in one surface | Inline thread *on* a note? A peer "document" in the same list? A *lens/mode* toggle on a note? (all map differently to `chats/` + `attachedTo`) |
| 2 | Drop the dropdown | What replaces module nav? Where do Voice / Memory / Board / Inbox(email) live then? |
| 3 | Inbox = email | What happens to the **capture inbox** (`inbox.md`, ⌥C) and the default note shelf currently called "Inbox"? Is email a real near-term build or a reserved name? |

Two more that fall out of these:

- **Naming collision.** "Inbox" currently means *three* things (§1.2). "Chat"
  means *two* (§1.3). Any coherent IA has to give each its own word.
- **Contract pressure.** None of this should change what rotli *writes*. Email is
  read-mostly external data; it is **not** a memex surface. Capture stays
  `inbox.md`. Chats stay `chats/`. Confirm we hold that line.

---

## 3. Capture vs Email — resolving "Inbox = email"

This is the cleanest of the three to settle, so do it first.

**There are two distinct things wearing the word "Inbox":**

- **the capture inbox** (lowercase) — the memex `inbox.md` capture zone
  (STRUCTURE.md `:61,79,254`), fed by ⌥C "one-breath capture"
  (`actions.ts:104-110`, `App.tsx:125-166`). This is **core and stays**. Capture
  must never be lost (`App.tsx:156-162`). It is a *write* surface rotli owns.
- **an email Inbox** (uppercase, new) — a *read-mostly* view of an external mail
  account (IMAP/Gmail). This is a **different, later module**. It is **not** a
  memex surface and rotli writes nothing into the memex for it.

### Recommendation: rename, don't overload

1. **Free the word "Inbox" for email.** Make "Inbox" mean the email module
   exclusively (even if email ships later — reserve the word now so we never
   re-teach users).
2. **Rename the capture concept to "Capture."** The capture zone, the ⌥C action,
   and any "captures" view use the word **Capture** (or "Quick capture"). The
   memex file stays `inbox.md` on disk — that's the contract's name and never
   shown to the user (frontmatter/plumbing is hidden, memex-rules `:73,129`). The
   *label* the user sees is "Capture."
3. **Rename the default note shelf.** Today new notes default to `shelf:["Inbox"]`
   (`service.ts:189`) and the sidebar's "Inbox" row. Rename that destination/shelf
   to **"Notes"** (the natural home for an unsorted note) or **"Unsorted"**. This
   removes the third meaning of "Inbox" entirely. (Implementation note: this is a
   label + default-shelf change; `DEST.inbox` the *id* can stay `"Inbox"` on disk
   for zero migration, but the **displayed label** and the writeNote default shelf
   change. Cleanest is to change both the id and the default — but that touches
   `resolvedParent` `Sidebar.tsx:679-685`, the seed, and the shelf default — so
   stage it.)

**Net:** "Inbox" → email (later). "Capture" → the ⌥C zone (`inbox.md`). "Notes" (or
"Unsorted") → the default shelf for a fresh note. Three words, three things, zero
overload. No contract change — `inbox.md` keeps its on-disk name; email never
writes the memex.

> Open question for the maintainer: does the email Inbox **branch into** the memex the way a
> Breve day does (turn an email into a `chats/` thread `attachedTo: [[email-…]]`,
> or a note linking it)? If yes, email is a *read source you can branch from* —
> same pattern as Breve's `history/` (write-contract-v3.5 §3). If no, it's a pure
> read view. Lean: read view first, branch-from later.

---

## 4. Chats + Notes unification — four models

Goal: "everything has a chat." A chat is `chats/<slug>.md`, optionally
`attachedTo: [[note]]`, with the note carrying a `## Chat` backlink
(`contract.ts:188-193`). Whatever model we pick must (a) read/write only `chats/`,
(b) keep `attachedTo`/backlink bidirectional, (c) survive the corpus projection
(`surfaced()` already makes `chats/**` a `NoteRW` surface, `corpus.rs:855-858`).

### Model A — Chat is a pane *tab* (kill the front, use the union)

A chat opens as a `ChatTab` in the pane tree, exactly like a note. The
`surfaceKind: "chat"` extension the types already invite (`types.ts:38`,
next-stages.md `:97-148`). The Chat *front* (`ChatSurface` as a full surface) is
retired; the same component (or a tab-flavored version) renders inside a pane.

- *Sketch:* sidebar rows for chats sit beside note rows; click opens a chat tab.
  Split a pane → note on the left, its chat on the right. A note's "Chat" button
  opens the attached chat as a sibling tab.
- *Pros:* zero new pane machinery (split/detach/reorder free, next-stages.md
  `:54-75`); "same surface" is literal — chats and notes are peers in the same
  tabbed workspace; matches the long-planned Chat-MVP design exactly.
- *Cons:* a chat tab and a note tab are still two separate things the user opens;
  doesn't by itself deliver "a chat *on* a note."
- *Contract fit:* perfect. Tab is just a view over `chats/<slug>.md`. No write
  change.

### Model B — Chat is an inline panel *on* a note (the "everything has a chat" reading)

Every note has an attached-chat affordance: a collapsible thread docked to the
note (a right rail, or a bottom slot like `editor/BottomSlot.tsx`). Opening it
reads/creates `chats/<slug>.md` with `attachedTo: [[thisNote]]`; sending a message
appends to that file and ensures the `## Chat` backlink.

- *Sketch:* note editor on the left/top; a "Chat" tab/handle reveals the thread
  bound to this note. Empty state: "Start a chat about this note." A note can have
  multiple chats (`listChats({attachedTo})`).
- *Pros:* this is the most literal "everything has a chat"; the chat is *of* the
  note, contextually. Strong product story (talk *with* this note).
- *Cons:* what about a **standalone** chat (not about any note)? Needs a fallback
  home (a "Chats" shelf, or a chat that's `attachedTo` nothing). More UI surface
  to build than A.
- *Contract fit:* perfect and it's the *designed-for* case — `attachedTo` +
  `ensureChatBacklink` exist precisely for this (`contract.ts:188-193`,
  STRUCTURE.md `:192-194`).

### Model C — One unified item list; chat and note are both "documents"

Drop the type distinction in the *list*. The sidebar/list shows notes and chats
intermixed (each with an icon distinguishing them). Opening either lands in the
right viewer (editor for a note, transcript+composer for a chat) — but they live
in the *same* list, sort together, filter together, attach to each other.

- *Sketch:* "All" shows notes and chats by recency; a chat row has a speech-bubble
  glyph, a note row a page glyph; both open in panes (Model A under the hood).
- *Pros:* "in the same thing" as a *browsing* claim — one list, one search, one
  recency stream. Cheap given the sidebar already renders heterogeneous rows
  (notes + boards, `Sidebar.tsx:498-522`).
- *Cons:* notes and chats have different shapes; mixing them in counts/All-notes
  needs care (the `isBoard` split is the precedent, `Sidebar.tsx:467-481`).
- *Contract fit:* fine. It's a list/projection choice; chats are still `chats/`.

### Model D — Chat is a *lens/mode* on the current note (a toggle, not a place)

A single workspace shows the current note; a mode toggle (⌘/ key or a header
segmented control) flips that same pane between **Write** (the editor) and **Talk**
(the chat thread attached to this note). One object, two lenses.

- *Sketch:* header pill "Write | Talk"; "Talk" shows the note's attached chat;
  "Write" shows the body. The note is always the anchor.
- *Pros:* the absolute minimum of new surfaces; "same thing" taken literally (it
  *is* the same pane). Very rotli (modal, keyboard-first).
- *Cons:* a chat can't easily be a first-class standalone object; harder to have
  note + chat visible *at once* (Model A/B's split gives you both).
- *Contract fit:* fine, same as B (it's B with a toggle instead of a dock).

### Reading across the four

- A is the **structural foundation** (chat-as-tab) — cheap, planned, unlocks the
  rest.
- B/D deliver the **"everything has a chat"** product promise (chat bound to a
  note via `attachedTo`).
- C is the **browsing** unification (one list).

They compose: **A (tabs) + C (one list) + B (per-note attached chat)** is a
coherent whole — and none requires touching the write boundary.

---

## 5. Navigation without the dropdown

Dropping the switcher means module nav must move somewhere. The six "modules"
aren't peers anyway — they fall into three tiers:

1. **Core workspace** = Notes **and** Chat, now unified (§4). This is the default
   surface; it needs no nav entry — it just *is* the app.
2. **Read-from surfaces** (lenses over data, not separate apps): **Memory**
   (browse the spine), **Inbox/email** (later), **Breve** (the day stream,
   write-contract-v3.5 §3), and the **Board**. These are *views*, best reached
   from the **sidebar**, not a titlebar dropdown.
3. **Actions/inputs**: **Voice** (dictate → writes into Notes/Chat/Inbox), **Quick
   Capture** (⌥C). These are *verbs*, best as a keybinding + a small launcher
   button, never a "place" you navigate to.

### Proposal: the sidebar is the navigator; the palette is the accelerator

- **Retire the titlebar identity dropdown.** The identity button can become a
  plain wordmark/home (clicking returns to the workspace), or just disappear,
  reclaiming titlebar space. (`Titlebar.tsx:79-92` is the edit site.)
- **Promote the read-from surfaces into the sidebar** as a small fixed group above
  Destinations, peers of the existing **Board** row (`Sidebar.tsx:890-898`):
  - **Capture** (the ⌥C zone view) · **Memory** · **Breve** · **Inbox** (email,
    later) · **Board**.
  These are exactly the things that today are either disabled switcher rows or
  separate fronts. The sidebar already has the "action row, not a folder" pattern
  for Board — extend it.
- **Everything is in the command palette.** ⌘K (`palette.toggle`,
  `actions.ts:120-128`) already exists; make every surface/lens a palette action
  (Memory, Capture, Breve, Board, Voice). The palette becomes the keyboard-first
  way to reach any module — which is more rotli than a mouse dropdown.
- **Voice** stays a *global action* (a chord + a tiny mic affordance), routing its
  output to Notes/Chat/Capture (write-contract-v3.5 §, the Voice row maps to
  Notes/Chat/Inbox surfaces). It is never a "screen."

This kills the dropdown, gives every former module a real home, and leans on two
patterns rotli already has (sidebar action rows + ⌘K).

> Alternative considered — **a tab bar of modules** across the top. Rejected: it
> re-creates the dropdown's "modules are peer places" framing, which is the framing
> the maintainer is moving away from. The sidebar+palette split better matches "core
> workspace, with lenses."

---

## 6. Contract & projection impact

**The headline: almost nothing changes on disk or in the write gate.** This rethink
is overwhelmingly a *frontend IA* change.

| Change | corpus.rs / projection | memex contract / write gate |
|--------|------------------------|------------------------------|
| Chat → tab/inline/lens (§4 A/B/C/D) | none — `chats/**` is already `NoteRW` (`corpus.rs:855-858`); reads via `memex_list_chats` (`memex.rs:460`) | none — `writeChat` already writes `chats/` (`service.ts:111`, `memex.rs:670`) |
| "Inbox" → email | none in memex (email is external, non-memex) | **none** — email never writes the memex |
| Capture rename (Inbox→Capture) | none — `inbox.md` keeps its on-disk name (`surfaced()` hides it `corpus.rs:868-874`) | none — `memex_append_inbox` unchanged (`memex.rs:705`) |
| Default-shelf rename (Inbox→Notes) | label-only in the sidebar; **if** the default `shelf` value changes, that's a new value in `writeNote` (`service.ts:189`) — still a `wiki/_inbox` write, still allowed | none — same `canWrite` path (`contract.ts:306-314`) |
| Unified note+chat list | projection/UI only | none |

**One thing to *watch*, not change:** if Model B/D lets a user create a chat
attached to a **note that lives in `wiki/` (read-only)**, writing the `## Chat`
backlink into that note would be refused — `wiki/` proper is `NoteRO`
(`corpus.rs:864-866`) and `canWrite` only allows `chats/`, `inbox.md`,
`wiki/_inbox/` (`contract.ts:310-313`). So the backlink can be written only when
the note is in a *writable* surface. Resolution: either (a) only allow attaching a
chat where the note is writable, or (b) write the chat with `attachedTo` and skip
the backlink on read-only notes (the chat still links one-way; `validate.ts` would
flag the missing back-link — so prefer (a), or surface it as "attached, not
back-linked"). **This is the single contract-edge of the whole rethink** and it
already exists today (a chat in the Vault `chats/` folder attached to a `wiki/`
note hits the same wall). Flag it for the maintainer; don't widen the gate.

**Decision needed (and it predates this rethink):** the v3.5 *proposal* doc
(`memex-write-contract-v3.5-proposal.md`) argues for a **separate visible `notes/`
root** owned by rotli, instead of routing user notes through `wiki/_inbox`. That is
orthogonal to this rethink but **interacts with §3's default-shelf rename**: if
`notes/` lands, "the default home for a fresh note" becomes `notes/<shelf>/` and
the "Inbox→Notes" rename aligns naturally. If `notes/` does *not* land, the default
stays `wiki/_inbox` staging. Either way the *label* work in §3 holds.

---

## 7. Recommended IA (single best guess)

A coherent design that honors all three asks, the write boundary, and rotli's
keyboard-first, modal character:

### 7.1 The shape

- **One workspace.** The app is a tabbed pane workspace (today's pane tree). It
  holds **notes and chats as peer surfaces** — Model A is the spine. Retire the
  full-surface `chatOpen` front; chats open as `ChatTab`s (`types.ts:38`).
- **Every note has a chat.** Model B/D layered on top: a note's header carries a
  **Write | Talk** affordance (Model D as the default, single-pane gesture) AND a
  "open chat in a split" action (Model A, for note+chat side by side). The chat is
  `chats/<slug>.md` `attachedTo: [[note]]`, backlink kept in sync. A **standalone**
  chat (attached to nothing) is a first-class peer too.
- **One list.** The sidebar/All view intermixes notes and chats (Model C), one
  recency stream, one filter, distinguished by glyph (extend the
  notes-vs-boards split, `Sidebar.tsx:498-522`).
- **No dropdown.** The titlebar identity becomes a plain home/wordmark. Navigation
  to lenses lives in the **sidebar** (a "Views" group: Capture · Memory · Breve ·
  Inbox · Board) + the **⌘K palette** (every lens + Voice as actions).

### 7.2 The three renames (kills the overloads)

- **Inbox** → **email** (reserved now, built later). Pure read view; optional
  "branch into a chat/note" later.
- **the capture zone** (`inbox.md`, ⌥C) → **Capture** (label) / "Quick capture"
  (action). On-disk name unchanged.
- **the default note shelf** (currently "Inbox") → **Notes** (or "Unsorted").

### 7.3 Phased migration

1. **Phase 0 — words.** Rename in the UI only: capture→Capture; the default-shelf
   row label Inbox→Notes; remove "Inbox" from the disabled switcher list. Zero
   contract/disk change. Cheapest, removes the worst confusion immediately.
2. **Phase 1 — chat as a tab.** Implement `surfaceKind: "chat"` (next-stages.md
   Track 1, steps 1-7). Open chats from the sidebar as tabs; retire the `chatOpen`
   full front (keep `MemorySurface`/`SettingsSurface` as fronts for now). The
   Vault `chats/` rows now open the chat *viewer*, not the raw editor.
3. **Phase 2 — drop the dropdown.** Move Memory + Board + Capture into a sidebar
   "Views" group and the ⌘K palette; turn the titlebar identity into a home
   wordmark. Remove `ModuleSwitcher`.
4. **Phase 3 — per-note chat.** Add the **Write | Talk** lens + "chat in a split"
   on a note (Model B/D), wired to `attachedTo` + `ensureChatBacklink`, with the
   read-only-note backlink guard (§6).
5. **Phase 4 — one list.** Intermix chats into the sidebar/All recency stream
   (Model C).
6. **Phase 5 — Inbox(email).** Build the email read view as its own sidebar lens.
   Decide branch-into-memex then.

Each phase ships independently and none touches `is_writable`/`canWrite`.

### 7.4 Open questions for the maintainer

1. **Rename target for the default shelf:** "Notes", "Unsorted", "Quick", or keep
   it as today's "Inbox" *label* but just stop calling email "Inbox"? (Lean:
   "Notes" — it's where an unsorted note lives.)
2. **Chat primary gesture:** default to **Talk-as-a-lens** on the current note
   (Model D, one pane), or **chat-in-a-split** (Model A, two panes)? (Lean: offer
   both; default to the lens for "quick talk," split for "work side by side.")
3. **Standalone chats:** where does a chat that's `attachedTo` nothing live in the
   sidebar — a "Chats" shelf, or just in the intermixed All list by recency?
4. **Read-only-note backlink:** when attaching a chat to a `wiki/` (read-only)
   note, refuse, or attach-without-backlink-and-flag? (Lean: only allow attach
   where the note is writable; otherwise show "attached, link pending.")
5. **Email scope:** reserve the word now and build later (recommended), or is
   email a near-term build? And does it branch into the memex?
6. **Interaction with the `notes/` root proposal** (write-contract-v3.5): adopt the
   separate visible `notes/` root (and align the default-shelf rename to it), or
   keep writing through `wiki/_inbox` staging? (This is a bigger, separate call —
   but §3's rename is compatible either way.) **RESOLVED (v3.6): keep `wiki/_inbox`
   staging; the separate visible `notes/` root was rejected.**
7. **Memory front:** does Memory also become a sidebar lens / tab (consistent with
   killing fronts), or stay a full surface? (Lean: make it a lens too, for
   consistency — but it's lower priority than chat.)

---

## Executive summary

- **Three words, three things.** "Inbox" today overloads (a) the default note
  shelf, (b) the `inbox.md` capture zone, and (c) a dead switcher placeholder.
  Free "Inbox" for **email** (a later, read-mostly, *non-memex* module), rename the
  ⌥C capture zone to **Capture** (`inbox.md` keeps its on-disk name, never shown),
  and rename the default note shelf to **Notes/Unsorted**. Capture is core and stays.
- **Unify chats + notes via the pane tabs.** The type system was built for this
  (`types.ts:38` invites `surfaceKind:"chat"`). Make chats **peer tabs** (Model A),
  layer a per-note **Write | Talk** lens / split (Models B/D) for "everything has a
  chat" via `attachedTo` + the `## Chat` backlink, and **intermix** chats and notes
  in one list (Model C). Retire the full-surface Chat front.
- **Replace the dropdown with sidebar lenses + ⌘K.** Modules aren't peers: the
  core workspace just *is* the app; Memory/Breve/Board/Inbox(email)/Capture become
  **sidebar "Views"** (peers of today's Board row) and palette actions; Voice stays
  a global verb. The titlebar identity becomes a plain home wordmark.
- **The write boundary never moves.** rotli still writes only `chats/`, `inbox.md`,
  `wiki/_inbox/`. The one edge is attaching a chat to a read-only `wiki/` note (the
  `## Chat` backlink would be refused) — a pre-existing constraint, not a new one;
  guard it, don't widen the gate.
- **Phase it:** words first (free, no contract change) → chat-as-tab → drop the
  dropdown → per-note chat → one list → email. Each phase ships independently.

Doc: `docs/archive/notes-chat-inbox-rearchitecture.md`

---

# Addendum — the maintainer's decided IA (2026-06-26)

This supersedes the recommendation above where they differ. the maintainer read the analysis and
chose a concrete shape. **The top-bar module dropdown is removed**; the left menu carries
**three top-level sections**, each with its own accordions. One window blends email, an
AI chat, and notes — "no need for that top drop down."

## The three sections (top → bottom of the left menu)

1. **Inbox = email** (the word "Inbox" now means email, not note-capture).
   - Accordion **by account**, with an **All** at top to search across everything:
     `All · personal@example.com · work@example.com · …` (every connected mailbox).
   - A sub-accordion **by email/thread** under each account.
   - (The capture concept — today's `inbox.md` / ⌥C — needs a new home/name since "Inbox"
     is taken; treat capture as a quick-entry that files into Notes, not the email Inbox.)

2. **Chat** — a real **ChatGPT-style** chat front (open-source models), with **history**.
   - Accordion for **chat history** + an **All** to search across all chats (the accordion
     itself shows a *limited* view).
   - **@-mention context:** in a chat you pull notes/emails in as context by typing
     `@{email}.{email subject}` or `@{note}.{note title}` (and presumably `@{board}.…`).

3. **Notes** — what exists today: All notes · Board · folders + nested folders (the deepest
   tree, since this holds the corpus).

**Memory is NOT a section** — "the memory is simply part of my Vault, so that doesn't make
sense" as a separate module. It folds into Notes/Vault.

## Chat ⇄ Note relationship (the precise rule the maintainer gave)

- **Not everything is a chat.** A board is just a board; a note is just a note. But you can
  **open a chat *against* any board/note** (chat is a verb you point at an object).
- **Every chat owns a note.** Opening a chat creates an attached note that is **continuously
  summarized as the chat goes** (the note is the living summary; the transcript is the chat).
- The user can go to **just the note** and **edit / share / delete** it independently. Deleting
  the note **does not** delete the chat — and on the **next prompt** the chat **regenerates a
  note** if it doesn't have one. (So: chat is the source of truth for the conversation; the note
  is a regenerable, user-editable projection of it.)

This keeps rotli's existing contract intact: a chat is still a `chats/<slug>.md` file with
`attachedTo: [[note]]`; the "owned note" is the attach target. The continuous-summary writer
is the new piece (a client-side LLM job), not a contract change.

## Near-term build queue (the deferred items from this round)

These were scoped out of 0.4.x to do correctly; they precede the big IA rebuild:

- **D — contextual zoom** (`⌘+ / ⌘-`): zoom only the *focused* surface — the note's text when
  you're in a note, the left menu when you're in it. Needs focus-aware routing that respects the
  single-dispatcher keymap + a sidebar text-scale (and a non-conflicting reset; `⌘0` is taken by
  toggle-sidebar).
- **F — boards are nameable:** a board has no title area. Add (1) **name-on-create** (inline name
  before the file is written), (2) **rename via the tab (double-click) and the sidebar row** — needs
  a `corpus_rename_board` command (rename the `.excalidraw` file, remap the id), and (3) a **dedicated
  new-board chord** (≠ `⌘T`, which stays new-note — e.g. `⌘⇧N`).
- **G — board metadata for the AI:** boards are images to a text LLM. Give each board attachable
  **metadata** (title · description · tags) so the AI can know what a board is about and return it in
  search / pull it into a chat as `@{board}.…` context. Where it lives is the open question — a sibling
  `.md` (cleanest for the text-first memex + the `storage:` model) vs. inside the `.excalidraw` appState.
  This is a prerequisite for boards to participate in the Chat section's @-context.

## Phasing (revised to land the maintainer's IA)

1. **Boards nameable + metadata** (F, G) — small, unblocks board search + @-context. ✅ 0.4.2/0.4.3
2. **Contextual zoom** (D) — independent polish.
3. **Chat front** — a proper chat UI over `chats/`, with history + the owned-note summarizer. ✅ 0.5.0 (Inc 1: one-shot, no summarizer yet)
4. **Left menu = 3 sections** — fold Board/All-notes/Recent under **Notes**; add **Chat** + **Inbox**
   placeholders; retire the top dropdown. ✅ **0.6.0 (Increment 1, this change)**
5. **Email (Inbox)** — connect mailboxes; account/thread accordions; read-mostly, never writes the memex.
6. **@-context + per-object chat** — `@note`/`@email`/`@board` mentions resolve into chat context.

### What 0.6.0 (Increment 1) actually shipped

The **structural** left-menu rework only:

- Three collapsible sections (**Inbox · Chat · Notes**), persisted in `expandedDests` under reserved
  ids (`sec:inbox`/`sec:chat`/`sec:notes`). The top `ModuleSwitcher` dropdown is **deleted**; the
  titlebar identity is a plain **rotli** home wordmark.
- **Chat** is no longer a full-surface front (`chatOpen` removed). It's a `contentView "chat"` that
  renders `ChatSurface` in the content area beside the sidebar; the sidebar Chat section drives
  selection (`ui.selectedChatSlug` / `ui.chatAllOpen`). Sidebar shows recent history (limited);
  **All chats** opens a searchable browse in the content area.
- **Chat model selector** reads `~/.memex/ai/registry.json` (`chat_models` Rust command), lists the
  `kind:"llm-chat"` models, and `chat_complete` now speaks both the Ollama `/api/generate` (MLX) and
  OpenAI `/v1/chat/completions` (llama.cpp) shapes. Choice persists in `ui.chatModelId`.
- **Capture rename:** the note-capture destination is **labeled "Capture"** (the word "Inbox" now
  means email). The on-disk id stays `"Inbox"` and the memex write boundary is unchanged — rotli
  still writes only `chats/`, `inbox.md`, `wiki/_inbox/`.
- **Memory** is not a section (it's the Vault/Knowledge under Notes). `MemorySurface` remains in the
  tree but is no longer wired to any nav entry.

**Deferred to later increments (NOT in 0.6.0):** streaming, `@note`/`@board`/`@email` context, the
chat-owns-a-summary-note model, Breve `history/` rendered inside Chat, the email account/thread
accordion (only stubbed), and the real mail integration.

## Breve / `history/` reads as chat (the maintainer, 2026-06-26)

The `history/` dailies should render **in the chat UI**, read-only — you can't add to a day, but it's
fluid: **take a day → start a new chat with that day as context**, **spin a note off a day** (then
chat on the note), or **just keep the note** — your call. This rides the chat-owns-a-note model: a day
is a read-only transcript; *acting* on it forks a new (writable) chat + its summary note. So the
approved "surface Breve read-only" is really **render `history/` inside the Chat surface**, not a plain
read-only notes folder — fold it into the Chat front. (Until then, `history/` stays hidden.)
