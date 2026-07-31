# Adding things

This is the placement authority: where a new surface, feature, dependency,
utility, command, shared constant, or CARL domain goes, and which mechanical
check enforces each rule. [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) owns
the system shape, [`../../SYNTAX.md`](../../SYNTAX.md) owns naming, and testing
evidence lives in [`testing.md`](testing.md). When a row and reality disagree,
fix both in the same change. `bun run check:docs` verifies that every concrete
path referenced in this document exists.

## The contract table

| New thing | Home | Checks that apply |
|---|---|---|
| Pane surface | `src/components/` as `<name>Surface.tsx`, exactly one surface per `surfaceKind` in the tab union (`src/types.ts`). Feature-owned surfaces are enumerated exceptions in the naming check: `src/editor/editorSurface.tsx`, `src/components/breve/breveSurface.tsx` | surface/dialog naming grep in `scripts/check-code-shape.mjs` |
| Modal dialog | `src/components/` as `<name>Dialog.tsx` — true today: `src/components/renameDialog.tsx` | same naming grep |
| Overlay / auxiliary window | No suffix rule. Each existing overlay is enumerated here by name: `src/components/onboarding.tsx` (full-window first-run flow), `src/components/palette.tsx` (command palette), `src/components/quickNote.tsx` (the ⌥-summoned quick window), `src/components/whichKey.tsx` (held-modifier key HUD). These are **not** dialogs — renaming them `*Dialog` was considered and refuted as a category error. Any new overlay must add its row to this enumeration | documented enumeration in this table |
| Feature with domain logic | `src/<feature>/` with the model/ports/workflow/composition split. Protection is **not** silently opt-in: either ship the full split (`workflow.ts` + `composition.ts` trigger discovery) or add the directory to `cleanFeatureExemptions` in `scripts/check-architecture.mjs` with a one-sentence reason (today: `src/sheets/`, `src/boards/`, `src/noteChat/`, `src/editor/`). No third state | `bun run check:architecture` |
| Vendor library | Single adapter file/dir + a `vendorSeams` allowlist entry in `scripts/check-architecture.mjs`; must not be on the dependency denylist in `scripts/check-structure.mjs`. Follow the walkthrough and conflict procedure below | both scripts |
| Pure utility | `src/lib/` — pure only. Store-mutating or effectful command modules go to `src/services/` (the shape of `src/services/boardRename.ts` and `src/services/chatRename.ts`) | `bun run check:architecture` domain rules |
| UI state | `src/state/` Zustand store + registration in `src/state/persist.ts` (a tracked chokepoint — see `docs/architecture/code-audit.md`) | — |
| Tauri command | Prefer a sibling module in `src-tauri/src/` over growing `corpus.rs` (tracked debt) + a typed wrapper in `src/lib/tauri.ts`. Command names are multi-segment snake_case, domain-first (`corpus_read`, `local_model_start`); pre-rule names are grandfathered by name in the check, never extended | `bun run check:ipc` |
| TS↔Rust shared constant/policy | **MUST** get a `scripts/fixtures/parity.json` entry plus assertions in BOTH hand-written parity suites — `src-tauri/src/parity_tests.rs` (cargo test) and `src/lib/parity.test.ts` (bun test). Values live in named constants, never inline literals; no hand-mirroring without a fixture. Security policies (egress, endpoint locality) stay **independently implemented** on each side and share adversarial/behavioral fixtures instead: the `scripts/fixtures/egress-fixtures.json` and `scripts/fixtures/markdown-strip.json` pattern | `bun run check:parity` + both test suites |
| Breve runtime code | `breve-runtime/scripts/` — MIRROR-NOT-IMPORT across the app boundary; **within** breve-runtime, plain imports of package-local helpers (e.g. `breve-runtime/scripts/markdown-text.ts`) are the rule, not mirroring. Values shared with the app get a parity fixture entry | `bun run check:parity`, `bun run check:breve-contract` |
| Network call (ureq / fetch / network CLI) | Prefer an existing seam (`web_fetch`, `safe-fetch.ts`, `chat_messages`, `llm.ts`). A genuinely new call site MUST be declared in `scripts/fixtures/egress-allowlist.json` with its destination class + guard; off-machine destinations add adversarial rows to `scripts/fixtures/egress-fixtures.json`. Full procedure in [`security.md`](security.md#adding-a-network-call-procedure) | `bun run check:security` |
| Tests | Co-located `*.test.ts` next to the module (`breve-runtime/tests/` for runtime tests). bun:test declarations use `test(...)`, never the `it(...)` alias — one spelling across the suite | `bun run check:code-shape` (no focus/skip, no test imports from production); oxlint `no-restricted-imports` bans importing `it` from `bun:test` |
| Any new file or folder (naming) | Follow `SYNTAX.md`: `src/` camelCase; `scripts/`, `e2e/`, `docs/`, and `breve-runtime/` kebab-case; `src-tauri/src/` Rust modules snake_case. The 2026-07-18 sweep renamed outliers instead of grandfathering | `bun run check:structure` |
| Executable script / checker | `scripts/<kebab-name>.mjs` (or `.sh`), wired into a `package.json` script AND the `lint`/`check`/CI chain in the same change — an orphan checker is a silent third state. Its command joins the map in [`testing.md`](testing.md) | `bun run check:docs` (orphan + chain + command-map guards), `bun run check:structure` (name) |
| tsconfig / strictness flag | Three compilers typecheck the repo (root, `tsconfig.e2e.json`, `breve-runtime/tsconfig.json`). Load-bearing strictness flags must be enabled in all three or carry a dated, measured divergence entry in `scripts/check-structure.mjs` (today only breve-runtime diverges: `exactOptionalPropertyTypes` 11, `noUnusedLocals` 9, `noUnusedParameters` 3, `noUncheckedIndexedAccess` 86 errors, measured 2026-07-18) | `bun run check:structure` |
| Regression spec (Playwright E2E) | `e2e/<flow>.spec.ts` — one file per user-facing gesture/flow, not per component. Reuse `e2e/support.ts`'s helpers (`gotoApp`, `pointerDrag`, `edgePoint`, `centerOf`) instead of re-deriving pointer-drag mechanics per spec. Selectors prefer the roles/`data-*` attributes the surface already exposes; add a `data-testid` only when nothing stable exists. Reserve this layer for what a `src/**/*.test.ts` unit test can't exercise — a real pointer/DOM gesture or cross-surface wiring — never a duplicate of coverage a unit test already has | `bun run check:e2e-types` (`tsc -p tsconfig.e2e.json`), `bun run test:e2e` |
| CSS | Per-surface file in `src/styles/` on semantic tokens; raw colors (hex AND `rgb()`/`hsl()`) only inside the token-definition layer; class selectors kebab-case (BEM `--modifier` allowed), feature-prefixed | `bun run check:design-system`, `bun run check:hex` |
| CARL domain | Only when the recall vocabulary is genuinely distinct — see `docs/architecture/ai-context-architecture.md`. Coverage is measured mechanically: every top-level `src/` directory over 2,000 lines must appear in the dir→domain map (or its exemption list) in `scripts/check-documentation.mjs` | `bun run check:docs` |

**CARL surfacing (recorded decision):** this document is pointed to by one
compact placement rule in `ROTLI_CORE`, plus references in the editor/keys
domains where placement is load-bearing. It is deliberately **not** copied into
every domain: CARL law is compact recall pointing at owning docs, never a
second spec, and a per-domain copy would be exactly that.

## Adding a vendor library, step by step

1. Confirm it is not on the denylist in `scripts/check-structure.mjs` (no
   database engines; no SheetJS).
2. Create one narrow adapter (a file or a small dir such as
   `src/sheets/engine/` or `src/documents/codec/`); nothing else imports the
   vendor.
3. Add the vendor to `vendorSeams` in `scripts/check-architecture.mjs` with its
   allowed adapter paths — the check fails any import outside them.
4. Add focused tests for the adapter's behavior and failure states.
5. If the dependency also ships inside the Breve runtime, keep the version
   ranges identical — `scripts/check-structure.mjs` compares them against
   `breve-runtime/defaults/package.json`.

**Dependency-conflict procedure:** if a candidate dependency collides with an
existing seam (same capability, overlapping API, or a second path to a vendor
that already has an adapter), the adapter-owner file wins — raise the conflict
in the PR and either extend the existing adapter or replace it wholesale.
Never add a second import path for the same capability.

## New tool caches and generated output

Generated, dependency, machine-local, and secret material is never tracked. A
new tool that writes a cache, build metadata, or local state ships its
`.gitignore` entries in the same change that introduces the tool — the
tool-cache block in `.gitignore` cites this section as its policy home.
Committed caches are the exception, not the rule, and must be deliberate and
reviewed (e.g. `scripts/dup-judgments.json`, which is un-hidden precisely so
broad ignore rules cannot sweep it).

## Considered and rejected (2026-07-18 enforcement audit)

Recorded so these decisions are not re-litigated from scratch. Each may be
revisited with new measurements; none may be adopted silently.

- **Import ordering/grouping (oxlint's import plugin or simple-import-sort):**
  rejected. Enforces an aesthetic with no measured drift harm. Follows the
  same measured-threshold discipline recorded in `.oxlintrc.json`.
- **lint-disable budget counter:** rejected. A handful of disables exist;
  `--report-unused-disable-directives-severity=error` already deletes dead
  ones. A counter constant makes every legitimate disable a two-edit chore —
  nag, not signal.
- **stylelint:** rejected as a toolchain. The one rule it would carry
  (kebab-case class selectors, measured at 0 violations) was folded into
  `scripts/check-design-system.mjs` instead — no new dependency.
- **Per-commit CHANGELOG gate ("touching src/ requires a changelog entry"):**
  rejected. It cannot read intent — refactors, tests, and tooling commits would
  false-positive constantly. Release notes are derived from the version section
  by `scripts/release.sh` at the moment they matter; per-commit discipline stays
  prose (CONTRIBUTING "Making a change", step 7).
- **Removing the CARL 2,000-line dir→domain threshold:** rejected. The
  threshold is the deliberate, documented knob (see the CARL row above); mapping
  every scratch-sized directory would make each experiment a config chore.
- **Rust module ↔ architecture-doc map:** rejected. Cargo already forces every
  module through a central `mod` declaration in `src-tauri/src/lib.rs`;
  requiring a prose mention per module is a docs nag with no observed drift.
- **IPC known-domain-prefix allowlist:** rejected in favor of the minimal
  multi-segment snake_case rule now in `scripts/check-ipc-contract.mjs` — a
  curated domain list must be edited for every new domain, which is exactly the
  kind of maintenance knob that rots.
