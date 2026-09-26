# Quality guards and agent tooling audit (2026-09-23)

Status: **findings and proposals only.** Nothing was changed. Per
CONTRIBUTING's "review learnings become guards," each accepted gap lands as a
mechanical guard in its own PR.

## 1. Result: every fast gate is green

Run on `fix/quick-note-keys-scroll-top` at e7b82653. Another session committed on that branch during the run (340a6522, Quick Note / key-map files), so those files may not be reflected.

| Gate | Result |
|---|---|
| `bun run lint:serial` (typecheck TS7 + TS6, oxfmt, knip, oxlint, every `check:*` in the lint chain) | pass |
| oxlint 1.78.0, `maxWarnings: 0` | 0 diagnostics |
| `check:design-system` (runs in `test:regression`) | pass |
| `cargo clippy -D warnings` | pass |
| `test:tooling` / `test:unit` | 105 / 2,288 pass |

Full `bun run verify` (Playwright + cargo test) was not run for this audit.

## 2. What is in place

- **oxlint:** plugins `typescript`, `react`, `unicorn`, `oxc` (the `plugins`
  list replaces defaults); `correctness` as error; 137 rules. **Type-aware
  linting is on** (`oxlint-tsgolint`), and `scripts/oxc-contract.test.ts`
  proves `no-floating-promises` actually fires. Also on:
  `no-misused-promises`, `no-explicit-any`, `switch-exhaustiveness-check`,
  `return-await`, `no-deprecated`, `only-throw-error`, React hooks rules, and a
  `localStorage`/`sessionStorage` ban. Unused disable comments are errors.
- **oxfmt** width 110 with sorted imports; the pre-commit hook checks staged
  content only (format + conflict markers).
- **tsconfig:** `strict`, `exactOptionalPropertyTypes`,
  `noUncheckedIndexedAccess`, `noUnused*`, `noFallthroughCasesInSwitch`,
  held equal across configs by `check:structure`.
- **Custom guards:** `code-shape` (no import cycles across 561 modules; no
  focused/skipped tests), `architecture` (folder owners, inward layers, Tauri
  only via `lib/tauri.ts`, vendors behind adapters), `ipc` (187 frontend
  commands resolve), `parity` + `secret-parity` (TS↔Rust constants and secret
  patterns), `ratchets` (44 file ceilings, source-shape and dated-comment
  caps), `dup:gate`, `react-compiler` baseline, naming, hex, security, docs,
  window-events, web-privacy.
- **Bundle budgets** (`scripts/build-policy.ts`): 1,600 KiB initial /
  3,600 KiB lazy.
- **Rust:** `warnings = "deny"`, `clippy::all = "deny"`.

## 3. Findings

1. **Seven registered Rust commands have no TS caller** (tests included):
   `corpus_add_folder`, `corpus_forget_folder`, `corpus_new_file_bytes`,
   `corpus_set_field`, `local_model_default`, `local_queue_status`,
   `memex_read`. Each is webview-reachable attack surface with no user.
   `check:ipc` only checks frontend → Rust.
2. **`dup:gate` has no headroom:** 226 clusters against a 226 ceiling. The next
   copy-paste fails CI — good — but nobody is paying the number down.
3. **Ratchet slack:** 25 files sit a combined 1,021 lines under their
   ceilings; source-shape assertions have 9 spare, dated comments 7. Growth
   inside the slack passes silently. `src-tauri/src/corpus.rs` is 13,696 lines.
4. **Linux Rust is compiled, never linted.** CI runs only `cargo check` on
   Linux, so the ~20 `cfg(not(target_os = "macos"))` blocks never see clippy.
5. **No CHANGELOG guard.** AGENTS.md requires an `[Unreleased]` entry for
   user-visible changes; nothing checks it.
6. **Suppressions are uncapped:** 43 `as unknown as`, 14 lint-disable comments,
   2 `@ts-ignore`, 11 Rust `#[allow]`.

## 4. Proposed guards, in order

| # | Guard | Violations today | Effort |
|---|---|---|---|
| G1 | Turn on the rules already at zero: `typescript/restrict-template-expressions`, `no-base-to-string`, `require-array-sort-compare`, `restrict-plus-operands`, `no-redundant-type-constituents` | 0 | one PR, S |
| G1b | `import/no-self-import` (0) — needs the `import` plugin, and because `plugins` replaces defaults and `correctness` is an error, enabling it turns on every import-plugin correctness rule; count that category first | 0 + unmeasured | S |
| G2 | `react/iframe-missing-sandbox`, `preserve-caught-error`, `no-unmodified-loop-condition` | 3 / 2 / 1 | S |
| G3 | `check:ipc` reverse direction: every registered handler has a caller, with a grandfather list; then delete or wire the seven | 7 | S–M |
| G4 | CHANGELOG guard in `scripts/ci-scope.ts`: a `src/` or `src-tauri/` diff must touch `[Unreleased]` (opt-out label for internal-only changes) | — | S |
| G5 | Auto-tighten ratchets: a green run rewrites ceilings to current values (or fail when slack > N lines) | 1,021 lines slack | S |
| G6 | Linux CI lane: `cargo check` → `cargo clippy -D warnings` | unknown | S (+ fixes) |
| G7 | `promise` plugin: `catch-or-return`, later `always-return` | 17 / 77 | M |
| G8 | `jsx-a11y` keyboard rules (`no-static-element-interactions`, `interactive-supports-focus`, `click-events-have-key-events`, `label-has-associated-control`, `control-has-associated-label`, `no-autofocus`) — DESIGN.md already requires keyboard safety | ~39 | M |
| G9 | Function-size and complexity caps behind a baseline (like the react-compiler baseline): `max-lines-per-function` 150, `complexity` 25, `max-params` 5 | 67 / 40 / 13 | M |
| G10 | `react/no-array-index-key`, `eqeqeq` | 21 / 21 | S–M |
| G11 | Suppression ratchet (`as unknown as`, disable comments, `#[allow]`) | 43 / 16 / 11 | S |
| G12 | Folder-level import matrix in `check:architecture` (today only `editor → components` is covered) | 7 files | M |
| G13 | Web-parity guard: every `invoke` wrapper in `lib/tauri.ts` has a browser branch or a "Mac only" marker (the roadmap's §6 parity list, made mechanical) | not measured | M–L |
| G14 | Rust restriction lints with `clippy.toml` `allow-unwrap-in-tests`: `unwrap_used`, `expect_used`, `too_many_lines` behind a baseline | 142 / 21 / 11 | L |
| G15 | Line-coverage floor via `bun test --coverage` | — | M |
| G16 | `noImplicitReturns`, later `noImplicitOverride` | 6 / 35 | S / M |

Skip: `import/no-cycle` (0; `check:code-shape` already covers cycles),
`react-perf` (807, React Compiler territory), `no-non-null-assertion` (103,
noise), `noPropertyAccessFromIndexSignature` (458).

## 5. Agent tooling: skills, not subagents

**Today:** six project skills in `.agents/skills/` (`verify`,
`ship-a-change`, `keep-docs-fresh`, `keep-private-data-out`, `cut-a-release`,
`validate-in-the-native-app`); `.claude/skills` symlinks there, so Claude,
Codex, Cursor and Antigravity all read them, and `check:docs` validates their
frontmatter, `bun run` references, and paths. No project subagents or
commands. No project Claude Code hooks.

**Why skills:** `.claude/agents/` is gitignored today (`.claude/*` with only
`!.claude/skills`), is Claude-only, and has no row in
[ai-context-architecture.md](ai-context-architecture.md). Anything a subagent
enforces would be invisible to the other three agents. Claude Code hooks have
the same problem, and `.claude/settings.json` is untracked, so a hook can
nudge but must never be the only enforcer — the mechanical `check:*` is.

### Proposed skills, by value

| Skill | Covers | Why now |
|---|---|---|
| `review-a-ui-change` | The AGENTS.md UI bar: loading / empty / error / saved / disabled / destructive / narrow states × six families light and dark × keyboard path; semantic tokens only; screenshots per affected family | Most-repeated review class in CHANGELOG; only `check:design-system` + `check:hex` today |
| `add-a-tauri-command` | Rust handler + test, `lib/tauri.ts` wrapper, IPC registry, web branch or "Mac only" marker, `window-events.md` row | Recipe spans five files; G3 + G13 enforce it, the skill teaches it |
| `keep-twins-in-step` | Rust ↔ TS twins (secure/locked, write lanes, board limits, task lines, search rank): change both, add a `parity.json` fixture | Twins are intentional and multiplying (boards, tasks, search) |
| `which-platforms` | Decide native / web / both for a change and what each must prove (`test:e2e:web`, `check:web-privacy`, native checklist) | Many "the web build withholds…" entries; the 2026-09-18 rule that everything also works on web |
| `turn-review-into-guard` | Triage Greptile threads (read the body — a lapsed bot looks green), classify one-off vs class, write the `check-*` / lint rule / fixture in the same PR | CONTRIBUTING's rule has no executor |
| `upgrade-a-dependency` | `bun run deps`, license baseline, audit lanes, TS6/TS7 typecheck, bundle budget | Recurring upgrades, no recipe |
| `change-model-behavior` | Offline evals (`test:evals`, `eval-local-chat.ts`, `eval-vault-sweep.ts`) + secure-note denial tests before any prompt/loop change | AGENTS.md requires it; no skill |

Lower priority: `curate-release-notes` (turn `[Unreleased]` into user-facing
notes inside `cut-a-release`), `clear-carl-debt` (work
`.carl/freshness-debt.json`).

Adding a skill = a folder under `.agents/skills/<name>/SKILL.md` with `name:`
and `description:` frontmatter, then `bun run check:docs`. A row for skills
(and a "no subagents: parity" line) belongs in
[ai-context-architecture.md](ai-context-architecture.md)'s ownership table
when the first one lands.
