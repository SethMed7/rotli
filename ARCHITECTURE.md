# Rotli architecture

This is the project-level architecture contract. It defines the system shape,
ownership boundaries, and dependency direction that every change must preserve.
Detailed capability contracts and dated audits are routed from
[`docs/README.md`](docs/README.md).

## Durable truth

- One notes folder is one memex. User-owned files are durable truth.
- Main is a reference projection over those files, never another store.
- `.rotli/` contains rebuildable indexes, projections, journals, and explicit
  settings. It must not become a second content database.
- Markdown is the primary knowledge surface. Conventional secondary formats are
  kept behind adapters and must remain editable or offer an explicit local
  conversion path.

## Dependency direction

Dependencies point inward:

`domain -> application -> adapters -> composition -> presentation`

- **Domain** owns pure policy, invariants, and value types.
- **Application** coordinates use cases through narrow ports.
- **Adapters** translate filesystems, Tauri, codecs, editors, networks, and
  vendor SDKs into those ports.
- **Composition** chooses concrete adapters and wires lifecycle ownership.
- **Presentation** renders state and sends user intent; it does not own policy.

A provider or dependency swap should normally change one adapter, focused tests,
and a composition root. Exceptions must be named and enforced in
[`scripts/check-architecture.mjs`](scripts/check-architecture.mjs), not implied
by directory folklore.

## System map

| Area | Ownership |
|---|---|
| `src/` | React presentation, frontend capability modules, application workflows, and browser/Tauri adapters |
| `src-tauri/src/` | Trusted Rust host: filesystem, security, IPC, process, updater, and scheduler edges |
| `breve-runtime/` | Versioned runtime that Rotli configures, installs, and supervises |
| `src/brand/` | Semantic visual tokens, typography, icons, and embedded brand assets |
| `scripts/` | Deterministic architecture, security, syntax, documentation, build, and release checks |
| `e2e/` | Browser-twin interaction regressions against a deterministic in-memory corpus |
| `docs/` | Detailed current contracts and dated audits; `docs/archive/` is historical only |

## Trust boundaries

- Secure notes fail closed before mapping, retrieval, reads, or provider egress.
  TypeScript and Rust enforce the boundary independently.
- Provider calls and agent orchestration belong to Rotli adapters, never the
  portable memex.
- Browser mode cannot prove native filesystem, Keychain, titlebar, updater,
  scheduler, or process behavior.
- Tests never target a live memex, Keychain, daemon, scheduler, or production
  delivery account.

## Complete change slice

A behavior change is complete only when its policy, workflow, adapter wiring,
presentation state, regression evidence, and owning contract agree. Bug fixes
start with a failing reproduction. Features cover the happy path, a refusal or
failure path, and meaningful boundaries. Model behavior adds deterministic
offline evals. Cross-surface interactions add E2E coverage when a unit test
cannot prove the wiring.

The executable gates are defined in
[`docs/development/testing.md`](docs/development/testing.md). Placement rules are
in [`docs/development/adding-things.md`](docs/development/adding-things.md), and
the naming contract is [`SYNTAX.md`](SYNTAX.md).

