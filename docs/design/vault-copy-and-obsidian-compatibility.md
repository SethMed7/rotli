# Bringing an existing vault into Rotli: work on a copy, stay Obsidian-readable

Status: **accepted direction, not yet built** (2026-10-13). The owner decided
A, B, and C below the same day. Nothing here is built yet beyond what "Today"
describes.

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

When the chosen folder already holds notes (`inspect_vault_path` says Obsidian
vault, ZenNotes vault, or Markdown folder), setup and the switcher show one
choice instead of opening it straight away:

- **Work on a copy (recommended).** "Rotli makes its own copy and organizes
  that. Your vault stays exactly as it is."
- **Open in place, as it is.** "Rotli reads and edits these notes where they
  are, and never reorganizes them." This is the protected mode (step 5).

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
  store (`CorpusStore.adopted`); Rotli Web decides by the `mx_` marker. The
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
| Images linked with the `storage:` scheme | **Broken image** (unknown scheme) | Write a root-relative path Obsidian resolves (`storage/…`), keep reading `storage:` |
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
   `import.json`. This wires the existing command.
4. Organize-the-copy: a Rotli vault from the copy, Librarian at Suggest first.
5. `storage:` links written as Obsidian-resolvable paths.

## Decisions (owner, 2026-10-13)

- **A. Where the copy's notes live: keep the original tree at the root.** The
  Librarian learns the adopted layout; nothing is moved under `wiki/` just to be
  reachable.
- **B. In-place edits stamp nothing.** A protected folder's notes never gain
  Rotli frontmatter. Identity, dates, and rename aliases for them live in
  `.rotli/`.
- **C. Existing users get one offer.** Folders already adopted in place become
  protected automatically, and after the update Rotli offers *Work on a copy*
  once, dismissibly. Nothing happens unless the person accepts.
