# Repository access and contribution controls

The owner authorized publication with the 1.0.0 launch (2026-09-15). Only
**@SethMed7** approves changes into `main` and `dev`. Adding a
collaborator, reviewer, team, app, or bypass is a separate owner decision.
`CODEOWNERS` names the reviewer but does not enforce protection on its own.

## Branch controls

The reviewed desired state lives in `.github/rulesets/`. Both rulesets must be
active for **both** branches:

- `integrity.json`: PR-only, passing up-to-date GitHub Actions checks, resolved
  review threads, squash or merge-commit PRs (development work squashes into
  `dev`; the `dev` → `main` promotion is a merge commit), no deletion or force
  push, no bypass.
- `owner-review.json`: code-owner approval, stale approvals dismissed, last push
  approved. Repository admin may bypass **review only through a PR**. On this
  personal repository the owner is the sole admin; no collaborator or bot is a
  release approver. This narrow self-review exception is necessary because
  GitHub does not allow authors to approve their own PRs. The independent
  integrity ruleset still enforces CI and prevents direct pushes.

Inspect the exact payloads with `bun run security:protect`. Apply them with
`bun run security:protect --apply` (rulesets require a public repository or a
paid plan). The helper checks the authenticated owner,
updates only its two named rulesets, and reads them back. A partial application
must be repaired before treating either branch as protected. Re-run after a
required job name or GitHub App changes. Existing unrelated rules are retained.

Before publication (2026-09-09) GitHub returned HTTP 403 for rulesets on the
private repository, so protection could not be established while private. The
only collaborator is the owner. Actions has
read-only workflow permissions, cannot approve PRs, and has full-SHA pinning
required. No repository Actions secrets, deploy keys, webhooks, or self-hosted
runners were listed. This does not audit account-wide GitHub Apps, user tokens,
organization credentials, or any external deployment provider's access.

## Contributor flow

1. Fork the public repository; never include vault content, settings, or logs.
2. Branch from `dev`; submit a focused PR **into dev**. Include a synthetic
   reproduction, tests, `bun run verify` evidence, and required contract changes.
3. Greptile feedback is advisory review input, never authorization. Resolve and
   answer findings on-thread; disclose unavailable bot review.
4. The owner reviews the exact current diff and squash-merges after required CI.
   An owner-authored PR uses the explicit review-only exception above; it still
   needs the independent mandatory checks and a recorded owner decision.
5. Promote reviewed development work through an owner-controlled PR into `main`.
   `main` builds the stable feature policy. A merge never authorizes signing,
   notarization, publication, installation, or a production deploy.

Before external contributions, establish a reachable private vulnerability
reporting channel as required by `SECURITY.md`. Public bug reports and review
screenshots must contain synthetic content only. Never attach a vault, local
settings, raw logs, private paths, signing records, or credentials.

## Source and upload hygiene

`check:security` includes repository privacy tripwires over tracked and unignored
source: credentials/signing filenames, local vault state, private-key blocks,
and this machine's home path are refused without printing matched values.
`.gitignore`, `.dockerignore`, and `.railwayignore` cover credentials and private
runtime state. These are controls against accidental inclusion, not proof that
arbitrary prose, images, archives, or committed history contain no personal data.

`bun run security:secrets` runs pinned Gitleaks 8.30.1 over a temporary copy of
reviewable working-tree files. `bun run security:history` scans all local Git
refs. CI adds a checksum-pinned `Repository secret scan` over proposed PR/push commits,
with no credentials persisted by checkout and no scan report uploads. Manual/new
branch runs scan reachable history; unresolved historical fixtures can block
those runs. `bun run security:changes <base-sha> <head-sha>` reproduces that check.
Full source/history scans remain separate publication gates, not bypassed by a
clean incremental scan.

Both full scans redact matches and fail on findings or scanner errors; neither sends
files to a scanning service. Run both before source publication. A green build
does not waive unresolved scan findings. A private key or real credential found
in history must be revoked/rotated before any separately authorized history
rewrite; deleting its current file is not remediation.

**Publication review (2026-09-15).** The history scan and a provenance check
found that several secret-detector test inputs had been copied from private
data (an API key, key prefixes, an identity number, and a card number), and that
older revisions carried a personal email address, a home path, and the signing
team identifier. None reached a shipped build. The published repository was
created from a rewritten history that replaces every such value with a
synthetic one of the same shape; the pre-publication repository stays private
as an archive and is never made public, because its pull-request refs still
reach the original commits. The only scanner allowance is jwt.io's public
sample token (`.gitleaks.toml`). Author and committer emails are GitHub
`noreply` addresses. Binary media requires visual
review; Gitleaks does not prove screenshot privacy.

## References

[GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
and [code owners](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)
define the platform behavior. [Release integrity](release-and-supply-chain.md)
owns signing, notarization, evidence, credentials, and publication.
