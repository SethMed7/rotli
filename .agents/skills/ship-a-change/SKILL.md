---
name: ship-a-change
description: Take a Rotli change from a branch to a merged PR under the protected-branch rules — branch from dev, commit by path, open the PR, wait for CI, and hand the merge to the owner. Use whenever you are about to commit, push, or open a pull request.
---

# Ship a change

`main` and `dev` are protected (`docs/operations/repository-access.md` owns the
rules): every change arrives through a pull request, the five required CI checks
must pass on the latest commit, and only the owner approves and merges. A direct
push or force push is rejected by GitHub. Committing, pushing, or merging still
needs the owner's explicit request (AGENTS.md).

1. **Start clean.** `git fetch origin`, then branch from the current `origin/dev`
   (a fix, feat, or docs prefix). Run `git status --short` first and leave
   unrelated work alone — never `git add -A`, never stash or reset someone
   else's changes.
2. **Prove it.** Bug fixes begin with a failing reproduction. Run
   `bun run format` on touched files, then `bun run verify` (see the `verify`
   skill). Update the owning contract and `CHANGELOG.md` for user-visible changes.
3. **Commit by path** with a message that explains why. Never commit `_review/`,
   vault content, local settings, screenshots of real notes, or credentials.
4. **Open the PR into `dev`** with what changed, how it was proved, and anything
   unproven (native behavior, scheduler, real delivery).
5. **Wait for CI on the exact head commit.** A job that fails before running any
   steps is runner allocation, not a test result. A known flake gets one rerun of
   the failed job, reported as such.
6. **Merging.** Work squashes into `dev`. Promotion is a separate PR from `dev`
   into `main`, merged as a merge commit. Leave both merges to the owner unless
   they asked you to merge.

Never push a local branch created before 2026-09-15: those branches carry the
pre-publication history that was rewritten out of the public repository.
