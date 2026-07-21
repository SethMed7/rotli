# Testing and regression contract

Rotli treats tests and mechanical checks as executable architecture. A change is
not complete when it merely compiles: the behavior, failure state, dependency
direction, runtime wiring, and owning documentation must agree.

## Command map

| Command | Purpose |
|---|---|
| `bun run lint` | TypeScript plus code-shape, brand, architecture, IPC, structure, and documentation guards |
| `bun run test:unit` | Frontend domain, application, adapter, and state tests under `src/` |
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
| `bun run dev` / `bun run preview` | Vite dev server against the seeded demo corpus / preview of the built bundle |
| `bun run tauri dev` | The native desktop app (`bun run tauri` is the Tauri CLI passthrough) |
| `bun run format` / `bun run format:check` | Prettier write / verify (`format:check` rides the `lint` chain) |
| `bun run lint:eslint` | The ESLint layer alone (`src`, `e2e`, `playwright.config.ts`) — part of `lint` |
| `bun run check:dup` | Advisory duplication miner over `scripts/dup-judgments.json` — run on demand, deliberately not a gate |
| `bun run build:mac` | Local signed `.app` bundle (predmg clean + `tauri build`) |
| `bun run release` | `scripts/release.sh` — gate, sign, notarize, staple, publish; only under an explicitly authorized release |

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
covered separately. The Main creation-context spec then proves that opening a
Main reference and pressing Command-T creates a new tab and an immediate Main
reference while storage remains in the intake lane.

## Change proof matrix

| Change | Evidence required before the full gate |
|---|---|
| Bug fix | A failing reproduction first, then a focused invariant test that fails if the bug returns |
| Feature | Happy path, refusal/failure state, and meaningful boundary cases at the lowest useful layer |
| AI/model behavior | Focused unit coverage plus a deterministic case in `test:evals`; no live-provider dependency |
| Cross-surface gesture or keyboard flow | Focused policy tests plus Playwright when component-local tests cannot prove real wiring |
| Architecture, syntax, security, or documentation law | A deterministic checker and a checker fixture proving the forbidden case is rejected |

Run Prettier and the smallest type/test/check target while editing. Before
handoff, `bun run check` reruns TypeScript, `format:check`, ESLint, every
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
- `check:architecture` discovers clean feature roles and enforces inward role
  dependencies, pure ports/policies, the Tauri adapter boundary, and the
  Markdown-only slash-command boundary.
- `check:structure` enforces per-tree file/folder naming and dependency
  invariants (including the SheetJS/`xlsx` ban — the exceljs codec owns every
  spreadsheet path).
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

- **Static contracts (Linux):** types and all lint/architecture/documentation
  checks, reported independently for fast diagnosis.
- **Focused design system (Linux):** semantic colors and four-environment theme
  regressions.
- **Browser E2E (Linux):** `bun run check:e2e-types` plus the Playwright suite
  (chromium) against `vite dev`'s seeded demo corpus.
- **Dependency audit (Linux, advisory):** `bun audit` plus RustSec. Findings stay
  visible without failing the workflow while the tracked transitive-only debt
  remains; the Rust action receives the narrow `checks: write` permission it
  needs to publish its report.
- **Full regression (macOS):** Bun behavior tests, deterministic AI evals,
  Breve runtime checks, Rust tests, and the production build.

CI does not prove native visual quality or real external delivery. Handoffs must
state those remaining checks explicitly.
