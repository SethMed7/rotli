# Bringing an existing vault into Rotli: work on a copy, stay Obsidian-readable

Status: **accepted direction; slices 1, 1b, 3, and 5 built** (2026-10-13);
**decision I built** (2026-10-15).
The owner decided A, B, and C below the same day. Slice 4 (a Rotli vault
from the copy, with the Librarian) is next. Until it lands, a copy opens
protected, like a folder opened in place.

## The law

> We will never be the cause of someone losing notes. — owner, 2026-10-13

1. **The original is never organized.** Rotli does not move, rename, file,
   rewrite the frontmatter of, or delete anything in a vault the person brought
   with them. The Librarian works only on a copy Rotli made.
2. **Rotli never deletes the original and never offers to.** If the person
   later throws the old folder away, that is their own decision, made outside
   Rotli.
3. **A vault Rotli writes stays readable in Obsidian.** Plain Markdown, YAML
   frontmatter, wikilinks that resolve, and attachments as ordinary files.
   Anything Rotli-only must degrade to something Obsidian still shows.

## Today (verified 2026-10-13)

- **Opening an existing folder adopts it in place.** Setup and the switcher's
  Connect open an Obsidian, ZenNotes, or Markdown folder as an *adopted* corpus
  (`CorpusStore::open_adopted`, `src-tauri/src/corpus.rs:2883`). Adopting adds
  only a hidden `.rotli/`: no marker, no reserved folders, no Welcome folder.
  Inspecting a folder is read-only and labels `.obsidian/` as "Obsidian vault"
  (`inspect_vault_path`, `src-tauri/src/lib.rs`).
- **The Librarian is not meant to run on an adopted folder.** Its input is
  `wiki/**/*.md` (`candidate_rel`, `src-tauri/src/organizer.rs`), and it
  reports running only when the open vault is a Rotli vault. An Obsidian vault
  with no `wiki/` folder is never organized. Whether it fully stands down for
  an adopted folder that happens to have a `wiki/` folder is **unverified**;
  slice 1 proves it with a test.
- **Gap 1: secure auto-flagging moves notes in the original.** Opening a note's
  metadata panel runs the secret detector on the read path. A note that looks
  secret, or whose name has a secure keyword, gets `secure: true` and a
  `.gitignore` entry, and is moved into `Secure notes/` at the folder root
  (`read_frontmatter` → `set_secure` → `relocate`, `src-tauri/src/corpus.rs`).
  Adopted folders are writable, so this happens inside the person's Obsidian
  vault. Nothing is lost, but the original is rearranged without being asked.
- **Gap 2: editing in place stamps frontmatter.** A body save of a fenced
  imported note fills a missing `id`, `created`, and `updated`. A rename adds
  the old title to `aliases` (`docs/architecture/memex-data-contract.md`,
  Metadata ownership). That is expected when someone edits a note, but it is
  still a change to the original. *Fixed by slice 1b, along with the Mac
  renaming a saved note's file to its title slug.*
- **The copy primitive exists but nothing calls it.**
  `corpus_import_vault_copy` + `copy_vault_tree` (`src-tauri/src/lib.rs`)
  copy a vault into an **empty** folder outside the source. The copy keeps
  `.obsidian/` and skips `.rotli/`, `.git`, `node_modules`, and symlinks. Then
  it opens the copy, still as an *adopted* folder, so the Librarian would not
  organize it either. Tests cover read-only inspection and refusing a
  non-empty destination. No TypeScript caller exists.

## The flow

### 1. Detect

The copy matters only for the Librarian: it is the one thing that moves and
renames notes, and it never runs on a person's original (decision G). A
folder connected in place is already safe without it. So the question is
asked by stage, when the chosen folder already holds notes
(`inspect_vault_path` says Obsidian vault, ZenNotes vault, or Markdown
folder):

- **Setup** just connects it in place. The Librarian is setup's own later
  step; there, in a folder connected in place, its only "on" choice is
  **Use the Librarian on a copy**, which copies the folder and opens the copy
  with the Librarian on.
- **Adding a vault** (the switcher's Connect, a folder window's Add as vault)
  confirms right after the pick, because by now the person knows the
  Librarian:
  - **Connect.** "Rotli opens these notes where they are. You read and edit
    them as usual; nothing is moved or renamed, and the Librarian stays off
    here." This is the protected mode (step 5).
  - **Connect a copy with the Librarian.** "Rotli copies the folder beside
    your vaults, and the Librarian organizes the copy, suggesting each change
    first. Your original stays exactly as it is."
- **A folder already connected in place** offers the same copy from
  Settings → Librarian, in place of the Librarian's controls.
- **No way around it (decision H).** The Librarian is never on for a folder
  connected in place: the switch reads off and refuses on in the webview
  (`services/librarianSwitch.ts`), Rust reports it off
  (`corpus_list_config`), and the organizer never models such a folder
  (`organizer_adopted_tests.rs`). An empty folder becomes a fresh Rotli
  vault, so it needs no copy.
- Every copy offer carries a closed **Why a copy?** disclosure
  (`components/whyCopy.tsx`): the Librarian moves and renames notes, so it
  only ever organizes a copy Rotli made, and the original is never moved,
  renamed, edited, or deleted by Rotli.

### 2. Copy

- The destination defaults to a new folder beside Rotli's other vaults, named
  `<original name> (Rotli)`. The person can pick another empty folder. Never a
  folder inside the source, and never the reverse (already enforced).
- The copy keeps everything a person would miss: notes, attachments,
  `.obsidian/`, `.canvas`, `.excalidraw`, Office files, and Obsidian's
  `.trash/`. It skips `.rotli/`, `.git`, and `node_modules`.
- **Symlinks are not followed.** The summary lists them by name ("3 linked
  items were not copied"), so a missing linked note is never silent.
- Progress shows files copied and total size. **Cancel** stops the copy. It
  removes only files the copy wrote into the folder Rotli itself created for
  it, and never touches the source.

### 3. Verify before anything else happens

Before the copy opens, Rotli compares source and copy: the file count, total
bytes, and a content hash of every Markdown file. Any difference stops the flow
with the list of files and leaves both folders as they are. The verification
result is written to `.rotli/import.json` in the copy: the source path, the
time, the counts, and the skipped items. The copy can always say where it came
from.

### 4. Organize the copy

The copy becomes a real Rotli vault (marker + `.rotli/`), so the Librarian can
work on it. **The original tree stays at the copy's root** (decision A): notes
keep their folders, Obsidian settings that name paths keep working, and the
Librarian learns to organize that layout instead of only `wiki/**`. The first Librarian pass on an import runs at
**Suggest** (nothing moves without a person) until the person turns it up.
After that, it follows the vault's normal setting.

#### Slice 4 design (proposed 2026-10-14, for owner review)

Owner decisions (2026-10-14):

- **D. New notes land in a top-level `Inbox/`.** The Librarian sorts from
  there into the person's folders, at Suggest first. A copied `Inbox/` is
  used as that inbox.
- **E. `_index.md` folder notes are written** in the folders the Librarian
  organizes, the same as in a Rotli vault.
- **F. Name collisions: the person's folders stay theirs.** A copied
  `Archive/`, `Trash/`, `chats/`, `storage/`, or `wiki/` is an ordinary folder.
  Rotli keeps its own under names of its own.

What the code needs (sized 2026-10-14):

- **A marker that says "imported", in `memex.json`.** `.rotli/` is
  rebuildable (rotli-001), so the signal can't live in `import.json`. The
  marker gains `"layout": "imported"` and a **role map**, written once when the
  copy is made, for example `"folders": {"inbox": "Inbox", "archive": "Archive
  (Rotli)", "trash": "Trash (Rotli)", "chats": "chats (Rotli)", "storage":
  "storage (Rotli)"}`. Rotli's folders in an imported vault are always
  suffixed, not only on a clash, so there is one code path. This is a
  **contract bump** (3.8 → 3.9). The supported band is `[3.4, current]`, so
  existing vaults stay read-write, and an older Rotli opens an imported vault
  read-only instead of hiding its tree.
- **A new layout, `Imported`.** In a Rotli vault's layout, every top-level
  folder Rotli doesn't own is Hidden, so a marker alone would make the
  person's whole tree vanish. `Imported` surfaces every folder. Its
  Archive/Trash/chats/storage are the role map's folders, so a copied
  `Archive/` is never read as Rotli's archive.
- **The person's file names are kept.** A Rotli vault renames a note's file
  to its title on save. In an imported vault that would break Obsidian's
  `[[File name]]` links (law 3), so imported notes keep their file names, as
  with a folder opened in place. Frontmatter stamps (`id`, dates) are allowed:
  Obsidian shows them and nothing breaks. The Librarian moving a file between
  folders keeps its name, so Obsidian's links still resolve.
- **Size.** About 51 Rust branches on the layout, about 40 Rust name-helper
  calls (`is_hidden_root`, `lifecycle_disk_folder`, `project_folder`, …),
  and about 130 TS uses of Rotli's folder constants (`DEST`, `isSink`,
  `isChats`) and their parity fixture. Rotli-vault and legacy layouts keep
  today's constants from the same functions, with a test that pins them.

Stages (one PR each, held for review):

1. **4a: the imported vault.** The contract bump, the marker and role map,
   `Imported` surfacing, names kept, and the copy marked at import with its
   first Librarian setting at Suggest. A copied Rotli vault (one that already
   has an `mx_` marker) stays a Rotli vault. A copied foreign `memex.json` is
   never overwritten: that copy opens protected, and the summary says why.
2. **4b: Rotli's folders by role.** Rust and TS read Archive, Trash, chats,
   storage, and Inbox from the role map (the `DEST`/`isSink` sweep plus
   parity), so decision F holds end to end.
3. **4c: the Librarian on the imported tree.** Candidates anywhere in the
   tree. Areas are the person's top-level folders. Classify from `Inbox/`,
   file into areas, and write `_index.md` (decision E).

Until 4b lands, an imported vault would read a copied `Archive/` as Rotli's,
so 4a and 4b ship together or 4a stays unmerged.

**4a + 4b built (2026-10-14, one PR, in review).** As specified, with these
choices made while building (contract: `docs/architecture/memex-data-contract.md`):

- The role map has five roles (inbox, archive, trash, chats, storage). A
  secure flag in an imported vault stays on the note where it is, as in a
  folder opened in place, so no secure folder is needed; a capture lands in
  `Inbox/` with the capture shelf and reads under Captures.
- Ids in an imported vault are disk paths, so Rotli's sinks are
  `Archive (Rotli)` and `Trash (Rotli)` end to end (Rust, the webview's
  `DEST`, and Rotli Web).
- Names are kept for every note in an imported vault, the ones Rotli creates
  there included, on save and on move (a move into Trash too).
- The webview sees an imported vault as a plain vault with a role map, not a
  memex: its notes go through the corpus store, never the memex note lane
  (`wiki/_inbox`), and the Library and Librarian stay off until 4c. Chat
  transcripts are not saved into an imported vault yet, the same as the
  protected copy before it; the chat lane (`chats (Rotli)`) is wired in Rust
  for when they are.
- Empty Trash in an imported vault reaches only `Trash (Rotli)`, never the
  person's `Trash/`.
- **Decision G, built with it (owner, 2026-10-14):** setup connects a folder
  of notes in place without asking; adding a vault confirms *Connect* or
  *Connect a copy with the Librarian*; Settings → Librarian in a folder
  connected in place offers that copy instead of the Librarian's controls.
  The copy's Librarian is **on, at Suggest**: the switch belongs to each
  vault and is never carried from the previous one (it was, in the first
  cut). Until 4c the Librarian still stands down on the imported tree.
- **Decision H, built with it (owner, 2026-10-14):** setup's Librarian step
  offers only *Use the Librarian on a copy* in a folder connected in place,
  and the switch is held off there on every surface (see step 1). Found
  while building: setup never mounted the copy dialog, so slice 3's setup
  question could never be answered there; setup now mounts it for the
  Librarian step's copy.
- Correction to the earlier sizing note: an older Rotli opens a 3.9 vault
  read-only *in its Rotli-vault layout*, which hides the person's tree. It
  cannot lose notes there, but it does not show them.

**Decision I, built (2026-10-15, one PR).** Contract:
`docs/architecture/memex-data-contract.md` (the `inPlace` field, chat in
brought-in vaults).

- **The marker.** Connecting a folder in place (setup and the switcher share
  `corpus_choose_folder`) writes the imported marker with `"inPlace": true`
  before the folder opens (`vault_roles::mark_in_place`). Every open path
  reads it (`vault_roles::in_place`), so the store is adopted however the
  folder is reopened, and Rotli Web reads the same field
  (`vaultOpenedInPlace`). The marker heal then gives it a backup marker, and
  an empty `.obsidian/` if it has none (an Obsidian vault already does).
- **Kept in place:** no stamps on the person's notes (decision B), no
  detector writes, the secure line only where asked, no link conversion, Main
  seeded from disk, and the Librarian refused three ways (the switch reads
  off, the store's `brain_enabled`, the filer gate).
- **Dropped in place:** the file Trash/Archive block. With Rotli's own sinks
  there, a file moves like in a copy. A folder opened in place before
  decision I has no marker, so it keeps the block (its own `Trash/` would
  read as Rotli's).
- **Chat** writes into the brought-in vault (its role map's chats folder).
  Fixed with it: an imported active vault with a connected brain beside it
  wrote its chats into the brain. New notes, captures, a chat's memory note,
  and "save chat as note" take the corpus store into its Inbox; no `wiki/`
  is ever made there.
- **Chat with no vault** offers *Connect vault*, the switcher's own Connect
  flow (`components/sidebar/useConnectVault.ts`).
- **The Archive and Trash question.** In a copy whose Librarian is on, when
  its own top-level `Archive/` or `Trash/` holds files, Rotli asks once, in
  a callout that pops out of the sidebar beside its Archive and Trash rows
  (owner, 2026-10-15; `components/personSinksPopout.tsx`). It waits for the
  copy dialog and setup's thank-you card, and closes on its own after ten
  seconds (paused while pointed at or focused), or with ×, Esc, or a click
  elsewhere; closing without an answer only hides it for this session:
  "Your vault has its own Archive and Trash folders. Move their notes into
  Rotli's Archive and Trash so the Librarian treats them as archived and
  trashed?" **Yes** moves every file into `Archive (Rotli)/` or
  `Trash (Rotli)/`, keeping its name and its place below the folder
  (`Archive/2024/a.md` → `Archive (Rotli)/2024/a.md`, so a note's relative
  image links still resolve), and stamps each note's `origin` like a normal
  archive or trash (Restore sends it back). **The person folder is removed
  only when it is left empty** — nothing in it but empty folders and Finder's
  `.DS_Store`; anything that didn't move (a linked item) keeps it. **No**
  moves nothing. Dismissing the question counts as No. The answer is saved in
  the vault's `.rotli/settings.json` as `personSinksAnswer`
  (`"<vault id>:moved"` or `":kept"`), keyed by the vault's id because
  settings are carried to a new vault: a later copy is asked for itself.
  Never asked in place (`corpus_person_sinks.rs`, `services/personSinks.ts`).

**Already true today, for the record:** a folder opened in place reads its
own `Archive/` and `Trash/` as Rotli's (the name checks have no layout).
Slice 1 stops Rotli *moving* anything there, but notes in a person's
`Archive/` still show as archived. Decision F could apply to folders opened
in place too, once 4b exists. *Done by decision I (2026-10-15) for every
folder connected in place from then on.*

### 5. Protected originals (open in place)

An adopted folder, and the source of any import, is **protected**:

- No Librarian, ever.
- The secret detector still refuses flagged notes to cloud models (that
  protection stays), but writes nothing: no `secure: true`, no move. Cloud
  reads already refuse a detected note from its content alone, so no record is
  needed.
- **Making a note secure by hand** in a protected folder keeps it where it is
  and adds one `secure: true` line plus its gitignore line. Nothing else
  changes; un-securing restores the file byte-for-byte. *Amended 2026-10-13
  from "store the flag in `.rotli/`":* a `.rotli/` record would have to be
  keyed by path or content, and it would silently stop protecting the note
  when Obsidian renames or edits it. Secure notes must fail closed, and only
  frontmatter travels with the file. The person asked for this one line, so
  decision B still holds.
- Ordinary edits the person makes are allowed; that is what "open in place"
  means. **Rotli adds nothing to the note** (decision B): no `id`, `created`,
  `updated`, or rename `aliases` in a protected folder's frontmatter. Rotli
  keeps those facts in `.rotli/` instead. The note's text is exactly what the
  person wrote.
- Enforcement lives in the core, not only in the UI. The Mac marks an adopted
  store (`CorpusStore.adopted`, derived from the marker's `inPlace` since
  decision I); Rotli Web decides by the same marker (`vaultOpenedInPlace`). The
  person's own moves (a sidebar drag) still work. The Librarian already writes
  only in a Rotli vault (`filer_writable`), and now it never sweeps, queues, or
  models any other folder.
- **Known web gap (not slice 1):** outside the secure toggle, Rotli Web still
  treats any folder with a `wiki/` folder as a Rotli vault for layout
  (`vaultIsMemex`), unlike the Mac's marker check. That doesn't move notes, but
  it should be aligned with the marker.

## Obsidian compatibility

| What Rotli writes | In Obsidian | Plan |
| --- | --- | --- |
| Markdown body, YAML frontmatter (`id`, `created`, `updated`, `aliases`, `tags`, unknown keys kept byte-for-byte) | Reads fine; Properties shows the extra keys | Keep |
| `[[wikilinks]]` by title, file name, or alias | Resolves (Obsidian also matches aliases) | Keep; covered by the audit |
| `.canvas` | Byte-for-byte JSON Canvas | Keep |
| `mermaid` fences | Renders | Keep |
| `chart` fences | Shows as a code block | Acceptable degrade; documented |
| Images linked with the `storage:` scheme | **Broken image** (unknown scheme) | Write a standard Markdown path relative to the note (owner, 2026-10-13); keep reading `storage:` |
| File embeds as ```` ```sheet ```` / ```` ```document ```` / ```` ```board ```` fences | Code block | Write Obsidian's `![[file]]` (owner, 2026-10-13); Rotli renders it as the live editor and keeps reading fences |
| Boards as `.excalidraw` | Opens only with the Excalidraw plugin | Document; no change |
| `secure: true` | Ignored; Obsidian AI plugins can read secure notes | Document clearly: Rotli's protection is Rotli's, not the folder's |
| `.rotli/`, empty `.obsidian/` | Hidden / filled by Obsidian on first open | Keep |

## Proof

- **Compatibility audit** (`scripts/obsidian-compat-audit.ts`, read-only):
  walks a vault and reports anything Obsidian won't show the same way, by file:
  `storage:` links, unresolved wikilinks, `chart` fences, and boards. It also
  audits the owner's own vaults without changing them.
- **Round-trip fixture:** a synthetic Obsidian vault, copied by the flow. The
  test asserts the source tree is byte-identical afterwards: hashes before and
  after, including after a Librarian pass, a secure flag, and a rename in the
  copy.
- **Protected-root tests:** Rust refuses `relocate`, `file_note`, and Librarian
  writes on a protected root, and the auto-secure read path writes nothing
  there.
- E2E: choose an Obsidian fixture in setup → *Work on a copy* → verify → copy
  opens; the source fixture hash is unchanged.

## Slices

1. Protected originals: close Gap 1 for adopted folders, plus tests on both
   the Mac and web. This is the safety fix and is useful on its own.
   **Merged (#212).**
1b. Decision B, built: a person's note in a folder opened in place (`id` not a
   ULID) keeps its file name and frontmatter bytes on every save, move, and
   metadata control; only the asked-for line changes. Found while building it:
   Mac saves also **renamed the file to a title slug**, breaking Obsidian's
   file-name links. That is fixed too. Notes Rotli creates there still follow
   their title. Decision C (the one-time offer) remains its own slice.
2. The compatibility audit script, plus a run over the owner's vaults
   (read-only report).
3. The copy flow: choice screen, copy with progress, verification, and
   `import.json`. **Built** (`src-tauri/src/vault_import.rs`,
   `src/components/vaultImportDialog.tsx`):
   - Setup's folder step, the sidebar's Connect, and a folder window's Add as
     vault ask *Work on a copy (recommended)* or *Open in place* for a
     Markdown/Obsidian folder. A Rotli vault and an empty folder never ask.
   - Rotli plans the copy, then copies into `<name> (Rotli)` beside the
     person's vaults (the folder picker's start; ` 2`, ` 3`… on a clash).
     Progress shows files and MB.
   - **Cancel** takes no vault lock and stops between files. A folder Rotli
     made goes whole; a picked empty folder keeps itself.
   - **Verify** compares every path and size, and the content of every
     Markdown file, against the plan. A mismatch opens nothing and leaves
     both folders.
   - `.rotli/import.json` records the source, time, counts, and the linked
     items not followed. It survives opening the copy.
   - The copy then opens, protected, until slice 4.
   - The old unused `corpus_import_vault_copy` is replaced.
4. Organize-the-copy: a Rotli vault from the copy, Librarian at Suggest first.
5. Obsidian-readable images and embeds (owner decisions 2026-10-13: images as
   standard Markdown paths relative to the note; `/sheet`, `/board`,
   `/document` as `![[file]]`; an opt-in converter for existing links).
   - **5a, reading (in review):** Rotli shows note-relative images,
     `![[image]]`, and whole-line `![[file]]` embeds of sheets, documents, and
     boards, on the Mac and the web. A missing image's link is repaired in
     place only for Rotli's own `storage:` form; any other link is shown from
     where the file is found and never rewritten. Deferred to 5b: the link
     index and graph still count `![[file]]` as a note link, and inline
     (mid-sentence) `![[x.png]]` stays text.
   - **5b, writing (in review):** dropped, pasted, and attached images write a
     standard path from the note; `/sheet`, `/board`, `/document`, and the
     Mermaid-to-board swap write `![[path]]`. Readers learned the new forms:
     image tidy-up after Trash/Archive (decodes `%20`, resolves from the note,
     never cascades a `![[name]]`), Hand to AI (resolves from the note; a link
     is secure if either reading is; `![[file]]` embeds of secure files are
     refused), image copy, and the agent attachments tool (Rust). The link
     index and graph treat `[[file.ext]]` as a file (parity fixture). AI tool
     and chat images keep `storage:` (they don't know the note). **The
     constraint holds:** in a folder opened in place no file is ever moved to
     Trash or Archive (Mac `storage_file_lifecycle_block`, web
     `moveFileToSink`). *Amended by decision I:* only for a folder opened in
     place before it (no marker); one connected since has Rotli's own sinks.
   - **5c, the converter (in review):** Settings → General → Link format
     counts the Rotli-only links on open, shows up to five before → after lines,
     and converts on a click: `](storage:X)` → the standard path from the note
     (the same `noteImageLink` form new images get; Rust `note_image_link`,
     parity fixture `noteImageLink`), and a whole ```` ```board ````/
     ```` ```sheet ````/```` ```document ```` fence → `![[path]]`. Other code
     blocks and inline code stay as written; frontmatter bytes are kept; each
     note is re-read under its lock. A folder opened in place is refused. Mac
     app only, like Leftover note names; both now share one Settings row
     (`VaultPassSettings`) and one command (`corpus_vault_pass`).

## Decisions (owner, 2026-10-13)

- **A. Where the copy's notes live: keep the original tree at the root.** The
  Librarian learns the adopted layout; nothing is moved under `wiki/` just to be
  reachable.
- **B. In-place edits stamp nothing.** A protected folder's notes never gain
  Rotli frontmatter. Identity, dates, and rename aliases for them live in
  `.rotli/`.
- **C. Existing users get one offer.** Folders already adopted in place become
  protected automatically, and after the update Rotli offers *Work on a copy*
  once, dismissibly. Nothing happens unless the person accepts. *Amended by G
  (2026-10-14): the offer lives in Settings → Librarian instead of a one-time
  prompt, since only someone who wants the Librarian needs it.*
- **G. The copy is for the Librarian, asked by stage (2026-10-14).** Without
  the Librarian nothing is organized, so a folder connected in place needs no
  copy. Setup connects in place and leaves the Librarian to its own step;
  adding a vault confirms *Connect* or *Connect a copy with the Librarian*;
  a folder connected in place offers the copy from Settings → Librarian. The
  Librarian switch is decided per vault: the copy's starts on, at Suggest.
- **I. In place has the same layout as a copy; only the Librarian differs
  (2026-10-15).** "Nothing in functionality changes. The copy just copies
  the whole folder into a new one named '(Rotli)' and works as normal. … The
  only purpose of the copy is to not let the Librarian damage the original
  vault." So a folder connected in place gets the copy's marker and role map
  plus `"inPlace": true`: Rotli's own folders are suffixed (`Archive (Rotli)`,
  `Trash (Rotli)`, `chats (Rotli)`, `storage (Rotli)`), notes keep their file
  names, chat writes into the vault, captures and new notes land in `Inbox/`
  (an existing one is used as is, decision D), and Trash and Archive work.
  The only differences: the Librarian never runs there, and Rotli never
  stamps the person's notes (decision B stands). "Make a copy" from such a
  folder gives the copy a fresh marker (new id, no `inPlace`) and its
  Librarian on, at Suggest. A copy with the person's own top-level `Archive/`
  or `Trash/` holding files asks once whether to move them into Rotli's
  (below). Built: see *Decision I, built*.
- **H. The Librarian on a folder of notes is always a copy (2026-10-14).**
  No way around it, in setup and when adding a vault: a folder connected in
  place keeps the Librarian off, and turning it on means a copy Rotli makes.
  An empty folder needs no copy. A closed *Why a copy?* says why: the
  original is never touched by Rotli, so nothing that happens in the copy can
  fall on it.
