# Rotli Web: the vault connection

Owner contract for how Rotli Web (`rotli.co/app/`) reaches the user's vault,
what it may reach, and what happens when the connection is interrupted.
Decided by the owner on 2026-09-22; the history is in
[`../design/web-version-and-shell-batch-2026-09-16.md`](../design/web-version-and-shell-batch-2026-09-16.md) §1.

## The rules

1. **A vault is required.** The editor never runs without a connected vault
   folder. There is no browser-storage vault and no read-only copy: every note
   is a file in a folder on the user's computer, the same files Rotli for Mac
   reads. Mobile browsers and Safari can't reach a folder and get a plain
   "unsupported" screen.
2. **Nothing leaves the computer.** The page loads only its own static files
   and talks only to `http://127.0.0.1` (Rotli Helper). The `/app/` CSP is
   `connect-src http://127.0.0.1:*` and `'self'` everywhere else
   (`site/Caddyfile`); `check:web-privacy` fails the build if a directive
   names another host, and `e2e/web/rotli-web-privacy.spec.ts` proves the app
   never asks. The one outbound path is a chat the user starts, which runs the
   user's own AI CLI through the helper; secure notes are refused before it
   runs (`blocked_for_remote`). Before every completion the helper re-reads
   its vault config and refreshes the served vault's secure-prose ledger,
   including helper writes and external edits. An unavailable vault or a
   failed scan (an unreadable or oversized Markdown file) refuses the
   completion before a provider process starts; a note that isn't UTF-8 is
   read lossily, so its markers still count. The refresh is a full,
   read-only scan; it does not rely on cached timestamps.
   Note content can't make a request either: on the web a Markdown image that
   names an `http(s)` URL is never fetched (`resolveImageSrc`), and previewed
   HTML (a ```html fence, an `.html` file) runs under its own
   `default-src 'none'` policy (`lib/htmlPreviewPolicy.ts`), placed before
   every author token (only a plain `<!doctype html>` precedes it), so not even the
   site's own origin can receive note text in a request URL. The no-egress
   E2E counts only requests that left the page and allows same-origin ones
   only for files the build ships. Mermaid source is checked by the pure
   `lib/mermaidPolicy.ts` rule **before** either vendor renderer/converter runs:
   images/icons, links/clicks, HTML, URL-bearing tokens, escaped tokens, and
   author configuration are refused inline. Sanitizing the finished SVG would
   be too late: Mermaid's image loader can make a request during rendering.
   Ordinary diagrams remain available; this conservative refusal can also
   withhold harmless source containing those tokens.
3. **A lost connection is a reconnect screen, never a stand-in vault.**
   Nothing is written anywhere but the bound vault.
4. **Typing is never lost** to an outage, a closed tab, or a hard refresh.

## Two roads to a folder

| Browser | Road | Code |
|---|---|---|
| Chrome, Edge, Arc (File System Access API) | The browser's own folder picker; the handle is remembered in IndexedDB. Chromium re-asks on the next visit; choosing **Allow on every visit** makes that silent. | `services/webVaultFolder.ts`, `lib/fsaVaultDir.ts` |
| Zen, Firefox, Brave with its flag off | **Rotli Helper** serves one folder the user chose with the OS's own picker; the page reaches it on loopback with the pairing token. | `lib/helperVaultDir.ts`, `src-tauri/src/helper_vault.rs` |
| Safari, phones and tablets | Unsupported (no folder API; Safari won't call a loopback helper from https). | `services/vaultBinding.ts` `unsupportedBrowser` |

Both roads implement the same `VaultDir` port (`services/vaultDir.ts`), so the
notes service (`FolderNotesService`), the `.rotli/` store, chats, and files are
identical above it. `lib/helperVaultDir.test.ts` runs the port's contract
against the in-memory reference and the helper adapter.
Note and `.rotli/` manifest reads derive their revision from the exact text
returned. Their writes present that content revision to the folder adapter,
which checks it in the write turn; a concurrent edit is a conflict. Chromium
holds both source and destination turns for an entire move, through removal.
Secure note relocation adds the destination to `.gitignore` before moving and
removes the source exclusion after the move succeeds.

## The binding and the boot

`services/vaultBinding.ts` decides, before the first render, which of these
the browser is in (`state/vaultConnection.ts`):

`connected` · `needs-permission` · `helper-offline` · `helper-refused` ·
`helper-outdated` · `helper-no-vault` · `vault-mismatch` · `unbound` ·
`unsupported`

Only `connected` mounts the notes service (`services/webNotes.ts`
`hydrateWebNotes`); every other state renders setup
(`components/onboarding/webVaultGate.tsx`), which names the bound vault and
the one fix. The binding lives in the browser's device store
(`lib/browserVault.ts` `deviceVaultStore`), never in the vault: the FSA handle,
or `{ vaultId, vaultName }` for a helper vault. `vaultId` is minted by the
helper per folder, so a helper later pointed elsewhere is `vault-mismatch`,
not a silent switch. An empty folder becomes a vault (the Rust spine,
`services/vaultScaffold.ts`) and gets the Welcome lessons as plain files in
`wiki/Welcome/`; an existing vault — including a plain folder of Markdown —
opens as it is.

## Boards are files in the vault here too

A board is the same raw `.excalidraw` file the Mac app writes, id = its
vault-relative path. `services/boardStore.ts` is the one seam every board
surface uses: the Rust corpus inside the Mac app, `services/folderBoards.ts`
over the connected `VaultDir` on the web, and nothing (a "connect a vault"
placeholder) in a plain browser. `folderBoards.ts` is the TypeScript twin of
the Rust board rules — a memex board is born in the folder you were in only if
that is a writable note surface (`wiki/`, `chats/`, the lane itself), else in
`storage/excalidraw`; a plain vault's reserved rows mean its root; names
collide as `name-2.excalidraw`; the empty scene is byte-identical
(`parity.json` pins `emptyBoardScene` and `boardLane`). Saves are
revision-gated like notes (`${lastModified}:${size}`, then the helper's own
gate). `FolderNotesService` lists boards by stat alone (they never join the
note index as notes) and moves them through Archive/Trash like the Mac corpus.
Excalidraw's fonts load from the build's own base (`/app/fonts`), never a CDN.
Not on the web: Reveal in Finder (hidden). DOCX documents stay desktop-only —
`launchFeatures(…, "web").documents` is false, so the chooser shows Document as
coming soon and every create path refuses it. `/document` is hidden, and
existing document and XLSX fences show an "opens in Rotli for Mac" message.
CSV **embeds** remain withheld too: the sheet embed still uses the desktop
stat/byte-save adapter, independently of CSV's standalone text surface. The
fence source remains editable and unchanged.

Settings exposes `launchFeatures`' desktop-only `librarian` and `localModels`
capabilities as one-line Mac availability states on web, without Run now,
hardware scanning, or model install/default/uninstall controls. Helper-supported
connected CLI configuration stays available.

`/attach` uses a browser `image/*` file picker on web and the existing
`importImageFilesAtPosition` byte-backed paste/drop lane. Selected image bytes
land in the bound vault and Markdown receives only a portable `storage:` link;
cancelling adds nothing. Desktop keeps its native image/video picker.

## Keys on the web

Rotli Web has no app hotkeys (`launchFeatures(…, "web").hotkeys` is false,
2026-09-23): the browser's own shortcuts own ⌃Tab, ⌘[, ⌘←, ⌘W, ⌘1–9 and the
rest. `keys/registry.ts` `currentChord` answers null for every modifier chord
except the editor's text formatting (`EDITOR_ACTION` — ⌘B, ⌘I…), so nothing
dispatches it and no hint names it (`lib/hotkeyHint.ts` for hard-coded hints);
bare keys (Esc, Enter) still answer. Platform availability is separate from
transient action enablement: the registry excludes desktop-only actions from
web registration, dispatch, and search. Available actions stay in the palette,
reached from the search field; Settings has no Keybindings pane. Palette row
hints use `currentChord`, and hard-coded footer, leader, navigation, and tour
hints use the same build policy.

## Rotli Helper's vault lane

`rotli-helper` (a second bin of the crate) serves ONE folder:

- **Chosen by a person, never by the page.** `rotli-helper --vault <dir>`
  writes `~/.rotli-helper/vault.json` (0600) and exits; the running helper
  follows the file. `vault_choose` opens the OS picker (`helper_picker.rs`).
  The page learns only the folder's name and id.
- **Confined.** Every path is relative and resolved by
  `containment::resolve_beneath`; `..`, absolute paths, drive prefixes,
  backslashes, and colons are refused first. Symlinks are neither listed nor
  followed (as the Mac corpus walk). No `.git` directory at any depth, in any
  letter case, is written, moved into or out of, or removed. A root that
  contains the helper's own directory (`~/.rotli-helper`, e.g. the home
  folder) is refused, so the page can never rewrite the config that names the
  root or read the pairing token.
- **Bound to one vault per page.** Every verb carries the `vaultId` the page
  bound to; a helper since pointed at another folder answers 409 "vault
  changed" before touching disk, and the page re-probes into setup.
- **Atomic, locked, revision-gated, no-clobber.** Writes use
  `fsutil::atomic_write_bytes` under the same `.lock` sidecar the desktop
  app's writers hold (`fsutil::with_file_lock`), gated by the desktop's
  content revision (`fnv1a64`, `expectedContent`) when the page knows the text
  it edited, else by `${mtimeMs}:${size}`; a stale write is 409, and a write
  or delete of an EXISTING file with no gate at all is refused (only creating
  a file needs none), so no token holder can clobber without saying what it
  saw. A page can never create a `<file>.lock` sidecar (the desktop writers'
  lock), including a directory or ancestor component ending in `.lock`
  (in any letter case), and Windows junctions are skipped in listings like symlinks. Deletes of a
  file take the same lock and gate, so a delete decided against an older
  version never removes a newer one, and a folder removal never deletes a file
  that has taken the folder's name. A move never replaces an existing file —
  atomically in the helper (hard link, then unlink, both under the source's
  lock; across volumes a complete temp copy published with no-replace), and
  by refusal in every `VaultDir` (the port's contract). A case-only rename
  (`a.md` → `A.md`) renames the file itself (helper) or goes through a unique
  temporary name (browser folder), never copy-then-delete, which on a
  case-insensitive disk deletes the only copy. The helper uses that rename
  branch only when the destination identifies the source file (device/inode
  on Unix, volume/file index on Windows); a distinct differently-cased sibling
  is a 409 conflict, and an absent destination uses the ordinary no-replace move.
- **Residual, documented:** in Chromium's folder mode the browser offers no
  no-replace write, so another writer creating a move's target in the same
  instant as the check wins. A write whose text the page never read (a binary,
  or a `.rotli/` file written after a stat) is gated by `${mtimeMs}:${size}`
  only; an external edit of the same size in the same millisecond would pass
  it (still under the lock). Checks resolve a path and the operation then
  reopens it. Another process running as the same user that swaps a folder
  inside the vault for a symlink in that instant could redirect one
  operation; such a process can already read and write everything the user
  can, and the page has no way to create a link.
- **Few round trips.** `vault_walk` answers every list/stat in one call and
  `vault_read_many` batches reads (12 MiB of text per answer). Reads require
  regular files, check their size before allocating, and read at most the
  allowed bytes plus one to catch growth after stat. An individual read (an
  image, a video) has a 256 MiB cap and refuses larger files with 413; a batch also
  checks its remaining budget and lists oversized or deferred files in its
  existing `more` array. The client can then read on demand and receive the
  individual refusal. Measured 2026-09-22 on
  a 900-note, 14 MB vault in Firefox: about 1.3 s per full reload, 11–12
  helper calls.
- **Behind the same defences as chat**: loopback bind, origin allowlist,
  Host check, bearer token, bounded bodies. Verbs: `vault_info`,
  `vault_choose`, `vault_walk`, `vault_list`, `vault_stat`, `vault_read`,
  `vault_read_many`, `vault_write`, `vault_mkdir`, `vault_move`,
  `vault_remove`. The page sends them only from the vault adapter
  (`HELPER_VAULT_COMMANDS`), never through the AI seam.

## Staying connected

- **The helper starts at login.** The installers register a LaunchAgent
  (`co.rotli.helper`), a systemd user service, or a Windows Startup shortcut,
  and `--uninstall` / `-Uninstall` removes it (`site/public/helper/`).
- **Pairing is one press.** `install.sh … --open <Rotli Web>` (only
  `https://rotli.co/app/`, `https://dev.rotli.co/app/`, or the dev server's
  `http://localhost:1437/app/` — the helper's own origins) opens the page
  with `#pair=<port>:<token>`; a fragment never reaches a server, and the page
  strips it before anything else (`services/helperLink.ts`
  `adoptPairingFromUrl`). Setup shows the code filled in; the person presses
  **Pair**, sees "Rotli Helper is paired" (what the helper can and can't
  reach), and presses **Continue** to choose the vault. A tab whose vault
  opens without setup pairs with the offered code in place and says so. A
  setup tab still waiting picks the pairing up from the device store.
  `--open` accepts only Rotli's own addresses.
- **The browser may ask first.** Firefox and Zen ask before a page's first
  request to `127.0.0.1` ("allow this site to connect to apps on this
  device", the `loopback-network` permission); Chromium has its own
  local-network prompt. Background probes give up after 2.5 s, but a Pair
  press waits up to two minutes and says what to look for, so the question
  can be answered instead of reading as "nothing answered".
- **An outage mid-session** holds every write pending — the save dot stays
  dim — behind a "Reconnecting to <vault>…" cover, and replays in order when
  the helper answers; a retried write carries the revision it started from.
  Writes still pending when the tab closes are kept — synchronously, in this
  browser's localStorage, per vault, because an unloading page can't count on
  an IndexedDB write finishing — and replayed on the next boot; the record is
  cleared the moment an outage recovers in-session, and replay skips an edit
  the file already holds; a file that changed meanwhile keeps its version
  and the edit lands beside it as an unsaved copy under a name nothing holds
  (`freeSiblingPath`), a queued delete of a changed file is dropped, and a
  queued folder removal isn't replayed. Records are per vault, and what a
  replay couldn't finish moves to a per-vault "kept" record — written before
  the record it came from is cleared — that no unload overwrites, retried
  every boot.
- **A terminal answer mid-session** (401/refused token, 404 on an unavailable vault verb (not a missing file),
  no-vault 409, or "vault changed" 409) re-probes the bound Helper and switches
  to its setup gate. Before the editor unmounts, unsaved note buffers are
  journaled synchronously and unacknowledged mutations are retained per vault.
  No reload is needed to expose the failure. Stale-revision 409s remain file
  errors and never change the connection gate; transient network outages keep
  the retry cover described above.
- **A hard refresh or closed tab** can't finish an async file write, so on
  `pagehide` the editor's unsaved text is journaled synchronously to
  localStorage and written into the vault on the next boot, before the editor
  opens (`services/webUnsavedJournal.ts`), under the same never-overwrite rule.
  The journal includes secure and locked policy; a conflict copy keeps both,
  and an unknown policy leaves the draft queued. Nonempty typing in a new
  tab is journaled even while file creation is pending and becomes a note on
  the next boot if creation did not finish.
  The journal is keyed by the vault's identity on this browser (the helper's
  vault id, or an id this browser mints for a chosen folder and finds again
  whenever that folder is chosen again, even after others — a small map of
  folder handles to ids), never by folder name; a draft that can be
  neither saved nor kept as a note waits under its own "kept" key.

## Migration

Notes an earlier Rotli Web kept inside the browser (the browser-storage vault
or a read-only copy) are read once and offered for copying into the connected
vault (`services/legacyBrowserNotes.ts`); nothing in the vault is overwritten,
and the browser's copy is cleared only after it is safely in the vault.
