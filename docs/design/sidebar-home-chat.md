# Sidebar IA: Home / Chat, and a collapsible System

Decided by Seth, 2026-08-01, against Claude Desktop's `Home | Code` segmented
pill. This document owns the new sidebar grammar; `DESIGN.md` carries the
product-level rules it implies, and `src/components/sidebar.tsx` plus its
`src/components/sidebar/` parts are the implementation.

## What changed

The sidebar used to stack two collapsible accordions — `Chat ›` and `Notes ›` —
in one scroll, with a pinned, never-collapsing System zone under them. Two
sections competing for one column meant every chat you gained cost you a note
row, and the fold state was a permanent negotiation.

Now the sidebar has **one top switcher and one body**:

```
┌──────────────────────────────┐
│ vault ▾   ☕  ＋ 🗀 ⌄         │  header row (unchanged)
├──────────────────────────────┤
│ ┌───────────┬──────────────┐ │
│ │ ⌂ Home    │  ⌨ Chat      │ │  the switcher (new)
│ └───────────┴──────────────┘ │
├──────────────────────────────┤
│                              │
│  the active view's body      │  one uninterrupted scroll
│  (Home tree, or Chat list)   │
│                              │
├──────────────────────────────┤
│ SYSTEM                     › │  Home only, collapsible (new)
│  Library · Assets · Archive  │
│  · Trash                     │
├──────────────────────────────┤
│  Files · Librarian · Settings│  utility footer (unchanged)
└──────────────────────────────┘
```

- **Home** is today's Notes world: All notes · Captures · Tasks · the Main /
  named-view tree, then the System zone and the footer. "Home, which is notes
  essentially and eventually a dashboard."
- **Chat** is the chat world: New chat · All chats · an **Unread** lane (when
  any reply landed unwatched) · chat folders · every chat, then the footer.
  Since 2026-08-03 the front carries live signals and organization:
  - **Run signals** — a chat that is answering breathes a small accent dot on
    its row; a reply that settles while you're elsewhere flips it to a solid
    **unread** dot, and those chats also collect in the Unread lane at the top
    (a view onto the list, not a folder). Opening the chat spends the flag.
    State lives in `src/state/chatRuns.ts`, session-only — the transcript on
    disk is the durable truth. Navigating away no longer cancels a queued
    turn; it completes, persists, and flips its row.
  - **Order is response recency** — pinned chats first, then most-recent
    activity, inside folders too ("the moment I get a response it moves to the
    top"). The old per-folder manual drag order is retired (the manifest field
    still parses for older builds); dragging a chat onto a folder still files
    it there.
  - **Pinned folders** — a chat folder's context menu can pin it above the
    others (`pinned` on the `chat-folders.json` entry).
  - **Model chip** — a row shows its chat's own model pick (quiet, right-
    aligned) when the chat isn't currently running/unread.
  - **Views** — chats join named views (`chats: [slug]` on the view in
    `views.json`, singular membership like notes): the row menu's "Move to
    view", an active view narrows the front to its chats, and a chat born
    while a view is active belongs to it.
- Neither view is collapsible. Each owns the whole body and scrolls on its own
  (`.sb-rows`) — the "infinite scroll" in Seth's words.
- **System** (Library · Assets · Archive · Trash, plus any added external
  folders) keeps its pinned bottom zone but its header is now a disclosure:
  one click folds the whole zone away.
- The utility footer (Files · Librarian · Settings) is unchanged and shows in
  **both** views — it is app-level, not view-level.

## Why Home owns System, and Chat does not

Library, Assets, Archive and Trash are stores of *notes and files*. A chat is
not filed into any of them (chats live in `chats/` and are grouped by the
virtual chat-folder sidecar). Putting the System zone in Chat would show four
rows that answer no question the Chat view can ask. The footer, by contrast,
is about the app and the vault, so it stays everywhere.

## Reserving the dashboard

Seth's Home is "notes essentially and **eventually a dashboard**". The switcher
is deliberately built so that arrival needs no second IA change:

- The switcher is a list of **fronts**, not a boolean. `SidebarView` is a string
  union (`"home" | "chat"`), the pill renders `SIDEBAR_FRONTS.map(...)`, and the
  persisted key stores the string. A third front is one array entry.
- Inside Home, the body is an ordered stack of **blocks** (smart rows → Main
  tree → System). A dashboard block joins that stack above the smart rows — a
  summary card, agenda, or Breve digest — without moving anything else.
- Because Home is one scroll with no accordions, a dashboard block does not have
  to fight a section header for the top of the column.

## Persistence

Both new pieces of state ride the existing `.rotli/settings.json` writer in
`src/state/persist.ts`, additively — an older build ignores both keys and lands
on its own defaults.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `sidebarView` | `"home" \| "chat"` | `"home"` | Which front reopens on launch |
| `expandedDests["sec:system"]` | `boolean` | `true` (open) | The System zone's fold |

Retired keys: `expandedDests["sec:chat"]` and `["sec:notes"]` no longer render
anything. They are not deleted from anyone's config — `gcPersistedMaps` keeps
every `sec:*`-shaped key by shape, so a downgrade finds its section state
exactly where it left it. `chatSidebarLimit` (the 5/10/15 "recent chats" cap)
is retired with its Settings control: the Chat view shows every chat, so a cap
would be a knob for a problem that no longer exists. Its stored value survives
in the unknown-key passthrough (`#35`), so a downgrade keeps the user's cap.

## Keyboard model

Every command stays remappable through `src/keys/` — these are default chords.

| Chord | Action id | Behavior |
|---|---|---|
| `⌃1` | `modules.notes` | Go to **Home** (was "Go to Notes") |
| `⌃2` | `modules.chat` | Go to **Chat** — the new front switch |
| `⌃⇧2` | `chat.new` | New chat (was `⌃2`), and switches to Chat |

`chat.new` keeps its identity and its place in the palette; only its default
chord moved down one modifier so `⌃1`/`⌃2` can read as "front 1 / front 2".
Anyone who rebound `chat.new` keeps their override — bindings persist by action
id, not by chord.

Every command that lands the user somewhere now also puts the sidebar on the
right front: `board.open`, `notes.new`, `tabs.newChooser` and `modules.notes`
switch to Home; `chat.new`, `chat.all`, `chat.summon` and `modules.chat` switch
to Chat.

### Collapse-all (the toolbar's ⌄), restated

The two-stage collapse survives with sections gone:

1. **First press** folds the trees — Main / named-view folders, chat folders,
   and any expanded destination row. Unchanged.
2. **Second press** (everything inside already folded) folds the **System
   zone** — `sec:system`. It used to fold `sec:chat` + `sec:notes`, which no
   longer exist.

The stage-detection rule is unchanged and still namespace-aware: `sec:*` keys
never count as "a tree is open", so a folded System zone can't swallow the
first press.

### Roving `j`/`k`

The roving listbox is Home's, and it walks exactly what Home renders: the smart
rows, the Main tree, then the System rows **while the System zone is open**. A
folded System zone drops its rows from the cursor, the same way a folded folder
already does. Chat rows are plain buttons, outside the listbox — unchanged.

## Reveal flows switch fronts

A reveal that points at content the current front cannot show must move the
front first, or the reveal silently does nothing.

- **Explicit note reveal** — the editor's location chip, "Show in Library",
  "Show in Brain", the row menus: `revealFocusedNote()` sets the front to Home
  as part of the same store action, so every caller is covered at the source.
- **Navigation reveal** — opening a note, board, or file from ⌘K, a deep link,
  Quick Look, or another surface: the sidebar watches the focused tab's
  `surfaceKind`. A chat tab pulls the front to Chat; a note/board/file tab pulls
  it to Home. It fires on *change* only (a mount-guard ref), so the persisted
  front on launch is never overridden, and switching fronts by hand while a tab
  stays focused is never undone.

## File map

`sidebar.tsx` was a 2,180-line mega-component and the standing refactor
candidate in `docs/architecture/code-audit.md`. This change splits it along the
new IA — each piece owns one front or one zone.

| File | Owns |
|---|---|
| `src/components/sidebar.tsx` | The shell: `<aside>`, the vault header row + create/collapse icons, the error lane, the switcher, front routing, the front auto-switch effect |
| `src/components/sidebar/sidebarSwitcher.tsx` | The two-segment pill (presentational) |
| `src/components/sidebar/sidebarHome.tsx` | The Home body: smart rows, view switcher + editors, the Main tree with its pointer-drag and multi-select, the roving list, the reveal effects |
| `src/components/sidebar/sidebarChat.tsx` | The Chat body: New chat, All chats, chat folders, chat rows, chat drag + rename |
| `src/components/sidebar/sidebarSystem.tsx` | The System zone: its disclosure header, Library + destination rows, added external folders |
| `src/components/sidebar/sidebarFooter.tsx` | Files · Librarian · Settings, and the Librarian's badges + working dot |
| `src/components/sidebar/useChatFolders.ts` | The chat-folder query + read-modify-write helper, shared by the Chat body and the shell's collapse-all |
| `src/services/systemNav.ts` | `openSystemRoot(id)` — the one way to open the System browser at a root |

## What this does not do

- **No virtualization.** Home renders the *curated* Main tree, not every note,
  so its row count is unchanged by this work; Chat renders one row per chat.
  Neither is a 900-row list today. If either becomes one, windowing that list is
  the next step — measured first, not assumed.
- **No new front.** Inbox (email) is still parked in `ROADMAP.md`. When it
  returns it is a third `SIDEBAR_FRONTS` entry, not a third accordion.
- **No change to Breve.** Breve is still a sidebar *mode* (a lens over the same
  vault), which replaces the whole body including the switcher — a front
  switcher inside a mode that has its own navigation would be two switchers.
