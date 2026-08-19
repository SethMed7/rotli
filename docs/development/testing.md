# Testing and regression contract

Rotli treats tests and mechanical checks as executable architecture. A change is
not complete when it merely compiles: the behavior, failure state, dependency
direction, runtime wiring, and owning documentation must agree.

## Command map

| Command | Purpose |
|---|---|
| `bun run lint` | All four TypeScript scopes on both compiler implementations, plus formatting, oxlint, code-shape, brand, architecture, IPC, structure, and documentation guards |
| `bun run test:unit` | Frontend domain, application, adapter, and state tests under `src/`, run in Bun's isolated parallel workers |
| `bun run test:changed` | Fast local feedback: isolated Bun tests related to files changed against the default branch |
| `bun run test:evals` | Deterministic offline AI loop, routing, model-policy, prompt, retrieval, and memory-workflow evals |
| `bun run test:breve` | Breve policy, failure-state, locking, and delivery-claim regressions |
| `bun run test:tooling` | Fixture tests that prove repository linters detect forbidden code shapes |
| `bun run test:e2e` | Playwright regression layer — drives the real browser twin (chromium) against `vite dev`'s seeded demo corpus |
| `bun run test:e2e:ui` | The same specs in Playwright's interactive UI runner, for local debugging |
| `bun run check:e2e-types` | Strict-typecheck `e2e/` and `playwright.config.ts` (`tsc -p tsconfig.e2e.json`) — not folded into the root `tsc --noEmit` because that config's `include` is `src` only |
| `bun run check:breve-runtime` | Bundle every runtime entry point, strict-typecheck the runtime (`tsc -p breve-runtime`), validate shell syntax, and verify scheduler/delivery wiring |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | Rust lint gate — warnings fail CI |
| `bun run test:regression` | All Bun behavior tests plus Breve runtime and design-system checks |
| `bun run check` | Required JavaScript/TypeScript gate: lint plus the regression suite |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Rust host, filesystem, security, scheduler, and IPC behavior |
| `NODE_OPTIONS=--max-old-space-size=4096 bun run build` | Production bundling, final TypeScript/runtime validation, and tested startup/lazy chunk budgets |

Development, formatting, and release commands (`check:docs` verifies this map
stays complete — every `package.json` script must appear in this document):

| Command | Purpose |
|---|---|
| `bun run deps` | Repository-owned dependency workflow over the app, site, and Breve lockfiles: `audit` works on the stable pin; Bun 1.4 adds read-only `audit-plan`, `dedupe-check`, `prune-plan`, `licenses`, and root-explicit `diff` actions. Reviewed maintenance uses `audit-fix`, `dedupe`, or `prune` with one explicit `--root` and `--apply`; audit repair never implies `--latest`. `ROTLI_BUN_DEPENDENCY_BIN` may point at an alternate binary for preview validation without changing the release toolchain |
| `bun run dev` / `bun run preview` | Vite dev server against the seeded demo corpus / preview of the built bundle |
| `bun run dev:app` | The native desktop development app, branded `rotli (dev)` with a fixed blue Rotli Dock icon (including an optically matched safe area for the unbundled `tauri dev` runtime); it uses an isolated `corpus.dev.json` vault selection, keeps the production fallback read-only, and supervises vault-triggered Tauri/Vite restarts from the terminal |
| `bun run format` / `bun run format:check` | oxfmt write / verify over TypeScript in `src`, `e2e`, and `scripts`, plus `playwright.config.ts` — the same scope the pre-commit hook enforces, with import sorting on (`breve-runtime` keeps hand-aligned tables and stays outside). `format:check` rides the `lint` chain |
| `bun run typecheck` | The TypeScript compiler over `src` and the Vite/build-policy scope (`tsc --noEmit` — `typescript@7`, the Go port) — the type-correctness source of truth and first step of `lint` (e2e and Breve retain their named lanes) |
| `bun run typecheck:tsc6` | All four scopes (`src`, Vite/build policy, E2E, and Breve) re-checked on `typescript6` (`npm:typescript@~6.0.3`, the last JavaScript TypeScript) — the independent second implementation, not merely a slower one. It is part of `lint` and is called by explicit path because `typescript@7` owns `node_modules/.bin/tsc` |
| `bun run lint:oxlint` | The oxlint layer alone (`src`, `e2e`, `scripts`, Breve, and both root TypeScript configs; oxlint's `correctness` category plus the hand-picked rules, type-aware via `oxlint-tsgolint`) — part of `lint` |
| `bun run check:react-compiler` | Runs Oxlint's React Compiler analysis in lint-only mode. The per-file/category baseline is a ratchet: existing effect/ref debt may shrink, while any increase fails `lint`; no compiler transform enters the production build |
| `bun run check:knip` | Dead-weight gate — unreferenced files, exports, and dependencies, plus undeclared imports and binaries (`knip.json`); part of `lint`. `knip.json`'s `ignoreUnresolved` entry for headless Chrome is **load-bearing on Linux CI and must not be removed**: `breve-runtime/scripts/email-topic.ts` invokes Chrome through Bun's `$` shell, so knip resolves it as a binary. The path exists on a developer Mac, so knip reports the entry as an unused "configuration hint" locally — following that hint turns the Linux Quality lane red while every local check stays green. JSON takes no comments, hence this row |
| `bun run check:dup` | Advisory duplication miner over `scripts/dup-judgments.json` — run on demand, deliberately not a gate |
| `bun run build:mac` | Local signed `.app` bundle (predmg clean + `tauri build`) |
| `bun run release` | `scripts/release.sh` — gate, sign, notarize, staple, publish; only under an explicitly authorized release |

`bun run dev:app` may display the production-selected vault as a read-only boot
fallback, but that fallback never counts as a development selection. Creating
or opening a vault writes only the isolated `corpus.dev.json` binding; after the
clean relaunch, that explicitly selected folder is writable and supports the
same new/open/link/switch flows as the installed app. Production's `corpus.json`
is not repointed. Linking another vault mounts it live and preserves every
development root in `corpus.dev.json`; it does not require a restart marker. A
deliberate primary-vault switch writes one exact temporary restart
request and exits the CLI-owned debug child; the `dev:app` supervisor starts a
fresh Tauri generation instead of leaving a detached executable behind.
Development-only window state stays in the app cache, and
live delivery tests remain disabled. Treat manual interaction with a selected
development vault as real filesystem interaction.

Use the smallest focused command while iterating, then run the three required
handoff commands from `AGENTS.md`. Never point an automated test at a live memex,
Keychain, scheduler, daemon, or production delivery account.

The headless workspace suite lives under `workspace::tests` in the Rust host.
It uses a fresh temporary corpus—not production `corpus.json`—and covers note
creation/read/update, Main references, secure and locked refusals, stale
revision conflicts, Markdown title/frontmatter rules and document metrics, and
compact Excalidraw actions. `rotli agent self-test` is the supported manual
CLI/MCP smoke: it creates and removes its own temporary memex and reports
`liveWorkspaceMutated: false`. Any ad hoc smoke must still set
`ROTLI_CORPUS_ROOT` to a disposable directory.

## Evidence by layer

- **Domain:** pure policy tests with tables of valid, invalid, boundary, and
  recovery inputs. No React, Tauri, filesystem, network, or provider process.
- **Application:** use-case tests with injected ports and in-memory fakes. Cover
  ordering, refusal, retry, and partial-failure behavior.
- **AI eval:** deterministic offline cases for routing, tool-loop behavior,
  capability policy, prompt framing, retrieval ranking, and memory workflow.
  Never call a live provider from the required suite.
- **Adapter:** real codec/package round trips or host-contract fixtures. Assert
  preservation and failure behavior, not a vendor implementation detail.
- **Composition:** mechanical wiring checks prove that the intended adapters,
  locks, trust boundaries, and command registrations are actually connected.
- **Presentation:** visible state and keyboard tests cover loading, empty, error,
  saved, disabled, destructive, and narrow-window behavior.
- **Regression (browser E2E):** Playwright specs under `e2e/` drive the SAME
  browser twin every other layer targets — `isTauri()` is false under `vite
  dev`, so the app renders against the seeded in-memory demo corpus
  (`src/services/notes.ts`) with no Rust shell, onboarding gate, or real
  filesystem/network/Keychain access. Reserved for interaction sequences a unit
  test can't exercise — real pointer-drag gestures (`src/lib/pointerDrag.ts`),
  multi-step gestures crossing components, and cross-surface wiring a mocked
  DOM would paper over. Chromium only; it proves DOM/pointer behavior, not
  native titlebar, menu-bar, or OS-level drag.
- **Native/live:** a separate, explicitly authorized check for titlebars,
  filesystem permissions, Keychain, updater, scheduler, and real delivery. It
  supplements automated coverage and is never silently treated as CI evidence.
  The browser twin can render the vault navigator's loading, empty, error,
  disabled, keyboard, and narrow-window states, but only Rust adapter tests and
  a disposable native folder prove Home containment, hidden/file/symlink
  exclusion, short-lived authorization, and macOS bookmark recovery after a
  move. Never point that native check at a live vault.

### The Playwright layer

`e2e/` holds the browser regression specs; `playwright.config.ts` (repo root)
boots `vite dev` and runs chromium against it. `e2e/support.ts` holds the
shared helpers — `gotoApp`, and `pointerDrag`/`edgePoint`/`centerOf` for the
app's one pointer-drag gesture (real mouse events, not HTML5 DnD, because
HTML5 drag is dead in the macOS WKWebView shell the app ships in and the app
never listens for it).

Selectors prefer the roles/`data-*` attributes the surfaces already expose
(`role="tab"`, `data-tab-id`, `data-note-id`, `data-main-id`, `data-cap-id`,
…) — read the component before writing a selector, and add a `data-testid`
only when nothing stable exists. The seeded demo corpus
(`src/services/notes.ts`) is deterministic across page loads, so specs assert
on its known titles rather than minting fixtures.

A drag's source and drop target can end up in the SAME scroll container (the
sidebar). Scrolling one into view can scroll the other back out — the fix is
either a taller `test.use({ viewport })` or collapsing unrelated accordion
sections first, never a blind wait. The app has no drag-to-edge autoscroll, so
if a real user couldn't reach both ends of a drag in one gesture without
resizing/collapsing first, neither should the test.

The interaction specs are the regression-layer handoff from
`docs/architecture/code-audit.md` ("Regression-layer handoff"): tab reorder
(the CMP-1 visual-index contract, `src/state/panes.test.ts`'s real-gesture
twin), the sidebar's own cross-section-into-Main drag, Board (Captures) card
reorder, and the shared `src/lib/mainAddDrag.ts` module's Main-add drag from
an All-notes row — two different code paths land a note in Main, so both are
covered separately. `e2e/mermaid-workspace.spec.ts` proves the Mermaid
View/Visual/Code workspace, real pointer pan, zoom state, source-backed
flowchart shape/color/connection editing, dirty-close guard, lossless refusal
for unsupported syntax, the slash starter, browser-mode conversion refusal,
and the real converter seam. The Main
creation-context spec then proves that opening a
Main reference and pressing Command-T creates a new tab and an immediate Main
reference while storage remains in the intake lane. The named-view spec proves
inline view creation, active-view Command-T routing, right-click assignment,
and the invariant that the same item remains visible from global Main.

## Change proof matrix

| Change | Evidence required before the full gate |
|---|---|
| Bug fix | A failing reproduction first, then a focused invariant test that fails if the bug returns |
| Feature | Happy path, refusal/failure state, and meaningful boundary cases at the lowest useful layer |
| AI/model behavior | Focused unit coverage plus a deterministic case in `test:evals`; no live-provider dependency |
| Cross-surface gesture or keyboard flow | Focused policy tests plus Playwright when component-local tests cannot prove real wiring |
| Architecture, syntax, security, or documentation law | A deterministic checker and a checker fixture proving the forbidden case is rejected |

Run oxfmt and the smallest type/test/check target while editing. Before
handoff, `bun run check` reruns TypeScript, `format:check`, oxlint, every
mechanical contract, the full Bun suite, named evals, and runtime/design
regressions.

## Regression rules

1. Reproduce a bug with a failing test or deterministic checker before relying
   on a manual confirmation.
2. A feature covers its happy path, at least one refusal or failure state, and
   the boundary conditions that define the behavior.
3. Put policy in a pure module and test it there; test the adapter and composition
   only for translation and wiring.
4. Concurrency regressions must exercise separate OS processes when process
   ownership is the behavior under test. Mocked PIDs alone are insufficient.
5. External delivery tests stop at the claim/receipt boundary. CI never sends
   Signal messages, email, model requests, or watcher traffic.
6. A delivery claim is acquired before an external send and becomes a durable
   receipt only after success. Tests cover contention, completed delivery, stale
   owner recovery, and retry behavior.
7. Every fixed incident updates its owning contract and, when user-visible, the
   changelog. Test names describe the invariant that must not regress.

## Mechanical code checks

- `check:code-shape` rejects production import cycles, focused or skipped tests,
  production imports of test code, and hidden `@ts-ignore`/`@ts-nocheck` errors.
- `check:react-compiler` runs the compiler's Rules-of-React analysis without
  enabling the build transform. Its measured per-file/category baseline can
  only stay level or shrink, so new synchronous effect updates, render-time
  impurity/mutation, unsafe ref access, or suppressions fail mechanically.
- `check:architecture` discovers clean feature roles and enforces inward role
  dependencies, pure ports/policies, the Tauri adapter boundary, and the
  Markdown-only slash-command boundary.
- `check:structure` enforces per-tree file/folder naming and dependency
  invariants (including the SheetJS/`xlsx` ban — the exceljs codec owns every
  spreadsheet path).
- `check:naming` holds the identifier-casing contract over `src/` (variables
  camelCase/UPPER_CASE/PascalCase with leading-underscore discards and dunder
  build globals exempt; type-likes PascalCase; no I-prefixed interfaces) —
  the former typescript-eslint `naming-convention` rule, which oxlint does not
  implement.
- `check:ipc` keeps TypeScript invocations and registered Rust handlers aligned,
  and requires multi-segment snake_case command names.
- `check:hex` bans raw color literals (hex and `rgb()`/`hsl()` functional forms)
  everywhere under `src/` outside the token-definition layer (`src/brand/`,
  `src/styles/themes.css`; `base.css` may hold functional state tokens).
- `check:design-system` proves the four themes define every semantic token, that
  product CSS consumes semantic roles rather than literal or fixed-palette
  colors, that first-party CSS contains no glow/shadow/filter/backdrop effects,
  and that class selectors stay kebab-case (BEM `--modifier` allowed).
- `check:parity` guards the TS↔Rust shared-constant fixture harness itself.
- `check:security` is the egress/CSP/keychain/capability tripwire layer
  ([`security.md`](security.md)).
- `check:docs` keeps the AI-context files, CARL wiring, doc links, this command
  map, and the no-orphan-tooling rule (every `scripts/*.mjs`/`.sh` is invoked by
  a package script, sibling script, or workflow; every `check:*` script actually
  runs in some chain) all honest.
- `check:secret-parity` extracts the secret-pattern lists from `src/ai/guard.ts`
  and `src-tauri/src/secret.rs` and fails the moment the hand-synced mirror
  drifts.
- `check:breve-contract` keeps scheduler ownership, parent death, job locks,
  delivery claims, producer locks, and alert idempotency wired end to end.

When a review identifies a repeatable architectural rule, extend the appropriate
checker. Do not add a convention that only exists in prose.

## CI lanes

The `Regression suite` runs four jobs in parallel on explicitly versioned
GitHub-hosted images. Setup, security, and release integration are documented in
[`ci-runner.md`](ci-runner.md). CI receives no signing keys; `release.sh` signs
and notarizes locally. Bun comes from `.bun-version`; Rustup resolves
`rust-toolchain.toml`, so local, CI, and release builds share the same toolchain
inputs.

- **Quality and production builds (`ubuntu-24.04`):** frozen root install,
  `bun run check`, the Vite production build, and a frozen Astro site build.
- **Browser E2E (`ubuntu-24.04`):** `bun run check:e2e-types` plus the Playwright
  Chromium suite against `vite dev`'s seeded demo corpus.
- **Dependency audit (`ubuntu-24.04`, advisory):** the repository-owned
  `bun run deps audit` scans the app, site, and independently installed Breve
  lockfiles, followed by RustSec. Findings remain visible in the job log while
  the documented transitive-only debt is accepted. Installing the pinned
  scanner is blocking; only its findings are advisory.
- **Native Rust (`macos-15`):** `cargo clippy --all-targets -- -D warnings` and
  `cargo test` against the shipped macOS branches.

`release.sh --publish` requires a successful Regression **conclusion** for the
exact release commit. Missing, pending, and red evidence block; the explicit
`ROTLI_RELEASE_ALLOW_RED=1` emergency escape applies only to a completed red
result. See [`ci-runner.md`](ci-runner.md#how-releases-use-ci).

CI does not prove native visual quality or real external delivery. Handoffs must
state those remaining checks explicitly.
