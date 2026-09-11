## Outcome

Describe the user-visible result and the problem it solves.

Target `dev` for ordinary changes; `main` is an owner-approved promotion.
Only @SethMed7 currently approves either branch. Use synthetic fixtures and media.

## Architecture and data

- [ ] Dependency direction still follows `ARCHITECTURE.md`.
- [ ] User files remain the source of truth; no database or competing copy was added.
- [ ] Memex write lanes, secure-note rules, and Rust trust boundaries remain intact.
- [ ] Vendor-specific code is isolated behind an adapter where applicable.
- [ ] Persistent/public schemas remain additive, or include version, migration, downgrade, and rollback evidence.
- [ ] Security assets, destinations, permissions, or trust assumptions are reflected in the threat model.

## Validation

- [ ] Bug fix includes a failing reproduction and a focused regression test
- [ ] Feature covers the happy path, a refusal/failure state, and boundaries
- [ ] Model behavior includes deterministic offline eval coverage when applicable
- [ ] Cross-surface interaction includes E2E coverage when applicable
- [ ] Syntax, naming, oxfmt, and TypeScript checks pass
- [ ] `bun run verify` (all lanes; list exact failures or unrun checks)
- [ ] No credentials, private paths, notes, or local state in diff/attachments
- [ ] Stable/dev feature behavior evaluated when changing launch scope
- [ ] Current documentation and `CHANGELOG.md` updated when applicable
- [ ] Dependency/release-sensitive changes record provenance, license, vulnerability, and rollback impact

For UI work, attach desktop screenshots for the theme families you touched
(Rotli, Paper & Charcoal, Ocean, Grove, Iris, Midnight — light and dark) and
note keyboard, empty, loading, error, disabled, and narrow-window checks. For native or Breve work, state what was tested in browser fixtures and
what was tested in the actual app; do not treat them as interchangeable.

## Operational safety

List any live data, daemon, Keychain, app installation, deployment, or release
operation performed. Write “none” when the change stayed development-only.
