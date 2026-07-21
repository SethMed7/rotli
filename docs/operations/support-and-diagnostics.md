# Support and diagnostics contract

Rotli support must help diagnose failures without turning private notes into a
support dataset. This document owns diagnostic collection, redaction,
support-boundary, and incident-triage policy for the current local-first beta.

Rotli currently has no product analytics, crash-reporting service, account
service, or automatic support upload. Diagnostics are local and user-directed.

## Safe support information

The following may be requested when relevant and reviewed by the user:

- Rotli version and source/release identifier;
- macOS version and Mac architecture;
- whether the failure occurred in the native app or browser twin;
- steps to reproduce and expected/observed behavior;
- the name of the affected feature or file format, without the private filename;
- a sanitized error message or stack trace;
- pass/fail results from documented doctor/self-test commands;
- whether FileVault, managed security software, or filesystem permissions may
  affect the operation; and
- dependency or build versions for contributor reports.

The following is never requested through a normal issue:

- note, chat, board, document, sheet, email, or attachment content;
- note titles, snippets, wikilinks, absolute memex paths, or contact names;
- Keychain values, provider tokens, cookies, authorization headers, or CLI login
  state;
- an entire memex, `.rotli/` directory, home directory, or raw application log;
- secure-note counts or proof that reveals which notes are protected; or
- signing, notarization, updater, delivery, or production credentials.

If reproduction truly requires a document, the reporter creates a minimal
synthetic fixture that preserves the failing structure without private content.

## Existing diagnostic surfaces

- `rotli agent doctor` opens the selected registered root read-only and reports
  boundary checks plus agent-visible metrics. It never mutates the workspace or
  reports how many secure notes were withheld.
- `rotli agent self-test` exercises CLI/MCP behavior in a disposable temporary
  memex and reports `liveWorkspaceMutated: false`.
- The repository proof commands in
  [`../development/testing.md`](../development/testing.md) diagnose contributor
  and build failures without targeting a live workspace.
- Browser E2E proves browser-twin interaction only. Native filesystem, Keychain,
  updater, scheduler, titlebar, and menu-bar findings require separately
  authorized native evidence.

The installed release binary is the supported user path for headless commands.
A `target/debug` binary is development evidence and must be identified as such.

## Future support bundle rules

Rotli does not yet generate a support bundle. If one is added, it must be an
explicit export with a preview step and a content-free allowlist.

Allowed bundle fields:

- app/OS/toolchain versions;
- feature flags and capability names that contain no account or note data;
- sanitized error categories and bounded event timestamps;
- pass/fail health checks;
- counts computed after security filtering and only when they cannot reveal a
  protected population; and
- release manifest and signature identifiers.

Required safeguards:

1. build the bundle locally;
2. omit by default rather than redact after broad collection;
3. run secret detection on every text field;
4. normalize or remove absolute paths and usernames;
5. show the exact manifest before export;
6. require a deliberate user save/share action;
7. never upload automatically; and
8. test adversarial values, including secrets hidden in filenames and errors.

No diagnostic collector may scan note bodies merely to prove that it omitted
them.

## Triage levels

| Level | Meaning | Initial handling |
|---|---|---|
| Security | Possible confidentiality, integrity, authorization, updater, credential, or sandbox issue | Use the private path in [`../../SECURITY.md`](../../SECURITY.md); do not open a public issue |
| Data safety | Possible loss, overwrite, duplicate, failed restore, migration, or cross-root write | Stop reproduction on live data; preserve copies; build a disposable fixture |
| Availability | App cannot launch, open a workspace, save, update, or run a managed runtime | Capture versions and sanitized error category; identify native vs browser boundary |
| Functional | A bounded feature produces the wrong result without data loss | Provide minimal steps and expected/observed behavior |
| Cosmetic | Visual, copy, or non-blocking interaction issue | Include environment, window size, and sanitized screenshot when safe |

Security and data-safety reports outrank feature work. A confirmed incident adds
a failing regression, updates the owning contract, records the root cause and
recovery, and reviews similar boundaries—not only the single symptom.

## Backup and restore responsibility

The memex is user-owned local data. Rotli does not currently provide cloud
backup or promise a content recovery point.

- Users choose their filesystem backup mechanism.
- Main is a reference manifest and should travel with the memex when committed
  or backed up.
- Settings and view state are not substitutes for a content backup.
- Deleting rebuildable `.rotli/` projections must not delete notes, although it
  may remove convenience state or undo history.
- Rotli archive/trash operations preserve an origin for supported restore;
  external deletion does not.
- Restore tests use copied fixtures or disposable roots, never the only live
  copy of a memex.

Support guidance must distinguish content recovery, Main/view reconstruction,
settings reset, and app reinstall; they are not interchangeable remedies.

## Retention and access

Issues and diagnostic artifacts should contain no private content. When a
private artifact is exceptionally accepted through an approved channel, record
its purpose, access list, and deletion date; delete it as soon as the case is
resolved. Do not move support data into CARL, fixtures, screenshots, changelogs,
or repository history.

Rotli has no formal support SLA in the current beta. [`../../SUPPORT.md`](../../SUPPORT.md)
states the public expectations without inventing response guarantees.
