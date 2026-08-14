# Code quality and organization audit — 2026-08-13

## Outcome

Rotli's automated quality gate is strong. It checks more than conventional
formatting and lint: strict types, dead code, dependency declarations, module
cycles, clean-architecture direction, IPC parity, security boundaries, design
tokens, naming, documentation wiring, deterministic behavior tests, and Rust
warnings all fail mechanically. The gate is suitable for protecting current
contracts.

The main maintainability risk is concentration, not an absence of rules. A few
large presentation and host modules carry several responsibilities, while most
of the repository already follows clear feature seams. A green gate therefore
means “the encoded invariants hold,” not “every module is easy to change.”

## Quality-gate assessment

### Strong and enforced

- Four TypeScript scopes—`src`, Vite/build policy, E2E, and Breve—are strict-
  checked by both `typescript@7` and the independent `typescript6`
  implementation. `bun run check` executes every lane.
- oxfmt owns TypeScript in `src`, E2E, and `scripts`, with a matching staged-
  content hook. Import ordering is automatic except where CSS evaluation order
  is explicitly load-bearing.
- oxlint applies its complete correctness category plus the repository's
  measured type-aware promise, explicit-`any`, React-hook, and test-spelling
  rules to application, E2E, tooling, Breve, and root configuration code.
- Knip rejects unused files, exports, and dependencies as well as undeclared
  imports and binaries.
- `check:code-shape` rejects production cycles, production-to-test imports,
  hidden type errors, focused tests, and skipped tests across Bun and
  Playwright suites. Fixture tests prove the rejection behavior.
- Custom architecture, IPC, parity, security, structure, design-system, and
  documentation guards encode product-specific rules that a generic linter
  cannot know.
- The source-ownership registry rejects undeclared source areas, presentation
  clusters, root helpers, effectful `lib` exceptions, and services without a
  capability owner. Chat and onboarding presentation are physically clustered
  rather than sharing the root component namespace.
- Rust uses the pinned toolchain and Clippy over all targets with warnings
  denied. The repository deliberately does not use rustfmt because its measured
  structural churn would make behavioral review harder.

### Deliberately bounded

- Broad oxlint style, pedantic, suspicious, and performance categories are not
  gates. A 2026-08-13 probe produced substantial existing debt and framework-
  incompatible advice (including classic-React JSX-scope findings under the
  automatic JSX runtime). New rules should continue to be measured and adopted
  individually when their signal is clear.
- oxfmt does not own CSS, Markdown, Rust, Breve's hand-aligned tables, or legacy
  MJS checkers. CSS shape and colors have dedicated semantic checks; the other
  surfaces rely on their narrower tools and review. Convert MJS tooling to
  strict TypeScript when materially changing it rather than creating a
  repository-wide format migration.
- Duplication mining is advisory. Its model-assisted mode can expose source
  snippets externally, so it correctly remains opt-in and outside the required
  offline gate.
- There is no maximum-lines or generic complexity rule. Those metrics are useful
  audit signals, but hard thresholds would encourage mechanical file splitting
  without improving responsibility boundaries.

## Maintainability hotspots

Measured physical line counts identify the following decomposition targets.
They are not automatic failures; each extraction needs focused behavior tests
and a real ownership seam.

1. `src-tauri/src/corpus.rs` (~12,900 lines) combines the largest amount of
   storage, policy, and command behavior. Continue moving cohesive command
   families behind sibling modules while preserving its security and revision
   gates at one composition boundary.
2. `src-tauri/src/organizer.rs` (~5,300 lines) and `workspace.rs` (~3,600 lines)
   remain large host capabilities. Separate pure decisions from filesystem and
   provider effects before splitting command registration.
3. `src/components/chat/chatSurface.tsx` (~3,100 lines) and
   `settingsSurface.tsx` (~2,900 lines) contain multiple visible workflows.
   Extract stateful sections by user task, retaining one surface composition
   module and co-located presentation tests.
4. `src/components/breve/breveSurface.tsx` (~2,100 lines) should continue toward
   one presentation module per Breve page, using the existing shared model and
   form primitives.
5. `src/lib/tauri.ts` (~2,200 lines) is a broad IPC adapter. Split it by
   capability without changing wire names or moving Tauri concerns inward.
6. `src/state/persist.ts` (~1,500 lines), `sidebar/sidebarHome.tsx` (~1,300
   lines), and `state/panes.ts` (~1,100 lines) are secondary targets. Prefer
   extracting a policy or workflow over extracting helpers solely to reduce a
   number.

## Stable seams

- `src/newItems/`, `src/documents/`, `src/chatMemory/`, and the clean-feature
  directories separate domain, workflow, ports, adapters, and composition.
- `src/services/notesPort.ts` keeps application behavior independent of browser
  and filesystem implementations.
- Brain journal transitions remain pure; persistence and live dependency
  selection stay at adapter/composition edges.
- `src/ai/budget.ts` and `src/memex/modelMap.ts` keep capability policy as pure
  projections rather than presentation conditionals.
- Rust corpus, provider, workspace, and secret modules remain independent
  security boundaries even where their files still need decomposition.

## Next improvements

1. Decompose one hotspot at a time behind existing tests; start with the
   narrowest independently testable responsibility, not the largest file.
2. When an MJS checker needs substantive work, migrate that checker to strict
   TypeScript and keep its fixture test in the same change.
3. Re-probe oxlint categories on upgrades. Adopt a rule only after fixing its
   complete measured debt or recording a narrow, justified exception.
4. Keep turning review findings into checker fixtures. Regex-based guards are
   appropriate for stable lexical invariants; use the TypeScript AST or a
   behavior test when syntax context changes the meaning.

File size alone is not a reason to add generic abstractions. The success
criterion for each extraction is a smaller responsibility boundary with equal
or stronger behavioral proof.
