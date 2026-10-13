# Open in Rotli: a file or folder from Finder

Status: **accepted direction, not yet built** (owner decisions 2026-10-13).
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

1. Registration (Open With) plus the `file://` handler plus `ExternalGrants`.
   **External tabs for Markdown, text, boards, images, and video.**
2. **Folder windows** in raw mode, plus **Add as vault**.
3. **The Quick Action** with its opt-in Settings install.
4. DOCX, XLSX, and CSV in external tabs.

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
