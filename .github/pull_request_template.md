## Outcome

Describe the user-visible result and the problem it solves.

## Architecture and data

- [ ] Dependency direction still follows `docs/architecture/clean-architecture.md`.
- [ ] User files remain the source of truth; no database or competing copy was added.
- [ ] Memex write lanes, secure-note rules, and Rust trust boundaries remain intact.
- [ ] Vendor-specific code is isolated behind an adapter where applicable.

## Validation

- [ ] Focused tests for the changed behavior
- [ ] `bun run check`
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml`
- [ ] `NODE_OPTIONS=--max-old-space-size=4096 bun run build`
- [ ] Current documentation and `CHANGELOG.md` updated when applicable

For UI work, attach desktop screenshots for Warm Light, Warm Dark, Paper, and
Charcoal and note keyboard, empty, loading, error, disabled, and narrow-window
checks. For native or Breve work, state what was tested in browser fixtures and
what was tested in the actual app; do not treat them as interchangeable.

## Operational safety

List any live data, daemon, Keychain, app installation, deployment, or release
operation performed. Write “none” when the change stayed development-only.
