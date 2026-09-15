---
name: keep-private-data-out
description: Keep personal data and credentials out of the public Rotli repository — synthetic fixtures only, secret scans before pushing, and the rotate-first response when something real lands. Use when writing tests, fixtures, docs, screenshots, or examples, and before every push.
---

# Keep private data out

The repository is public. Its history was rewritten on 2026-09-15 because
secret-detector tests had been written with real values copied from private
notes. `docs/operations/repository-access.md` records that review and owns the
publication rules; `docs/development/security.md` owns the egress inventory.

**Write synthetic data only.**

- Never copy a value from a vault, a secure note, chat history, a Keychain
  entry, a log, or a real screenshot into code, tests, docs, or a PR.
- Fixtures that must look like secrets use documented placeholders: the
  `4242 4242 4242 4242` or `3782 822463 10005` test cards, `078-05-1120` for an
  identity number, and made-up keys of the right shape (for example an
  `AIzaSy…` key padded with `Example0`).
- Use `/Users/example`, `you@example.com`, and fictional 555 phone numbers.
  Never use the maintainer's home path, email, signing team, or device names.
- Screenshots and captures come from the in-memory demo vault
  (`bun run capture:site`), never a real vault.

**Scan before you push.**

- `bun run security:working` scans the proposed working tree (verify runs it).
- `bun run security:changes <base-sha> <head-sha>` scans the commits you are
  about to push.
- `bun run security:history` scans all local history and is mandatory before
  any publication step.

`.gitleaks.toml` allows exactly one value, jwt.io's public sample token. Never
widen it to hide a finding.

**If a real secret or personal detail lands:** stop and tell the owner. The
credential must be rotated before anything else; deleting the line is not
remediation, because history keeps it. Removing it from history is a separate,
owner-authorized rewrite.
