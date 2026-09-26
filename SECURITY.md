# Rotli security policy

Rotli is a local-first desktop application. Privacy and user-file integrity are
product boundaries, not optional hardening.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability or include private
notes, credentials, absolute memex paths, or exploit details in a public thread.

Report it privately through GitHub private vulnerability reporting: the
repository's **Security → Report a vulnerability** form
(<https://github.com/SethMed7/rotli/security/advisories/new>). Only the owner
sees the report.

Include only what is necessary:

- affected Rotli version and macOS version;
- the security property or boundary involved;
- minimal synthetic reproduction steps;
- expected and observed result;
- impact and required user interaction; and
- whether the issue is already public or actively exploited.

Use synthetic files. Never attach a real memex, note, chat, board, document,
Keychain value, provider token, updater key, or production credential.

## Scope

Security-sensitive areas include:

- secure-note and secret-shaped-content exclusion;
- filesystem roots, traversal, symlinks, permissions, and write lanes;
- provider endpoint locality, prompt/tool egress, SSRF, and CLI sandboxing;
- workspace CLI/MCP authorization, revision protection, and content filtering;
- Keychain access and credential handling;
- Tauri IPC, capabilities, CSP, webview-to-Rust validation;
- updater signatures, Developer ID signing, notarization, and release
  provenance; and
- managed Breve scheduling and external delivery boundaries.

The full model is [`docs/security/threat-model.md`](docs/security/threat-model.md).
The executable egress inventory and current accepted findings are in
[`docs/development/security.md`](docs/development/security.md).

## Supported versions

Security fixes target the current `main` branch and the newest signed release.
Older releases do not receive backports; update to the newest signed build after
reviewing its release notes.

No response-time or remediation SLA is promised; Rotli is maintained by one person. A
confirmed issue is prioritized by user-data exposure, integrity impact,
reachability, and exploitability.

## Disclosure and fixes

Rotli coordinates disclosure after a fix and safe update path exist. A security
fix includes a failing regression or adversarial fixture, the appropriate
independent Rust/TypeScript guard, updated threat/egress documentation, and a
review of adjacent call sites. Release evidence follows
[`docs/operations/release-and-supply-chain.md`](docs/operations/release-and-supply-chain.md).
