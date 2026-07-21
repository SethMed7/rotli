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

## Current boundaries

- There is no formal support SLA.
- Rotli does not provide cloud backup or recovery for files deleted outside its
  archive/trash workflow.
- Browser mode does not prove native filesystem, Keychain, updater, scheduler,
  titlebar, or menu-bar behavior.
- Third-party model, email, Signal, and web services retain their own support and
  availability responsibilities.
