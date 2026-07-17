# Adding things

This is the placement authority: where a new surface, feature, dependency,
utility, command, shared constant, or CARL domain goes, and which mechanical
check enforces each rule. The architecture law behind these rows lives in
[`../architecture/clean-architecture.md`](../architecture/clean-architecture.md);
testing evidence lives in [`testing.md`](testing.md). When a row and reality
disagree, fix both in the same change. `bun run check:docs` verifies that every
concrete path referenced in this document exists.

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
| Tauri command | Prefer a sibling module in `src-tauri/src/` over growing `corpus.rs` (tracked debt) + a typed wrapper in `src/lib/tauri.ts` | `bun run check:ipc` |
| TS↔Rust shared constant/policy | **MUST** get a `scripts/fixtures/parity.json` entry plus assertions in BOTH hand-written parity suites — `src-tauri/src/parity_tests.rs` (cargo test) and `src/lib/parity.test.ts` (bun test). Values live in named constants, never inline literals; no hand-mirroring without a fixture. Security policies (egress, endpoint locality) stay **independently implemented** on each side and share adversarial/behavioral fixtures instead: the `scripts/fixtures/egress-fixtures.json` and `scripts/fixtures/markdown-strip.json` pattern | `bun run check:parity` + both test suites |
| Breve runtime code | `breve-runtime/scripts/` — MIRROR-NOT-IMPORT across the app boundary; **within** breve-runtime, plain imports of package-local helpers (e.g. `breve-runtime/scripts/markdownText.ts`) are the rule, not mirroring. Values shared with the app get a parity fixture entry | `bun run check:parity`, `bun run check:breve-contract` |
| Tests | Co-located `*.test.ts` next to the module (`breve-runtime/tests/` for runtime tests) | `bun run check:code-shape` (no focus/skip, no test imports from production) |
| CSS | Per-surface file in `src/styles/` on semantic tokens; raw colors only inside `src/brand/` | `bun run check:design-system`, `bun run check:hex` |
| CARL domain | Only when the recall vocabulary is genuinely distinct — see `docs/architecture/ai-context-architecture.md`. Coverage is measured mechanically: every top-level `src/` directory over 2,000 lines must appear in the dir→domain map (or its exemption list) in `scripts/check-documentation.mjs` | `bun run check:docs` |

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
