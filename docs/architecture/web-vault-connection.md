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
  followed (as the Mac corpus walk). `.git/` is never written.
- **Atomic and revision-gated.** Writes use `fsutil::atomic_write_bytes`;
  `expectedRevision` (`${mtimeMs}:${size}`) refuses a stale write with 409.
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
- **Pairing is automatic.** `install.sh … --open <Rotli Web>` opens the page
  with `#pair=<port>:<token>`; a fragment never reaches a server, and the page
  strips it before anything else (`services/helperLink.ts`
  `adoptPairingFromUrl`). A setup tab still waiting picks the pairing up from
  the device store. `--open` accepts only Rotli's own addresses.
- **An outage mid-session** holds every write pending — the save dot stays
  dim — behind a "Reconnecting to <vault>…" cover, and replays in order when
  the helper answers; a retried write carries the revision it started from.
  Writes still pending when the tab closes are kept in the device store and
  replayed on the next boot; a file that changed meanwhile keeps its version
  and the edit lands beside it as an unsaved copy.
- **A hard refresh or closed tab** can't finish an async file write, so on
  `pagehide` the editor's unsaved text is journaled synchronously to
  localStorage and written into the vault on the next boot, before the editor
  opens (`services/webUnsavedJournal.ts`), under the same never-overwrite rule.

## Migration

Notes an earlier Rotli Web kept inside the browser (the browser-storage vault
or a read-only copy) are read once and offered for copying into the connected
vault (`services/legacyBrowserNotes.ts`); nothing in the vault is overwritten,
and the browser's copy is cleared only after it is safely in the vault.
