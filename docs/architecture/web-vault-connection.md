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
   runs (`blocked_for_remote`, with the ledger warmed from the served vault).
   Note content can't make a request either: on the web a Markdown image that
   names an `http(s)` URL is never fetched (`resolveImageSrc`), and previewed
   HTML (a ```html fence, an `.html` file) runs under its own
   `default-src 'none'` policy (`lib/htmlPreviewPolicy.ts`), placed before
   every author token (only a plain `<!doctype html>` precedes it), so not even the
   site's own origin can receive note text in a request URL. The no-egress
   E2E counts only requests that left the page and allows same-origin ones
   only for files the build ships.
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
  changed" before touching disk, and the page reloads into setup.
- **Atomic, locked, revision-gated, no-clobber.** Writes use
  `fsutil::atomic_write_bytes` under the same `.lock` sidecar the desktop
  app's writers hold (`fsutil::with_file_lock`), gated by the desktop's
  content revision (`fnv1a64`, `expectedContent`) when the page knows the text
  it edited, else by `${mtimeMs}:${size}`; a stale write is 409, and a write
  or delete of an EXISTING file with no gate at all is refused (only creating
  a file needs none), so no token holder can clobber without saying what it
  saw. A page can never create a `<file>.lock` sidecar (the desktop writers'
  lock), and Windows junctions are skipped in listings like symlinks. Deletes of a
  file take the same lock and gate, so a delete decided against an older
  version never removes a newer one, and a folder removal never deletes a file
  that has taken the folder's name. A move never replaces an existing file —
  atomically in the helper (hard link, then unlink, both under the source's
  lock; across volumes a complete temp copy published with no-replace), and
  by refusal in every `VaultDir` (the port's contract). A case-only rename
  (`a.md` → `A.md`) renames the file itself (helper) or goes through a unique
  temporary name (browser folder), never copy-then-delete, which on a
  case-insensitive disk deletes the only copy.
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
  `vault_read_many` batches reads (12 MB per answer). Measured 2026-09-22 on
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
- **Pairing is automatic.** `install.sh … --open <Rotli Web>` (only
  `https://rotli.co/app/`, `https://dev.rotli.co/app/`, or the dev server's
  `http://localhost:1437/app/` — the helper's own origins) opens the page
  with `#pair=<port>:<token>`; a fragment never reaches a server, and the page
  strips it before anything else (`services/helperLink.ts`
  `adoptPairingFromUrl`). A setup tab still waiting picks the pairing up from
  the device store. `--open` accepts only Rotli's own addresses.
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
- **A hard refresh or closed tab** can't finish an async file write, so on
  `pagehide` the editor's unsaved text is journaled synchronously to
  localStorage and written into the vault on the next boot, before the editor
  opens (`services/webUnsavedJournal.ts`), under the same never-overwrite rule.
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
