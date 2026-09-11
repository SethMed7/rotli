# Repository access and contribution controls

The repository remains private until the owner explicitly authorizes publication.
Only **@SethMed7** currently approves changes into `main` and `dev`. Adding a
collaborator, reviewer, team, app, or bypass is a separate owner decision.
`CODEOWNERS` names the reviewer but does not enforce protection on its own.

## Branch controls

The reviewed desired state lives in `.github/rulesets/`. Both rulesets must be
active for **both** branches:

- `integrity.json`: PR-only, passing up-to-date GitHub Actions checks, resolved
  review threads, squash/linear history, no deletion or force push, no bypass.
- `owner-review.json`: code-owner approval, stale approvals dismissed, last push
  approved. Repository admin may bypass **review only through a PR**. On this
  personal repository the owner is the sole admin; no collaborator or bot is a
  release approver. This narrow self-review exception is necessary because
  GitHub does not allow authors to approve their own PRs. The independent
  integrity ruleset still enforces CI and prevents direct pushes.

Inspect the exact payloads with `bun run security:protect`. After the account
supports private-repository rules, the owner can apply them using
`bun run security:protect --apply`. The helper checks the authenticated owner,
updates only its two named rulesets, and reads them back. A partial application
must be repaired before treating either branch as protected. Re-run after a
required job name or GitHub App changes. Existing unrelated rules are retained.

**Verified 2026-09-09:** GitHub returned HTTP 403, “Upgrade to GitHub Pro or make
this repository public to enable this feature,” for rulesets and both branch
protection endpoints. Protection is therefore **not established**. Keep the repo
private; enabling an eligible plan is an owner account/billing action, not a
reason to expose the source. The only collaborator is the owner. Actions has
read-only workflow permissions, cannot approve PRs, and has full-SHA pinning
required. No repository Actions secrets, deploy keys, webhooks, or self-hosted
runners were listed. This does not audit account-wide GitHub Apps, user tokens,
organization credentials, or any external deployment provider's access.

## Contributor flow

1. For this private repository, request owner-granted access through the existing
   private project channel. Do not upload private code to a public fork.
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

The 2026-09-09 history scan reported 492 matches: two recurring JWT/GCP-shaped
literals in `src-tauri/src/corpus.rs` security tests across 246 commits each.
They appear as test inputs, with no other scanner rule/file groups reported.
This is not proof those historical literals were never issued credentials;
confirm provenance before allowing them or publishing history. Do not suppress
an entire source file. All commit author/committer email domains scanned were
GitHub's `users.noreply.github.com` or `github.com`. One current decision document
contained a personal home path; it now uses `/Users/example`. Its historical
copies still require the same publication review. Binary media requires visual
review; Gitleaks does not prove screenshot privacy.

## References

[GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
and [code owners](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)
define the platform behavior. [Release integrity](release-and-supply-chain.md)
owns signing, notarization, evidence, credentials, and publication.
