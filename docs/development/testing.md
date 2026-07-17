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
- **Native/live:** a separate, explicitly authorized check for titlebars,
  filesystem permissions, Keychain, updater, scheduler, and real delivery. It
  supplements automated coverage and is never silently treated as CI evidence.

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
- **Full regression (macOS):** Bun behavior tests, Breve runtime checks, Rust
  tests, and the production build.

CI does not prove native visual quality or real external delivery. Handoffs must
state those remaining checks explicitly.
