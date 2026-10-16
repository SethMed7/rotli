# Open in Rotli: a file or folder from Finder

Status: **all four stages built** (a file in a tab, a folder in its own
window, the opt-in Quick Action, Office files and CSVs; owner decisions
2026-10-13).
Roadmap item `open-with-rotli`. Builds on the protected-originals rule in
[`vault-copy-and-obsidian-compatibility.md`](vault-copy-and-obsidian-compatibility.md).

## What the owner asked for

> Right-click something in Finder and open it in Rotli. If it's a file, it just
> opens the file in a tab, that's it. If it's a folder, the whole folder opens,
> raw, like an IDE window looking at that folder, with a button to add the
> folder as a vault.

Decisions (2026-10-13):

- **A folder opens in its own window**, IDE-style, not in place of the vault.
- **Edit in place, write nothing else.** Edits save to the real file. Rotli adds
  no `.rotli/` folder, no frontmatter, no renames, and no Librarian, the same
  protected-originals rule as a folder opened in place.
- **Finder offers both:** Rotli in **Open With** for the types it edits, and an
  **Open in Rotli** Quick Action for files and folders on right-click.

## Today (verified 2026-10-13)

- No file type is registered: there's no `bundle.fileAssociations` and no
  Info.plist. Only the `rotli://` scheme is registered.
- On macOS, `tauri-plugin-deep-link` already passes every URL the system hands
  the app to Rotli, including `file://` URLs from Open With (`lib.rs`,
  `deep_link::parse`). `parse` drops anything that isn't `rotli://`.
- Every tab names an item inside a vault root (`src/types.ts`); Rust refuses
  absolute paths and `..` everywhere.
- There are four fixed windows (`main`, `capture`, `quick`, `chat`), and only
  `main` writes view state and settings. Nothing creates windows at runtime.
- Live vault switching exists (`activate_vault_path_live`), as do
  read-only stores (`CorpusStore::open_read_only`).

## The design

### 1. Finder registration

- `bundle.fileAssociations` registers Rotli with **rank `Alternate`**, so it
  appears under Open With and never becomes anyone's default app:
  - **Editor role:** `.md`, `.markdown`, `.txt`, `.excalidraw`, `.canvas`,
    `.docx`, `.xlsx`, and `.csv`.
  - **Viewer role:** images and video, which are preview-only in Rotli.
- A `public.folder` content type lets Finder offer Rotli for folders where
  macOS supports it. Dropping a folder on the Dock icon works regardless.
  *Verify on a real Mac.*
- **The Quick Action** is an Automator workflow shipped in the app's resources
  (`Open in Rotli.workflow`, which runs `open -a Rotli "$@"`). Settings →
  General → **Add "Open in Rotli" to Finder** copies it into
  `~/Library/Services`; **Remove** deletes it again. It's never installed
  silently: it writes outside the app, so the person opts in. It hands paths to
  the same open handler as Open With.

**Quick Action as built (stage 3, 2026-10-13):** no resource ships. On the
person's click, Rust (`src-tauri/src/finder_quick_action.rs`) generates
`~/Library/Services/Open in Rotli.workflow`.

- The workflow has one Run Shell Script step: `open -b <this build's bundle
  id> "$@"`. The id is checked to letters, digits, dots, and hyphens. A dev
  build's Quick Action opens the dev build.
- It's offered in Finder only (`NSRequiredContext`), for any item
  (`NSSendFileTypes = public.item`).
- It's built beside the target and swapped in, so a half-written workflow is
  never visible. `pbs -update` asks macOS to notice it right away.
- An Info.plist marker key (`RotliQuickAction`) tells Rotli's workflow apart
  from a same-named one the person made. Rotli never replaces or removes
  theirs, and the row says so.
- Proof: unit tests for install, update, remove, someone else's workflow,
  and the bundle-id check. An `--ignored` macOS test lints both plists and runs
  the workflow through `automator -i`, with the step's `open` swapped for a
  `printf`. The selected path arrives as its argument.

### 2. The open handler

- `deep_link::parse` gains a `file://` branch. A path that exists becomes an
  `ExternalOpen { path, kind: file | folder }`. Symlinks are resolved, and
  anything that isn't a regular file or a directory is refused.
- **Trust boundary:** only paths macOS hands Rotli (Open With, a Quick Action,
  a Dock drop) go into an in-memory `ExternalGrants` set. The webview can never
  name an outside path itself, the same way a drag-drop's one-shot import grant
  works. Grants are per session and never persisted.
- If Rotli isn't running, the event arrives at launch. The main window opens
  as usual, and the external item opens on top of it.

### 3. A file opens in a tab (stage 1)

**As built (2026-10-13):** no new tab kind and no grants set were needed.
macOS hands Rotli the file, and Rust mounts it as a **single-file raw root**
(`src-tauri/src/corpus_raw.rs`). It's an adopted store over the file's folder
that walks only that one file, with its own root id `finder_<hash>` (parity
fixture `rawRootPrefix`). Its tab is an ordinary tab whose id is
`finder_<hash>:<name>`. Only a path macOS handed over is ever mounted, because the
webview has no command that mounts one.

- Its `.rotli/` sidecar (index, locks) lives in the app cache
  (`opened-files/finder_<hash>/`), never beside the file. The file's siblings are
  never walked, searched, or shown.
- Rotli refuses to delete, move, mark secure, or create anything beside it:
  "Copy it into a vault first."
- **Every reader treats it as protected** (`file_is_protected`), so no cloud
  model reads it. On-device models follow the usual secure-note knobs.
- A raw root is a pane route only (`canOpenVaultInPanes`). It's never a vault
  switch, a ⌘N target, or the Librarian's.

The original design follows:

- **A new tab kind, `external`,** keyed by its granted absolute path, with its
  own color and the full path in the header.
- **Markdown and text** open in the editor. Saves write only the new words,
  revision-gated, like a folder opened in place: no frontmatter is minted and
  the file isn't renamed.
- **Boards** open in the board editor and save in place.
- **Images and video** preview.
- **DOCX, XLSX, and CSV** go through their editors' adapters with an
  external-file port. This is stage 1b, after Markdown and boards.
- **⌘S on an external tab** offers **Copy into vault…**: you pick a folder, and
  the original stays where it is (from the roadmap).
- **AI:** an external file is treated as protected. No cloud model reads it.
  The secret detector still applies to anything sent elsewhere, and
  Hand to AI refuses external tabs in stage 1.

### 4. A folder opens in its own window (stage 2)

**As built (2026-10-13):** the same Finder mount as a file, over the whole
folder (`CorpusStore::open_raw_folder`, `src-tauri/src/folder_window.rs`).

- The mount and its first walk run off the main thread. Rotli refuses a home
  folder, any folder above one, and private dot-folders
  (`reject_privileged_root`), as well as the disk root.
- **The window's label is its root id** (`finder_<hash>`), so the window can
  only reach its own folder. "Add as vault" takes no path from the page; Rust
  reads it from the window's own mount. The window has its own capability
  (`capabilities/folder-windows.json`): core IPC and clipboard writes only.
- The page (`?window=folder`, `src/components/folderWindow/`) installs a notes
  service that lists only that folder (`corpus_list_root`, which refuses any
  other root). It shows the folder's tree, tabs, and **Add as vault**. It
  answers only tab, pane, and zoom keys, and ignores vault switches.
- Every write that would add, move, rename, or trash a file is refused in the
  store, for boards and files as well as notes. Edits save in place.
- Its images and video preview over `asset://` for as long as Rotli runs.
  Tauri's asset scope can't take a grant back, and forbidding the folder
  would also break a vault that contains it.
- **Closing** asks the window to save what's typing (the quit-save
  handshake), then closes and unmounts. The sidecar stays in the app cache.
- **Add as vault** authorizes the folder like a picked one and hands it to
  main's ordinary connect flow: an empty folder becomes a new vault, a Rotli
  vault is connected, and a folder of notes asks **Work on a copy
  (recommended)** or **Open in place**
  ([`vault-copy-and-obsidian-compatibility.md`](vault-copy-and-obsidian-compatibility.md),
  slice 3). The folder window stays open while main asks. Main closes it
  (`folder_window_close`, which accepts only folder-window labels) once a
  vault opened, so "not now" leaves it where it was.
- Finder registration: a `public.folder` association (rank `Alternate`) is in
  `bundle.fileAssociations`. A debug bundle's Info.plist carries it
  (`LSItemContentTypes = public.folder`, `LSHandlerRank = Alternate`), so a
  folder dropped on the Dock icon reaches Rotli. Finder's right-click menu
  for folders usually has no Open With; that path is stage 3's Quick Action.
- There's no file watcher: the tree re-reads when the window comes forward.
- There's no search in a folder window yet.

The original design follows:

- **A new window**, `folder-<hash>`, created at runtime, titled with the
  folder's name. It shows only that folder: its tree in the sidebar, tabs, and
  search within it. There's no vault switcher, chats, Librarian, Breve,
  or Main.
- **The store:** the folder mounts as a `CorpusStore` in a new **raw mode**,
  like adopted mode but writing nothing outside the person's own edits. It has
  no `.rotli/`; its index and ids live in memory for the session. Edits follow
  the protected-originals rules (`keeps_as_written`, `compose_for`), and no file
  is ever moved to Trash.
- **Window state:** a folder window persists nothing (no settings, no view
  state, no Main), because `main` stays the only writer. Its tabs are
  session-only. Closing the window unmounts the store.
- **"Add as vault"** is a button in the window's header. It runs the existing
  vault-adoption choice from the copy spec: **Work on a copy (recommended)**
  or **Open in place**, and for an empty folder, **Create a vault here**. The
  folder then becomes the main window's vault, and the folder window closes.

### 5. Rotli Web

None of this applies to Rotli Web; Finder can't hand files to a web page.
Rotli Web keeps its own Open folder flow.

## Stages (one PR each, held for review)

1. Registration (Open With) plus the `file://` handler. **Built:** tabs for
   Markdown, boards, images, and video, through a single-file raw root. Plain
   `.txt` and ⌘S **Copy into vault…** move to stage 2.
2. **Built:** folder windows in raw mode, plus **Add as vault** (connect
   flow; copy-first comes with the copy-flow slice).
3. **Built:** the Quick Action with its opt-in Settings install
   (Settings → General → Open in Rotli from Finder).
4. **Built:** DOCX, XLSX, and CSV. Open With registers `docx`, `xlsx`, and
   `csv` (Editor, `Alternate`), the formats this build edits. Macro and
   template variants aren't registered. In a Finder mount they open in their
   editors as ordinary files (`file_stat` reports them writable) and save in
   place. Two fixes keep "nothing else changes" true:
   - The one-time safety copy an Office save makes (`<name>.bak`) goes to the
     mount's cache sidecar (`.rotli/backups/…`), not beside the file.
   - CSV → XLSX conversion (a new sibling file) is refused.
   The sidecar path is canonical, so containment checks under it hold.

## Proof plan

- **Rust:**
  - the `file://` parse (exists, kind, symlinks, refused kinds)
  - grants: only a granted path reads or writes, and an ungranted path is
    refused
  - raw-mode stores write nothing besides the person's edits (a byte-identical
    tree after open, list, search, and close)
- **TS:** the external tab's model, plus its save that writes only the new words.
- **E2E:** none of this runs in the browser lane. The Mac twin covers what it
  can.
- **Native (the owner):** Finder Open With for a file and a folder, the Quick
  Action install and remove, a Dock drop, a cold launch from Finder, and two
  folder windows at once.

## Open questions

- Does Finder offer Open With for **folders** when an app declares
  `public.folder`? If not, folders arrive through the Quick Action and Dock
  drops only.
- Does a second Open With while Rotli is running reach the same process?
  Single-instance behavior on macOS is native, but it needs verifying with the
  deep-link plugin.
