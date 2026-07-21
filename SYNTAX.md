# Rotli syntax and naming contract

This file defines the repository's naming and style conventions. Mechanical
rules belong in the formatter, linter, or a `check:*` script; prose explains the
intent and the few measured exceptions.

## Files and folders

| Tree | Files | Folders |
|---|---|---|
| `src/` | camelCase TypeScript/TSX stems | camelCase |
| `scripts/`, `e2e/`, `docs/`, `breve-runtime/` | kebab-case | kebab-case |
| `src-tauri/src/` | snake_case Rust module files | snake_case |

Conventional host files such as `README.md` and generated declarations may be
explicitly exempted by the owning check. New exemptions require a reason in the
same change.

## TypeScript and React

- Variables, functions, properties, parameters, and hooks use `camelCase`.
- React components, classes, types, interfaces, and enums use `PascalCase`.
- Hooks start with `use`; boolean values read as facts such as `isOpen`,
  `hasFocus`, or `canSave`.
- Stable module constants may use `UPPER_SNAKE_CASE`; local immutable values stay
  `camelCase`.
- Do not prefix interfaces with `I`. Prefer names that describe the role or
  capability.
- Test suites use `test(...)`, not the `it(...)` alias. Test names state the
  observable invariant and expected refusal or recovery behavior.
- Prefer narrow types, discriminated unions, and explicit ports over `any`,
  unchecked casts, or provider-shaped state leaking inward.

Source filenames stay camelCase even when exporting a PascalCase React
component. One module should have one clear responsibility; use an `index.ts`
only when it creates an intentional public boundary rather than hiding a web of
imports.

## Rust and IPC

- Rust modules, functions, variables, and files use `snake_case`; structs,
  traits, and enums use `PascalCase`; constants use `UPPER_SNAKE_CASE`.
- Tauri command names are multi-segment `snake_case` and must match the
  registered Rust handler.
- TypeScript payload objects remain `camelCase` at the application edge; the
  adapter owns any wire translation.
- `cargo clippy --all-targets -- -D warnings` is the Rust style gate. `rustfmt`
  is deliberately not adopted because its measured repository-wide churn would
  obscure behavioral diffs.

## CSS and design tokens

- Class selectors use kebab-case; BEM-style `--modifier` suffixes are allowed.
- Consume semantic tokens from `src/brand/`. Raw hex, `rgb()`, and `hsl()` values
  are restricted to the token-definition layer.
- Name classes for the component or state they represent, not their current
  color or screen coordinates.

## Formatting and checks

Prettier is authoritative for TypeScript/TSX under `src/`, E2E TypeScript, and
`playwright.config.ts`, with a 110-column target. TypeScript strict checking and
ESLint enforce semantic and naming rules. `check:structure` enforces per-tree
file and folder naming; `check:design-system`, `check:hex`, and `check:ipc`
enforce CSS and command conventions.

Run the smallest formatter/type/test check while editing, then the full proof
chain from [`docs/development/testing.md`](docs/development/testing.md).

