# Testing and regression contract

Rotli treats tests and mechanical checks as executable architecture. A change is
not complete when it merely compiles: the behavior, failure state, dependency
direction, runtime wiring, and owning documentation must agree.

## Command map

| Command | Purpose |
|---|---|
| `bun run lint` | TypeScript plus code-shape, brand, architecture, IPC, structure, and documentation guards |
| `bun run test:unit` | Frontend domain, application, adapter, and state tests under `src/` |
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
| `NODE_OPTIONS=--max-old-space-size=4096 bun run build` | Production bundling and final TypeScript/runtime validation |

Use the smallest focused command while iterating, then run the three required
handoff commands from `AGENTS.md`. Never point an automated test at a live memex,
Keychain, scheduler, daemon, or production delivery account.

## Evidence by layer

- **Domain:** pure policy tests with tables of valid, invalid, boundary, and
  recovery inputs. No React, Tauri, filesystem, network, or provider process.
- **Application:** use-case tests with injected ports and in-memory fakes. Cover
  ordering, refusal, retry, and partial-failure behavior.
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

The four specs are the pointer-drag regression-layer handoff from
`docs/architecture/code-audit.md` ("Regression-layer handoff"): tab reorder
(the CMP-1 visual-index contract, `src/state/panes.test.ts`'s real-gesture
twin), the sidebar's own cross-section-into-Main drag, Board (Captures) card
reorder, and the shared `src/lib/mainAddDrag.ts` module's Main-add drag from
an All-notes row — two different code paths land a note in Main, so both are
covered separately.

## Regression rules

1. Reproduce a bug with a failing test or deterministic checker before relying
   on a manual confirmation.
2. Put policy in a pure module and test it there; test the adapter and composition
   only for translation and wiring.
3. Concurrency regressions must exercise separate OS processes when process
   ownership is the behavior under test. Mocked PIDs alone are insufficient.
4. External delivery tests stop at the claim/receipt boundary. CI never sends
   Signal messages, email, model requests, or watcher traffic.
5. A delivery claim is acquired before an external send and becomes a durable
   receipt only after success. Tests cover contention, completed delivery, stale
   owner recovery, and retry behavior.
6. Every fixed incident updates its owning contract and, when user-visible, the
   changelog. Test names describe the invariant that must not regress.

## Mechanical code checks

- `check:code-shape` rejects production import cycles, focused or skipped tests,
  production imports of test code, and hidden `@ts-ignore`/`@ts-nocheck` errors.
- `check:architecture` discovers clean feature roles and enforces inward role
  dependencies, pure ports/policies, the Tauri adapter boundary, and the
  Markdown-only slash-command boundary.
- `check:structure` enforces filename and dependency invariants (including the
  SheetJS/`xlsx` ban — the exceljs codec owns every spreadsheet path).
- `check:ipc` keeps TypeScript invocations and registered Rust handlers aligned.
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
- **Full regression (macOS):** Bun behavior tests, Breve runtime checks, Rust
  tests, and the production build.

CI does not prove native visual quality or real external delivery. Handoffs must
state those remaining checks explicitly.
