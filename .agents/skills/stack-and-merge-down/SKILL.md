---
name: stack-and-merge-down
description: Keep dependent work as a straight chain of PRs, each targeting the one before, and merge it one PR at a time without conflicts. Use when a change builds on an unmerged PR, when the owner asks to keep stacking, or right after a PR in a chain is squash-merged.
---

# Stack and merge down

Use with the ship-a-change skill, which owns the PR rules themselves.

## Build the stack

- One straight line: `dev ← A ← B ← C`. Branch each new change from the tip
  (`git switch -c <branch> <tip-branch>`) and open its PR with
  `--base <tip-branch>`. Siblings on the same parent conflict later in
  `CHANGELOG.md` and `ROADMAP.md`; avoid them.
- Start every PR body with its place: "Stack position N. Merge after #X."
- To straighten a fork, merge the sibling into the next branch
  (`git merge origin/<sibling>`), push, retarget with
  `gh pr edit <n> --base <sibling>`, and merge each branch down the chain in
  turn. Never force-push or rebase a pushed branch.
- Edit PR bodies from a saved file. A transform that fails (a BSD `sed`
  quirk) and pipes into `gh pr edit --body-file` wipes the body; keep the
  originals in `/tmp` until the stack merges.

## Merge down

1. Merge the bottom PR into `dev` (squash) only after its CI is green on the
   exact head and every review thread is resolved.
2. The next branch now carries commits `dev` squashed: run
   `git merge origin/dev` on it, keep the branch side of any code conflict
   (it has everything), but keep both sides' new entries in `CHANGELOG.md`
   and `ROADMAP.md`, then push and `gh pr edit <n> --base dev`.
3. Wait for its CI, then repeat up the chain.
4. Confirm `state == MERGED` before deleting a merged branch.
