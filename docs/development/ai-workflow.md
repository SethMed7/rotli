# Working on Rotli with AI

AI is useful here when it operates inside explicit product, data, and process
boundaries. `AGENTS.md` is the canonical machine-facing policy; this document
explains how a human can structure successful AI work.

## Give the agent a bounded context packet

Include:

- the user-visible outcome and behavior that must remain intact;
- the files, capability, or data root in scope;
- whether the task is analysis-only or includes implementation;
- whether live processes, production data, Git publication, or a release are
  explicitly authorized;
- screenshots or reproduction steps for native UI issues;
- the validation commands expected before handoff.

Never assume that permission to edit source code also grants permission to
restart a daemon, mutate a live memex, publish a release, or manage a running
Tauri development process.

## Use one canonical instruction graph

`AGENTS.md` owns the small always-loaded rule set. Claude imports it
(`@AGENTS.md` in `CLAUDE.md`), Codex and Cursor read it natively, Antigravity
loads the `.agents/rules/AGENTS.md` mirror, and Copilot uses its adapter. Project CARL stores topic-sized
recall and decisions; `carl_recall` should run before broad code or documentation
scans. Open only the source contracts it returns. Carl never overrides current
repository contracts; see `architecture/ai-context-architecture.md`.

This arrangement makes tools replaceable: changing an AI client should not
require translating the project into a new set of duplicated rules.

## Preferred work loop

1. **Orient:** call `carl_recall`, read the returned contract, then inspect the
   relevant code, tests, and dirty-worktree status.
2. **Model:** identify the domain rule, application use case, host/vendor
   adapter, presentation state, and independent security boundary.
3. **Change:** implement the smallest complete vertical slice. Keep policies
   centralized and dependencies pointed inward.
4. **Prove:** reproduce bugs with a failing test; cover feature success,
   refusal/failure, and boundary cases; add deterministic offline evals for AI
   behavior. Run oxfmt plus the focused test or guard while iterating, then
   the full validation matrix. Evidence levels and command ownership are in
   [`testing.md`](testing.md).
5. **Handoff:** summarize changes, exact validation results, remaining warnings,
   and native visual checks. Clearly state whether anything was committed,
   published, installed, or restarted.

## Capability-specific evidence

| Change | Minimum focused evidence |
|---|---|
| Theme or product UI | Design-system checks, keyboard/state tests, light and dark screenshots per affected theme family |
| Memex writes or metadata | TS policy tests, Rust write-boundary tests, fixture validation |
| AI retrieval or chat memory | Ranking/budget tests, provenance checks, secure-content denial |
| DOCX, sheets, or boards | Codec round trip, adapter tests, save/reopen behavior |
| Breve | Breve tests, runtime type/build check, dev/production isolation |
| Tauri command | Frontend adapter test, Rust handler test, IPC registry check |

## Good completion criteria

A task is complete when behavior, failure states, tests, architecture guards,
and owning documentation agree. A passing typecheck alone is not enough. A
browser screenshot alone is not enough for native behavior, and a live manual
test alone is not enough for a durable regression boundary.
