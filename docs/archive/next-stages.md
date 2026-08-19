# rotli — next stages

*A code-grounded build plan. Stage 1 graduated 2026-06-12; this is what comes
after the corpus and the unified sidebar. Two tracks, in order: **Chat MVP**
ships next; **memex-vault / memex multi-root** is deferred until memex-vault stops
moving. Every claim below points at a real line in today's tree.*

The law that governs both tracks is already written into the code's comments:
the folder of `.md` files *is* the product, and *nothing phones home*
(`docs/roadmap.html:311`, the "principle" card). Chat must honor that. The
multi-root work must not break it. Read those constraints as hard.

---

## Track 1 — Chat MVP

### Goal

A `surfaceKind: "chat"` tab that opens in any pane, reads and searches the
current corpus, and lets you talk *with* your notes — the first of the five
unbuilt fronts (`ModuleSwitcher.tsx:18`, `{ name: "Chat", … next: true }`). The
ModuleSwitcher footer already promises it: "Notes writes it · Chat talks with
it" (`ModuleSwitcher.tsx:55-57`). This track makes that line literal without
touching the pane layout, the editor, or the on-disk format.

The shape is deliberately small: **one chat tab is one conversation against the
corpus.** It is not a second editor, not a sync client, not an agent with write
access. It reads notes, cites them, answers. Writing back into the corpus
(turning an answer into a note) is a later, explicit affordance — out of MVP.

### The exact seams in today's code

The whole point of the type system was to make this a *type extension*, not a
refactor. From the very top of `src/types.ts:1-3`:

> *Tabs are typed from day one (r2 chat-on-note locks): panes host **surfaces**,
> and the surfaceKind union grows ('chat', …) without touching the pane tree.*

The seams, concretely:

1. **The Tab union** — `src/types.ts:35-43`. Today:
   ```ts
   export interface NoteTab {
     id: string;
     surfaceKind: "note";
     noteId: string;
     viewState: TabViewState;
   }
   export type Tab = NoteTab;
   ```
   The comment on line 35 literally says *"Discriminated union, ready to extend:
   `| { surfaceKind: "chat"; … }`."* We add a `ChatTab` and widen `Tab`.

2. **The pane tree** — `src/state/panes.ts`. Leaves hold `Tab[]`
   (`types.ts:56-61`), and every tree helper is keyed on `tab.id`, not on
   `noteId`: `findLeaf`, `leaves`, `activeTabOf` (`panes.ts:37-56`), `moveTab`
   (`panes.ts:433-477`), `detachTab` (`panes.ts:479-528`) all move *tabs* around
   and never inspect `surfaceKind`. A chat tab reorders, splits, detaches, and
   closes for free. The **only** place in `panes.ts` that assumes a note is
   `makeTab` (`panes.ts:27-29`) and the split-duplication line
   `makeTab(activeTabOf(leaf).noteId)` (`panes.ts:288`).

3. **The render switch** — `src/components/PaneTree.tsx:34-37`. The single line
   that maps a surface to a component:
   ```tsx
   {tab.surfaceKind === "note" && (
     <EditorSurface key={tab.id} paneId={node.id} noteId={tab.noteId} />
   )}
   ```
   This is already a *guarded* render, not an unconditional one. We add a second
   guard `{tab.surfaceKind === "chat" && <ChatSurface key={tab.id} … />}`. The
   `key={tab.id}` discipline (note the PaneTree comment, lines 31-33: *"keyed by
   tab — each tab gets its own surface, so scroll/edit state never bleeds"*)
   means each chat tab gets an isolated React subtree.

4. **The data seam** — `src/services/notes.ts:14-33` (the `NotesService`
   interface) and its switch point `notesService = FS_MODE ? new FsNotesService()
   : svc` (`notes.ts:381`). Chat *reads* through this seam; it does not get its
   own back door to disk. Today the corpus is fully enumerable in one IPC call:
   `corpusList()` returns every note's `{id,title,snippet,folderId,…}`
   (`fsNotes.ts:46-64`, `corpus.rs:352-356` `CorpusList`), and `corpusRead(id)`
   returns the full body (`fsNotes.ts:66-84`, `corpus.rs:1112-1115`). That is the
   entire retrieval surface Chat needs for MVP — no new Rust required to *read*.

5. **The reserved roots** — `src/services/destinations.ts:10-30`. `isHidden`
   already excludes Archive/Trash from listings. Chat's corpus search must reuse
   `isHidden` so it never cites a trashed note (the same guarantee
   `listNotes` gives, `fsNotes.ts:48-49`).

### Build sequence

**Step 0 — decide the model (do this first; see the decision section below).**
The recommendation is **bundled-local default, bring-your-own-key opt-in**.
Everything downstream assumes a `ChatProvider` abstraction so the choice is one
swappable module, not threaded through the UI.

**Step 1 — widen the Tab union (`src/types.ts`).** Add the chat tab beside
`NoteTab` and widen `Tab`. Keep per-tab state to *view state only* — the
conversation transcript itself lives in a store keyed by `chatId`, mirroring how
note bodies live in `editor/model.ts` keyed by `noteId`, not on the tab
(`types.ts:28-29`: *"the document buffer is shared per noteId … tabs hold
cursor/scroll, never content"*). Apply the same law to chat.
```ts
export interface ChatTab {
  id: string;
  surfaceKind: "chat";
  chatId: string;            // the conversation; transcript lives in a store
  viewState: TabViewState;   // scroll position only
}
export type Tab = NoteTab | ChatTab;
```
This is the load-bearing edit. Because `Tab` was already a named alias over a
single-member union, *every* `panes.ts` helper that takes `Tab` keeps compiling;
TypeScript will now force a discriminant check anywhere code reads `tab.noteId`.

**Step 2 — fix the two `noteId` assumptions in `panes.ts`.** After Step 1, `tsc`
will flag exactly two spots (this is the union doing its job):
- `makeTab` (`panes.ts:27-29`) — fine as-is; it only ever makes note tabs. Leave
  it. Add a sibling `makeChatTab(chatId)` next to it.
- `split()`'s duplicate line, `makeTab(activeTabOf(leaf).noteId)`
  (`panes.ts:288`). `activeTabOf` returns a `Tab`, so `.noteId` no longer type-
  checks. Make split *surface-aware*: duplicate a note tab as a note tab, a chat
  tab as a chat tab (a split of a chat pane should show the same conversation):
  ```ts
  const active = activeTabOf(leaf);
  const dup = active.surfaceKind === "note"
    ? makeTab(active.noteId)
    : makeChatTab(active.chatId);
  ```
  Also audit `useFocusedNoteId` (`panes.ts:533-540`): it reads `tab?.noteId`. It
  must return `null` for a chat tab so the **note list selection** doesn't try to
  highlight a note when a chat pane is focused — return `tab.surfaceKind ===
  "note" ? tab.noteId : null`. This is the one place the sidebar's "mirror the
  focused pane" rule (`panes.ts:5`, the list mirrors the focused pane's active
  tab) needs a chat-aware guard.

**Step 3 — the open action.** Add a `chat.open` registry action next to the
existing tab actions in `src/keys/actions.ts`. The pattern is already there:
`notes.new` creates a note and calls `usePanesStore.getState().openNote(note.id)`
(`actions.ts:48-50`), and `tabs.new` calls `usePanesStore.getState().newTab()`
(`actions.ts:193`). Chat needs a store method `openChat()` that mints a
`chatId`, makes a `ChatTab`, and adds it to the focused leaf — copy `openNote`'s
new-tab branch (`panes.ts:319-339`) verbatim, swapping `makeTab` for
`makeChatTab`. Wire it to the ModuleSwitcher: the disabled "Chat" row
(`ModuleSwitcher.tsx:48-52`, currently `aria-disabled`) becomes a live
`menuitem` that runs `chat.open` and closes the popover — exactly how
`modules.notes` (`actions.ts:320-323`) closes the switcher today.

**Step 4 — the ChatSurface component.** New `src/components/ChatSurface.tsx`,
mounted from the second guard in `PaneTree.tsx:34-47`. It renders a transcript +
a composer. It consumes the corpus through `useNotes()` / `useNote()`
(`services/hooks.ts:18-27`) and a new `ChatProvider` (Step 6). No direct
`notesService` calls (the seam rule, `notes.ts:1-6`).

**Step 5 — retrieval (the "reads/searches the corpus" part).** MVP retrieval
needs no new Rust and no embeddings:
- Pull the full list once with `corpusList()` (already cached by TanStack Query
  under `keys.notes("all")`, `hooks.ts:8-23`).
- Rank candidates by a cheap keyword/title/snippet match over that list (the
  `title`/`snippet` fields are computed in Rust, `corpus.rs:252-297`, and already
  on the wire). Filter with `isHidden` (`destinations.ts:26-30`).
- For the top-k hits, fetch bodies with `corpusRead(id)` (`fsNotes.ts:66-84`).
- Assemble a prompt: the user's question + the k note bodies as cited context,
  each tagged with its `title` and `folderId` so the model can attribute answers.
- When the **real** FTS index lands (it's already on the roadmap, `roadmap.html:
  276-281`, "SQLite FTS5"), swap the keyword ranker for an FTS query behind the
  same retrieval function. The ranker is one module; this is intentional.

**Step 6 — the ChatProvider abstraction.** One TypeScript interface, two
implementations:
```ts
interface ChatProvider {
  stream(messages: ChatMessage[], opts: { context: CitedNote[] }):
    AsyncIterable<string>;
}
```
- `LocalChatProvider` — talks to a bundled local model over a localhost port
  the Rust shell owns (new Tauri command, mirrors how every other native call is
  guarded through `src/lib/tauri.ts` + registered in `lib.rs`'s
  `invoke_handler`, `lib.rs:379-404`). Default.
- `ByokChatProvider` — calls a user-configured endpoint with a key from the
  macOS Keychain (never from `.rotli/settings.json`; see the model decision).
  Opt-in.
The UI never knows which is active; Settings picks the provider, same as it
picks a theme today via `corpus_settings_write` (`corpus.rs:1182-1189`).

**Step 7 — live corpus updates.** Chat must not answer from a stale view. The
shell already emits `rotli:corpus-changed` on external edits (`lib.rs:420-422`,
the watcher), and `App.tsx` invalidates queries on it
(`onCorpusChanged` is imported at `App.tsx:23`). Because retrieval reads through
the same TanStack Query cache (`hooks.ts`), Chat's note list refreshes for free
on the next query — no extra wiring. Just make sure the retrieval call reads the
query cache rather than snapshotting once at mount.

### The model decision — bundled-local vs bring-your-own-key

This is the one decision that can violate rotli's founding principle, so address
it head-on. The principle is stated three places in the code and docs:
`roadmap.html:311` (*"Nothing phones home · no account · offline is the
default"*), the in-app seeded "Pricing decision" note (`notes.ts:299-304`:
*"Free local forever … Never gate local features behind the subscription — the
corpus is the user's, full stop"*), and the welcome note (`corpus.rs:439`: *"keep
them forever. rotli is just a warm window onto them"*). Already-shipped roadmap
work shows the house style: **Dictation v1 uses "Bundled local STT (Parakeet)"**
(`roadmap.html:284-288`) — local-first is not aspirational here, it's the
established pattern for the AI fronts.

**Recommendation: bundled-local is the default; bring-your-own-key is an explicit
opt-in, never the default, and the corpus is never uploaded without a per-action
consent.**

Rationale, grounded in rotli's own constraints:

- **The default must satisfy "offline is the default" (`roadmap.html:311`).** A
  cloud key as default would make the *first* chat phone home — a direct
  contradiction. So the default ships a small local model (a quantized
  instruction model in the few-billion-parameter range, runnable on Apple
  Silicon), exactly as Dictation ships Parakeet. Chat works on a plane, with no
  account, day one. That is the brand.
- **BYOK is a power-user escape hatch, not the product.** Some users will want a
  frontier model. Offer it, but: (a) it is off by default; (b) enabling it shows
  a one-time, plain-language consent that *the contents of cited notes will be
  sent to the endpoint you configured*; (c) the key lives in the **macOS
  Keychain**, never in `.rotli/settings.json` — consistent with the global
  convention (CLAUDE.md: *"Secrets stay in the macOS Keychain"*) and with
  `dot_file`'s deliberately tight allowlist that already refuses anything outside
  `settings`/`viewstate`/`background` (`corpus.rs:903-910`, and the test
  `settings_and_viewstate_are_opaque_json` asserts `dot_read("passwords")` is an
  error, `corpus.rs:1596`).
- **Never gate the corpus or local chat behind a subscription** — the pricing
  note is explicit (`notes.ts:301-302`). Local chat is a free-local feature.
  BYOK and (future) managed cloud sync are the paid lines, mirroring the
  seeded pricing decision (`notes.ts:303-304`: *"Paid = sync + managed AI"*).

Concretely in the abstraction: `LocalChatProvider` is the constructed default in
the provider switch (mirror `notes.ts:381`'s `FS_MODE ?` one-line decision);
`ByokChatProvider` is selected only when a key is present in the Keychain *and*
the user has flipped the consent toggle.

### Risks

- **`useFocusedNoteId` leaking a stale note selection (`panes.ts:533-540`).** If
  the chat-aware guard in Step 2 is missed, focusing a chat pane will leave the
  sidebar highlighting whatever note that tab "isn't." This is the single most
  likely correctness bug; cover it in tests.
- **Split duplication (`panes.ts:288`).** Forgetting the surface-aware branch
  there is a `tsc` error, so it can't ship — but get the *semantics* right: a
  split of a chat pane should show the **same** conversation (`chatId` shared),
  not a fresh one, matching how a note split shows the same `noteId`.
- **Privacy regression via BYOK defaults.** If BYOK is ever wired as the default
  provider, or the key is written to `.rotli/`, the founding principle breaks.
  Guard with the consent toggle and the Keychain rule above; assert it.
- **Context bloat / cost.** Stuffing whole bodies for many hits is slow locally
  and expensive on BYOK. Cap k and truncate per-note context; the `snippet`
  field (`corpus.rs:281-297`, ≤140 chars) is the cheap pre-rank signal.
- **Transcript persistence is out of MVP.** Decide explicitly: MVP keeps
  transcripts in memory (lost on quit), matching the "tabs hold no content" law
  (`types.ts:28-29`). Persisting chats to disk is a later step and, if done, must
  go through a *new* dot-file in the allowlist (`corpus.rs:903-910`), never a
  loose write.

### Test plan

- **Type-level (the cheapest guarantee).** After widening `Tab`, `bun run tsc`
  must surface exactly the `panes.ts:288` / `useFocusedNoteId` sites and nothing
  in `PaneTree`/`TabStrip`/`moveTab`/`detachTab` — proof the pane tree is
  surface-agnostic. If `tsc` flags more, the abstraction leaked.
- **Pane-tree unit tests (browser/in-memory).** Open a chat tab, then:
  reorder it (`moveTab` same-pane), move it cross-pane, detach it to an edge
  (`detachTab`), close it, split a pane that holds it. Assert the tree stays
  total and the chat tab keeps its `chatId` through every gesture — reusing the
  pure helpers in `panes.ts:37-114`.
- **Focused-selection test.** Focus a chat pane; assert `useFocusedNoteId()`
  returns `null` and the sidebar shows no note as active.
- **Retrieval test (in-memory service).** Seed the `InMemoryNotesService`
  (`notes.ts:206-224` `seedNote`) with known notes incl. one in `Archive`; assert
  the ranker never returns the archived note (the `isHidden` guard,
  `destinations.ts:26-30`).
- **Provider test.** A fake `ChatProvider` that records its inputs; assert the
  default constructed provider is `LocalChatProvider`, and that `ByokChatProvider`
  is only constructed when both the consent flag and a (mocked) Keychain key are
  present.
- **Live, in-shell (the seam only `cargo test` + in-memory exercise today).**
  `bun run tauri dev`, open Chat from the ModuleSwitcher, ask a question whose
  answer lives in a real note, confirm the answer cites that note by `title`,
  edit the note in another editor, confirm the watcher (`lib.rs:420-422`)
  refreshes Chat's view. This mirrors the roadmap's "Live on-disk test" gate
  (`roadmap.html:212-219`).

---

## Track 2 — memex-vault / memex multi-root  *(SUPERSEDED 2026-06-27)*

> **Replaced by the corpus.json unification.** The four files below
> (`corpus-root.txt`, `corpus-memex-root.txt`, `corpus-roots.json`,
> `memex-instances.json`) and the `<rootid>:path` multi-root scheme collapsed into ONE
> `corpus.json`: the corpus IS a memex by default (its folder is your brain), plus
> connected read-only `brains[]` and added `folders[]`; the active write target is the
> corpus when it's a memex, else the active brain. `self/` → `identity/`+`personality/`.
> Kept for history — do NOT implement as written.

### Status: deferred, on purpose

This is the next *structural* leap and it is already named on the roadmap
(`roadmap.html:248-255`, the "memex-vault wiring" card, tagged `planned`): point
**Brain → `~/memex-vault`**, introduce a `CorpusRoot{id,label,abs_path}` model, make
folder ids become `root:path`, and add a per-destination directory picker. It is
deferred not because the rotli side is hard, but because **memex-vault's own
structure is mid-change** — pointing Brain at a moving target would bake the
churn into rotli's id scheme. Defer until memex-vault stabilizes (see the checklist
at the end). The roadmap card even says it out loud: *"you're building memex-vault
now — untouched."*

### Goal

Let a reserved destination resolve to a directory **outside** the single corpus
root — specifically **Brain → `~/memex-vault`** — so rotli reads and writes the maintainer's
real knowledge base in place, without copying it into `~/Documents/rotli`. Today
there is exactly one root and one store; this track makes roots plural while
keeping single-root behavior bit-for-bit unchanged for everyone who never adds a
second root.

### The exact seams in today's code

Today the corpus root is decided in **one** place — `corpus.rs:31` literally
says so: *"the one place the corpus root is decided."* The relevant machinery:

- **Root resolution** — `resolve_root` (`corpus.rs:81-85`): saved root if it
  still exists, else `default_corpus_root` = `~/Documents/rotli`
  (`corpus.rs:39-48`). The saved root is a single line of text in
  `corpus-root.txt` in the app config dir (`read_saved_root`/`write_saved_root`,
  `corpus.rs:60-77`).
- **The store binds to one canonicalized root** — `CorpusStore { root, index,
  suppress, os_trash }` (`corpus.rs:441-452`), opened once at startup
  (`lib.rs:414`) and held as a single `CorpusState(Mutex<Option<CorpusStore>>)`
  (`corpus.rs:1097`, managed at `lib.rs:432`).
- **Folder ids ARE relative paths under that root** — the contract is stated in
  `NoteMeta.folder_id` (`corpus.rs:334-335`: *"Folder ids ARE paths"*) and mirrored
  on the TS side: `DEST.brain === folder.id` holds in both modes
  (`destinations.ts:1-6`, and `seedReserved`'s comment `notes.ts:196-204`).
  `abs(rel)` is just `self.root.join(rel)` (`corpus.rs:529-531`).
- **The reserved roots are scaffolded under the single root** —
  `ensure_reserved_folders` makes `Inbox/Brain/Storage/Archive/Trash` as plain
  subdirectories every open (`corpus.rs:498-511`). Brain is, today, just a folder
  named `Brain` inside `~/Documents/rotli`.
- **Relocation already moves a *whole* root atomically** — `relocate`
  (`corpus.rs:91-113`) refuses a non-empty target and a nested target, then
  renames every top-level entry; the command picks a folder, persists it,
  relaunches (`lib.rs:249-268`). This is the UX precedent the per-destination
  picker should feel like.
- **The watcher is per-root** — `spawn_watcher(root, …)` (`corpus.rs:1032`,
  spawned once at `lib.rs:420`). Multi-root means multiple watchers.

### The `CorpusRoot{id,label,abs_path}` design

```rust
pub struct CorpusRoot {
    pub id: String,        // stable handle, e.g. "default" or "brain"
    pub label: String,     // sidebar label, e.g. "Brain"
    pub abs_path: PathBuf,  // resolved absolute dir, e.g. ~/memex-vault
}
```

- **ids become `root:path`.** A note's `folderId` goes from `"Brain/Work"` to
  `"brain:Work"` — the part before `:` selects the `CorpusRoot`, the part after
  is the relative path under that root's `abs_path`. The default root keeps a
  reserved id (e.g. `"default"`) so today's `"Inbox"`, `"Brain"`, `"Storage"`
  ids migrate to `"default:Inbox"` etc. This is the roadmap's exact phrasing
  (`roadmap.html:251`: *"ids become `root:path`"*).
- **Why `:` is safe.** `validate_component` (`corpus.rs:940-945`) already forbids
  `/`, `.`-prefixes, `..`; `:` is a new top-level *router* character that never
  appears inside a path component, so the parse is unambiguous: split once on the
  first `:`. `validate_rel` (`corpus.rs:930-938`) stays the guard for the
  *path* half.
- **The store becomes a `CorpusStore` per root, fronted by a registry.**
  `CorpusState` (`corpus.rs:1097`) goes from `Option<CorpusStore>` to a map
  `HashMap<String /*root id*/, CorpusStore>` plus the default-root id. Each
  command resolves `root:path → (store, rel)` once at the top, then runs exactly
  as it does now — `read`/`write`/`move_note`/`create`/`list` are unchanged below
  that routing layer because they already operate on a relative `rel` against
  `self.root` (`corpus.rs:529-531`).
- **`list` aggregates across roots.** `corpus_list` (`corpus.rs:1107-1110`) walks
  each root and prefixes every emitted `folder_id`/`folderId` with `"<rootid>:"`.
  The TS `isHidden` predicate (`destinations.ts:26-30`) gets a root-aware variant:
  Archive/Trash are *per root* (`brain:Archive`, `default:Archive`), so a note
  archived out of Brain stays in Brain's Archive — the origin breadcrumb rule
  (`corpus.rs:660-695`) is already path-relative and works unchanged within a
  root.
- **The per-destination directory picker.** Reuse the relocate flow's folder
  dialog (`lib.rs:249-268`, `blocking_pick_folder`) but instead of *moving* the
  corpus, *register* the picked dir as the `abs_path` for a destination's root.
  Persist the root registry beside `corpus-root.txt` (`corpus.rs:52-58`) — a new
  `corpus-roots.json`, same app-config-dir home, same "outside the corpus so it
  can move" reasoning (`corpus.rs:50-51`). Pointing **Brain → `~/memex-vault`** is
  then: register a `CorpusRoot{ id:"brain", label:"Brain", abs_path: ~/memex-vault }`
  and route `brain:*` to it. Spawn a second watcher on `~/memex-vault`
  (`corpus.rs:1032`) so external edits there fire `rotli:corpus-changed` too
  (`lib.rs:420-422`).

### Why today's reserved-folder model "upgrades cleanly into it"

The roadmap claims this (`roadmap.html:253`). It's true because the indirection
already exists: nothing in the codebase hardcodes a *physical* path for Brain.
`DEST.brain` is the string `"Brain"` (`destinations.ts:11`), used as an *id*, and
the contract that *id === path* is already a documented convention, not a
filesystem fact (`notes.ts:196-204`). Re-pointing Brain is "make the id `brain:`
resolve to a different `abs_path`," which is a routing change, not a data
migration for the user's other notes. The in-memory mode's `seedReserved`
(`notes.ts:200-204`) was built specifically so `DEST.brain === folder.id` holds
"in BOTH modes" — multi-root just makes the resolution of that id configurable.

### Build sequence (when un-deferred)

1. **Introduce `CorpusRoot` + a root registry** behind `CorpusState`
   (`corpus.rs:1097`), with the default root pre-registered as id `"default"`
   pointing at today's `resolve_root` result (`corpus.rs:81-85`). No behavior
   change yet — one root, id `"default"`.
2. **Add the `root:path` parse** at the top of each command in
   `corpus.rs:1107-1167`. With one root, `default:` is implied/optional so the
   wire stays backward-compatible during rollout.
3. **Migrate ids on the TS side.** `DEST` (`destinations.ts:10-16`) values become
   `"default:Inbox"`, `"default:Brain"`, …; `isHidden` (`destinations.ts:26-30`)
   becomes root-aware. The in-memory `seedReserved` calls (`notes.ts:257-267`)
   update in lockstep so browser mode mirrors fs mode (its whole reason to exist).
4. **Multi-watcher.** Lift the single `spawn_watcher` (`lib.rs:420`) into a loop
   over registered roots; debounce stays per-root (`corpus.rs:1027`).
5. **The per-destination picker** in `SettingsSurface.tsx` (Location pane, formerly Storage),
   reusing the dialog from `corpus_relocate` (`lib.rs:249-268`) but registering
   rather than relocating. Add a `corpus_set_root(dest_id, abs_path)` command
   beside the others in the `invoke_handler` (`lib.rs:379-404`).
6. **Point Brain at `~/memex-vault`** as the first real consumer — only after the
   checklist below is green.

### Risks

- **id migration is a one-way door.** Every `folderId` on the wire and in the TS
  layer changes shape. Old `.rotli/index.json` (`corpus.rs:430-435`) keys notes
  by id (ulid), not folder, so the *index* survives; but any persisted UI state
  that stored a `folderId` (selection, viewstate) needs a migration. Stage the
  `default:` prefix as optional first (Step 2) to make it reversible.
- **`~/memex-vault` is not a flat notes folder.** It has `self/`, `wiki/`, `history/`,
  `chats/`, `MAP.md`, `inbox.md`, a `STRUCTURE.md` layout contract, and a hard
  rule that **binaries never live in it** (CLAUDE.md). rotli's `walk`
  (`corpus.rs:949-1016`) only surfaces `.md` files and skips dot-entries — good —
  but it will surface *every* `.md` across all of memex-vault's subtrees as notes,
  which may not be the intended view. Needs a per-root include/scope rule before
  it's usable, not just a path.
- **Frontmatter collision.** rotli *owns* four frontmatter keys and bumps
  `updated` on every write (`corpus.rs:600-658`); foreign keys pass through
  (`corpus.rs:218-239`). memex-vault notes may already carry their own frontmatter
  conventions and `[[wikilinks]]`; confirm rotli's writeback (the four-fact block
  + atomic rename, `corpus.rs:597-658`) is acceptable to memex-vault's own tooling
  (`bun ~/memex-vault/scripts/validate.ts`) before letting rotli write there.
- **Two tools writing one tree.** memex-vault has its own git remote and validation;
  rotli's atomic writes + watcher (`corpus.rs:406-426`, `1032-1063`) must not race
  memex-vault's tooling. The suppress set (`corpus.rs:387-404`) handles rotli's *own*
  echoes, not a third writer.

### Test plan (when un-deferred)

- **Single-root regression first.** With one root registered as `"default"`, the
  entire existing `cargo test` suite (`corpus.rs:1193-1674`) must pass unchanged
  — the routing layer is transparent. This is the gate before any second root.
- **`root:path` parsing unit tests.** `"brain:Work/Notes"` → `("brain",
  "Work/Notes")`; `"default:Inbox"` → `("default", "Inbox")`; a bare `"Inbox"`
  (legacy) → `("default", "Inbox")`. Reject `:`-in-component via the existing
  `validate_component` path (`corpus.rs:940-945`).
- **Two-root walk.** Register a temp second root; assert `corpus_list` returns
  notes from both, each `folderId` correctly prefixed, and that `isHidden`
  scoping is per-root (archiving in root A never hides a note in root B).
- **Origin rule within a root.** Re-run `move_into_archive_stamps_origin…`
  (`corpus.rs:1476-1510`) against a non-default root — the breadcrumb must stay
  root-relative.
- **memex-vault dry-run.** Point a *throwaway copy* of `~/memex-vault` as Brain, run
  memex-vault's own `validate.ts`, and confirm rotli's writeback leaves it valid —
  before ever pointing at the real one.

### What must stabilize in memex-vault first (the un-defer checklist)

Do **not** start Track 2 against the real `~/memex-vault` until all of these are true:

1. **`~/memex-vault/STRUCTURE.md` is stable.** It is the named layout contract
   (CLAUDE.md: *"read it before moving things; tools resolve its logical roots,
   never hardcode deep paths"*). rotli's per-root scope rule must read from it,
   so it cannot move while we wire to it.
2. **The logical roots are frozen** — `self/`, `wiki/`, `history/`, `chats/`,
   `MAP.md`, `inbox.md`. rotli needs to know *which* of these are note-folders it
   should surface vs. control files it should ignore.
3. **The frontmatter convention is decided.** Confirm whether memex-vault notes carry
   frontmatter today and whether rotli's four-fact block + `updated` bump
   (`corpus.rs:600-658`) is welcome, or whether Brain should be read-mostly.
4. **The chats/history shapes settle.** memex-vault's `chats/` is explicitly modeled
   on rotli ("everything has a chat", CLAUDE.md) — if Track 1's Chat is going to
   *write* into `chats/`, that format must be fixed first. This couples Track 1
   and Track 2: Chat-writes-to-Brain is the convergence point, and it can't be
   designed against a moving `chats/` schema.
5. **The binaries rule is enforced** (`bun ~/memex-vault/scripts/validate.ts`, the
   `storage:` link convention). rotli must never surface or write a binary into
   memex-vault; confirm `walk`'s `.md`-only filter (`corpus.rs:981`) plus a per-root
   guard is sufficient.
6. **memex-vault's git/validation cadence is understood**, so rotli's watcher +
   atomic writes don't fight memex-vault's tooling (see the "two tools" risk).

Until those are green, **leave Brain as a plain folder under `~/Documents/rotli`**
(today's `ensure_reserved_folders`, `corpus.rs:498-511`). The multi-root scaffold
(Steps 1–5) can be built and tested against throwaway roots independently of
memex-vault — only Step 6 waits.

---

## Ordering

Track 1 (Chat) is unblocked and should ship next — it's pure additive type work
over a pane tree that was designed for it (`types.ts:1-3`), uses only read paths
that already exist (`corpus.rs:1107-1115`), and is the literal next promise in
the ModuleSwitcher (`ModuleSwitcher.tsx:18`). Track 2 (multi-root) is built in
two halves: the root-registry scaffold (Steps 1–5) can proceed in parallel
behind a single `"default"` root with zero user-visible change; pointing Brain at
the real `~/memex-vault` (Step 6) waits on the six-item memex-vault checklist above.
