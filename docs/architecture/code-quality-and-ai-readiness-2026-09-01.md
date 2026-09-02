# Code quality and AI readiness — 2026-09-01

Read-only review of `main` at `eb83444` (post-0.84.0). Two reviewers mapped
code quality/redundancy and agent guidance; every count below was measured on
the working tree and spot-checked. Companion to
[`system-audit-2026-09-01.md`](system-audit-2026-09-01.md) (behavioural
findings); this document is about the shape of the code and how well the
repository equips an AI agent to change it correctly.

## Headline

The repository is unusually agent-ready at the guidance layer and unusually
under-disciplined at the file-size layer. The instruction graph is single
canonical (`AGENTS.md`, 4,683 B under a mechanically enforced 5,000 B ceiling;
`CLAUDE.md` is a 446 B import), the guard layer is deep (14 `check:*` scripts,
`check:docs` alone carries ~50 assertions including live CARL MCP smoke tests,
knip clean, zero TODO/FIXME, one `any`), and the vendor boundary is real (two
files touch `@tauri-apps`). Against that: **no guard measures size**, so six
frontend files exceed 1,200 lines, one component body is 1,174 lines, one Rust
`impl` block is 3,548 lines, and the repo's own duplication miner reports 231
clusters that nothing gates. The tests that exist for the largest layer are
mostly source-string assertions that pin the god-file shape.

## Numbers

| Measure | Value |
|---|---|
| TypeScript production / test lines | 66,913 / 18,468 |
| Rust lines | 42,593 (`corpus.rs` 13,676; `impl CorpusStore` 3,548 in one block) |
| Unit-test files / modules | 170 / 302; `src/components` 0.41 tests per module at 40% of TS lines |
| e2e specs / Rust tests | 34 / ~439 |
| Files over 1,200 lines (TS) | 6 — settings 3,504; chat 3,317; Breve 2,540; Tauri adapter 2,434; persistence 1,679; sidebar home 1,300 |
| Function or component bodies ≥ 180 lines | 53 (largest: `registerDefaultActions` 771, `sidebarHome` ~1,174, Rust `run()` 691) |
| UI store fields | 408 in one Zustand store |
| Duplication clusters (`check:dup`, advisory) | 231, 3 allowlisted, not in the lint chain |
| `as unknown as` / `any` / lint suppressions / TODO | 21 / 1 / 13 / 0 |
| Dated "(the maintainer, …)" comments | 368 across 133 files; 5 of 5 sampled narrative comments stale |
| Always-loaded agent context (repo-owned) | 5,129 B ≈ 1.3k tokens; a typical editor task ≈ 11.4 KB with CARL |
| CARL rules with a source changed after `last_reviewed` | 45 of 48 (one confirmed stale rule) |

## Scorecard (1–5)

| Dimension | Score | Basis |
|---|:---:|---|
| Entry-point clarity | 5 | 446 B adapter → 4.7 KB canonical → 41-row contract map; budgets enforced |
| Contract ownership | 5 | One fact, one home; `check:docs` proves no dead links, no orphan scripts |
| Guard coverage | 4 | Deep and broad; six prose-only gaps (below) |
| Discoverability | 4 | 5 of 7 probe tasks answered from linked docs; window events answered nowhere |
| Context economy | 4 | Excellent base cost; `ROTLI_CORE` is de-facto always-on (39 broad recall words, no hook cap) |
| Dead code | 4 | knip clean, 0 TODO, 1 `any`; only `gemini35` union residue |
| Layering | 3 | Vendor seams enforced; 27 of 75 components import the Tauri adapter directly, unguarded |
| Rust hygiene | 3 | 2 non-test unwraps in `corpus.rs`; but no clippy config, one global mutex behind 65 commands |
| Redundancy | 2 | 231 unguarded clusters; three dark-theme idioms across ten sites against a written rule |
| Test quality | 2 | Coverage inverted against risk; 27 source-shape assertions block the refactors most needed |
| Comment hygiene | 2 | Rationale is good; dated provenance duplicates `git blame` and rots |
| CARL freshness | 2 | No freshness guard; 19% of `carl.json` is undated adopted staging |
| Skills currency | 2 | The one skill omits `bun run verify`, the command it exists to teach |
| **Size discipline** | **1** | No LOC or function-length guard anywhere in a 16-check lint chain |

## Code quality findings

1. **No size guard.** `check:code-shape` detects cycles only. That is why
   `settingsSurface.tsx` (12 pane components already delimited inside it),
   `chatSurface.tsx` (private glyph set, three popover pickers, a markdown
   renderer), `breveSurface.tsx` (six views), `sidebarHome.tsx` (one
   ~1,174-line function body with two `exhaustive-deps` disables), and
   `lib/tauri.ts` (213 exports, no internal topology) grew unchecked.
2. **Duplication is measured but not gated.** Byte-identical popover placement
   effects at `chatSurface.tsx:664-702` and `:1121-1155`; `BriefBody`
   (`breveSurface.tsx:235`) and `NotePeek` (`previewModal.tsx:35`) are the same
   38-line loop over already-shared helpers; 20 action-id literals restated in
   `formatBar.tsx` and `keys/actions.ts`; three onboarding panes share large
   literal blocks despite `setupControls.tsx`.
3. **Dark-theme detection has three idioms across ten sites** although
   `ARCHITECTURE.md` prescribes one `useSyncExternalStore` hook and
   `state/theme.ts` owns `isDarkDataTheme`. `canvasSurface.tsx:59` re-reads
   `matchMedia`, which is the non-reactive Excalidraw theme finding in the
   system audit.
4. **Markdown task grammar disagrees with itself.** `taskState.ts:24` accepts
   only `- [ ]`; `editor/model.ts:56` and `corpus.rs:2089` accept `*`, `+`, and
   numbered markers. A `* [ ] todo` line is a task to the Rust index and to the
   dirty-signature but not to the editor's toggle. Four separate mark
   character classes exist (`MARK`, `CHOICE_MARK`, `RESULT_MARK`, `MARKS`).
5. **Unguarded cross-process mirrors.** `parity.json` correctly pins the image
   extension list, but a third copy lives in `lib.rs` (the picker filter), the
   "Secure notes" folder name is restated in `secureNotes.ts`,
   `destinations.ts`, and two Rust match arms with no fixture, and
   `derive.ts stripMarkdown` mirrors `corpus.rs strip_markdown` without one.
6. **Layering leak.** `check:architecture` forbids `lib/tauri` imports only for
   discovered clean-feature role files; 27 of 75 components import the adapter
   directly, skipping services. The documented order is enforced for ~10
   files and unenforced for the 26k-line component tree.
7. **Tests pin text.** Eight test files hold 27 `readFileSync` assertions on
   source strings, two named for extraction modules that do not exist
   (`chatMessagePresentation`, `onboardingPresentation`). They give false
   confidence for the least-tested layer and mechanically break when a pane is
   extracted, so they defend the god-file shape.
8. **Rust.** `corpus.rs` interleaves eight `#[cfg(test)]` blocks through
   production code; the `Layout`/`Surface` match ladder repeats at eight sites;
   `generate_handler!` registers 187 flat commands; `CorpusState` is one
   `Mutex` behind 65 of them with no reader/writer split. No `[lints.clippy]`
   section exists, so `unwrap_used` is not even a warning (non-test unwraps
   are nonetheless low: 2 in `corpus.rs`, 71 of `organizer.rs`'s 76 are the
   `.lock().unwrap()` idiom).
9. **Stale narrative comments.** `chatSurface.tsx:12` says "Still Increment 1:
   one-shot (no streaming)" above a file with streaming state;
   `corpus.rs:8069` says `corpus_set_ai_field` has "no caller yet" (three
   callers); the "Brain → Vault rename" is documented as done while
   `systemSurface.tsx:141` and `sidebarSystem.tsx:69` still route on
   `"Brain"`; "Phase 3" refers to three different things in three files.
   `LegacyRotli` is the default layout for new roots and is named "Legacy".
10. **Residue.** `OrganizerModel` keeps `"gemini35"` and `activitySurface`
    labels it, while `parseSettings` coerces it to `local` and no UI can set it.

## AI-readiness findings

1. **The only repo skill teaches the wrong proof chain.**
   `.agents/skills/verify/SKILL.md` lists `lint → test:regression → cargo test
   → build` and never names `bun run verify`, `site/`, Playwright, or clippy —
   the three lanes `verify.sh` was created to add, six days before the skill
   was written. `check:docs` validates that referenced commands exist, not that
   the chain is complete. `CONTRIBUTING.md:287-299` and `ai-workflow.md:44-47`
   describe the same weaker chain.
2. **CARL has no freshness guard.** `check:docs` verifies each rule's `source`
   exists; nothing compares `last_reviewed` to the source's last change. 45 of
   48 rules have a source modified after review. Confirmed stale:
   `ROTLI_DESIGN#0` lists four themes; the app ships six families and twelve
   environments (`check:design-system` already asserts the twelve labels).
   The same four-theme list survives in `CONTRIBUTING.md:298` and
   `.github/pull_request_template.md:27`. Seven adopted staging entries
   (8,164 B, 19% of `carl.json`) are unpruned and undated.
3. **`ROTLI_CORE` is always-on in effect.** Eleven rules, 4.5 KB, 39 recall
   words including `architecture`, `testing`, `tauri`, `release`; the hook
   applies no domain cap, so it matches nearly every prompt. The context
   architecture doc says no domain is always-on; true in config only.
4. **Window events have no owner.** Twenty-five `rotli:*` emit/listen literals
   in `lib/tauri.ts` (`rotli:capture`, `rotli:appearance`,
   `rotli:quick-created`, …) appear in no doc, no CARL rule, no
   `adding-things.md` row, and no parity check.
5. **`persist.ts` is an unguarded 1,679-line chokepoint.** The "UI state" row of
   the placement law has `—` in its checks column; the last two settings bugs
   (appearance sync, Quick Note filing) both passed through it.
6. **Discoverability gaps**: slash command, theme token, and settings each have
   an owner but no how-to row; `src/brand/README.md` is one line.
7. **Superseded audits carry no in-file banner**, and
   `system-audit-2026-07-11.md` is reachable only through a link inside the
   superseded 07-29 audit.
8. **Cleared, not stale**: the Mermaid CARL rule matches `DESIGN.md` and code;
   Breve's four PDF palettes are correct; both Cursor and Antigravity MCP
   configs carry `CARL_READONLY=1`; CHANGELOG discipline is exemplary (30 of
   the last 30 commits touch it).

## Recommended order

Same-day, near-zero risk:

1. Rewrite the `verify` skill around `bun run verify`; align `CONTRIBUTING.md`
   and `ai-workflow.md`; add a guard that any file describing pre-handoff
   validation contains the literal `bun run verify`.
2. Fix the four-theme list in `carl.json`, `CONTRIBUTING.md`, and the PR
   template; guard it against `check:design-system`'s canonical labels.
3. Extract `useAnchoredPopoverBox` into `lib/popover.ts`; delete `NotePeek`
   in favour of `BriefBody`; export `EDITOR_ACTIONS` constants; remove the
   `gemini35` residue.
4. Export `useIsDarkTheme()` from `state/theme.ts` and replace the ten sites
   (also closes the Excalidraw System-mode finding).

Guards to add so the debt cannot return:

5. LOC and function-length ratchet in `check:code-shape` with a baseline file
   (the `react-compiler-baseline.json` pattern); mirror as an `impl`-block
   ceiling for Rust.
6. Promote `check:dup` into the lint chain with a cluster-count ratchet.
7. CARL freshness: compare `last_reviewed` to `git log -1` of each source;
   fail on undated or lingering `adopted` staging entries.
8. Window-event registry: collect `emit`/`listen` literals across TS and
   Rust, fail on unmatched pairs, require a documented table.
9. Extend `protectedLayers` so `src/components/**` cannot import `lib/tauri`
   outside a shrinking allowlist; oxlint restrictions on `matchMedia` and
   `invalidateQueries` outside their owners.
10. `parity.json` entries for the "Secure notes" name, `stripMarkdown`, and
    the picker extension list; `[lints.clippy]` with `unwrap_used = "warn"`.
11. Ratchet source-shape assertions from 27 toward 0 by creating the modules
    the tests are named for; coverage-ratio floor per `src` directory.
12. Reject new `(the maintainer, 20…)`, `Increment N`, `Phase N` strings in
    source; rationale stays, provenance moves to `git blame`/CHANGELOG.

Larger refactors, in order of value over risk:

13. Split `settingsSurface.tsx` into its twelve panes (after 11 unblocks it),
    then `sidebarHome.tsx` along its existing model/hook seams, then
    `chatSurface.tsx` (glyphs, pickers, renderer), then `breveSurface.tsx`.
14. Split `lib/tauri.ts` by owning Rust module behind a barrel.
15. Unify the task grammar in one module with a parity fixture (fixes the
    `* [ ]` toggle gap).
16. `corpus.rs` → `corpus/{layout,frontmatter,tasks,secure}.rs`, starting with
    `layout`; move `generate_handler!` to `commands.rs`; consider `RwLock` for
    the corpus registry once contention is measured.
