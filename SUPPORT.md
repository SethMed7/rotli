# Rotli support

Rotli is currently beta software. Support is best effort and focuses first on
security, data safety, launch/save failures, and reproducible product defects.

## Before reporting

1. Confirm the behavior on the newest signed release when safe.
2. Preserve a copy before testing a suspected data-loss, migration, or restore
   issue.
3. Reproduce with a disposable or synthetic memex when possible.
4. Identify whether the result came from the native app or the browser-only
   development twin.

For workspace CLI/MCP problems, `rotli agent doctor` is read-only and
`rotli agent self-test` uses a disposable temporary memex. Do not point ad hoc
automation at a live workspace.

## A useful report

Include Rotli version, macOS version, clear reproduction steps, expected result,
observed result, and a sanitized error message. Screenshots must be checked for
note titles, paths, contacts, notifications, and credentials before sharing.

Do not attach note content, an entire memex, `.rotli/` state, raw logs, Keychain
values, provider credentials, or signing material. Create a minimal synthetic
fixture when a file structure is required.

Security reports use the private process in [`SECURITY.md`](SECURITY.md), not a
normal issue. Diagnostic and triage boundaries are defined in
[`docs/operations/support-and-diagnostics.md`](docs/operations/support-and-diagnostics.md).

## Sync and other devices — your folder, your sync

Rotli deliberately has no sync service and no account. Your vault is one plain
folder, so any file-sync you already trust syncs your notes too:

- **iCloud Drive** — put your vault inside `~/Library/Mobile Documents/…`
  (or any iCloud-synced folder) and it follows your Apple devices. On another
  Mac, point Rotli at the same folder in Settings → Location. Enable "keep
  downloaded" for the vault folder so files are never evicted to placeholder
  stubs.
- **Git** — a vault is a natural repository (`.rotli/` is rebuildable state;
  commit it or ignore it, your call). Push to a private remote for versioned,
  conflict-explicit sync. This is how the reference vaults are managed.
- **Any folder-sync tool** — Syncthing, Google Drive, Dropbox, or a NAS all
  work the same way: sync the folder, open it on the other side.

Two honest cautions: run **one Rotli at a time** against a given vault (two
concurrent apps writing the same `.rotli/` state will fight), and prefer sync
tools that keep real files on disk over ones that stream placeholders. There is
no mobile app today; on a phone, any Markdown editor over the synced folder
reads the same notes — that is the point of plain files.

## Current boundaries

- There is no formal support SLA.
- Rotli does not provide cloud backup or recovery for files deleted outside its
  archive/trash workflow, and it does not operate a sync service — sync is your
  folder-sync tool's responsibility (see above).
- Browser mode does not prove native filesystem, Keychain, updater, scheduler,
  titlebar, or menu-bar behavior.
- Third-party model, email, Signal, and web services retain their own support and
  availability responsibilities.
