# Tech stack

The inventory of languages, frameworks, libraries, and tools Rotli is built
with, and where each one lives. This document answers "what is it built
with"; it does not own placement rules or architecture. Placement is
[`../development/adding-things.md`](../development/adding-things.md), system
shape is [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md), and the reason
Rotli stays on Tauri is
[`../design/shell-runtime-decision.md`](../design/shell-runtime-decision.md).
Versions below are the ranges declared in `package.json`,
`src-tauri/Cargo.toml`, and `rust-toolchain.toml` at the time of writing;
those manifests are the executable truth when they drift.

## Shell and host

| Layer | Choice | Where |
|---|---|---|
| Desktop shell | Tauri 2 (tray icon, global shortcut, deep link, dialog, updater, clipboard plugins) | `src-tauri/` |
| Host language | Rust, toolchain 1.97.1 with clippy, `warnings = deny` | `src-tauri/src/` |
| macOS bindings | objc2, objc2-app-kit, objc2-foundation, block2, security-framework (Keychain) | `src-tauri/src/keychain.rs`, `native_drag*.rs`, `pasteboard.rs` |
| Full-text index | tantivy (derived, rebuildable, never a database) | `src-tauri/src/search_index.rs` |
| File watching and safe writes | notify, tempfile (atomic rename), trash (delete = OS trash) | `src-tauri/src/corpus.rs`, `fsutil.rs` |
| Serialization and text | serde, serde_json, regex, base64, time, ulid, uuid, sha2 | across `src-tauri/src/` |
| Local HTTP from Rust | ureq (on-device model calls the webview CSP blocks) | `src-tauri/src/chat.rs`, `localmodel.rs` |
| PDF text extraction | pdf-extract, wrapped in `catch_unwind` | `src-tauri/src/document_conversion.rs` |
| Second binary | `rotli-helper`, the loopback bridge Rotli Web pairs with: it serves the one vault folder the user chose to browsers without a folder API, and runs chat through the user's AI tools ([`web-vault-connection.md`](web-vault-connection.md)) | `src-tauri/src/bin/rotli_helper.rs`, `helper_vault.rs` |

The same crate also exposes the headless workspace service behind the CLI and
MCP adapters (`src-tauri/src/workspace.rs`).

## Frontend

| Layer | Choice | Where |
|---|---|---|
| Language | TypeScript 7 (strict), target ES2020, `react-jsx`; TypeScript 6 runs as an independent second typecheck | `tsconfig*.json` |
| UI library | React 19 with react-dom. React Compiler is lint-only, not in the production transform | `src/` |
| Bundler | Vite 8 (Rolldown, oxc minifier) with `@vitejs/plugin-react` 6, Babel-free | `vite.config.ts` |
| Client state | Zustand 5 stores | `src/state/` |
| Async data | TanStack React Query 5 | `src/` |
| Styling | Plain CSS per surface on semantic tokens. No Tailwind, no CSS-in-JS, no UI component library | `src/styles/`, tokens in `src/brand/tokens/` |
| Typography | Satoshi, General Sans, Baloo 2 embedded as local fonts | `src/brand/fonts/` |
| Themes | Seven families, each tuned light and dark, as CSS custom properties | `src/styles/themes.css` |

Brand implementation detail is [`../../src/brand/README.md`](../../src/brand/README.md).
Interaction and visual law is [`../../DESIGN.md`](../../DESIGN.md).

## Editors and work surfaces

| Surface | Vendor | Adapter |
|---|---|---|
| Markdown and code editing | CodeMirror 6 with lang packs (JS/TS, HTML, CSS, JSON, YAML, Python, Rust, Go, Java, C++, PHP, SQL, legacy modes) | `src/editor/` |
| Boards | Excalidraw 0.18 plus mermaid-to-excalidraw | `src/boards/` |
| DOCX and sheets | Univer presets (docs core, docs drawing, sheets core) | `src/documents/`, `src/sheets/` |
| Spreadsheet and archive I/O | exceljs, jszip | `src/documents/codec/`, `src/sheets/engine/` |
| Math, diagrams, graphs | KaTeX, Mermaid 11, JSXGraph | `src/editor/`, render layer |
| Syntax trees and highlighting | Lezer common and highlight | `src/editor/` |

Every vendor enters through one adapter listed in `vendorSeams`
(`scripts/check-architecture.mjs`). The denylist in
`scripts/check-structure.mjs` refuses database engines and SheetJS.

## On-device AI and voice

| Capability | Choice | Where |
|---|---|---|
| Embeddings and local inference for Breve | Hugging Face Transformers.js 3 (declared at the root for range parity) | `breve-runtime/scripts/` |
| Text to speech | kokoro-js | `src/voice/`, `breve-runtime/scripts/` |
| Chat, retrieval, and prompt policy in the app | TypeScript over Rust-hosted providers, offline evals in `bun run test:evals` | `src/ai/`, `src/chatMemory/`, `src/noteChat/` |
| Local model host and provider lanes | Rust (`localmodel.rs`, `provider.rs`, `provider_lane.rs`) | `src-tauri/src/` |
| Mail intake for Breve | imapflow | `breve-runtime/scripts/` |

What each model class may see is
[`../design/ai-visibility-matrix.md`](../design/ai-visibility-matrix.md).

## Runtimes and services

| Piece | Stack | Where |
|---|---|---|
| Package manager, script runner, unit tests | Bun 1.4 | `package.json`, `bunfig.toml` |
| Breve runtime | Bun scripts plus bash entry points, own `package.json` mirroring the app's ranges | `breve-runtime/` |
| MCP relay (opt-in cloud) | Bun server in a Docker image | `services/rotli-mcp-relay/` |
| Project CARL server | Node-compatible MCP server over `.carl/carl.json` | `.carl/mcpServer.mjs` |
| Marketing site | Astro 7 with the sitemap integration, served by Caddy from a Docker image | `site/` |

## Quality tooling

| Concern | Tool | Command |
|---|---|---|
| Lint | oxlint with tsgolint | `bun run lint:oxlint` |
| Format | oxfmt | `bun run format` |
| Dead code and undeclared deps | knip | `bun run check:knip` |
| Unit tests | bun test | `bun run test:unit` |
| End-to-end | Playwright 1.62, one desktop-webview config and one Rotli Web config | `bun run test:e2e`, `bun run test:e2e:web` |
| Rust | cargo clippy and cargo test | via `bun run verify` |
| Repository law | About twenty `scripts/check-*.mjs` guards: architecture, IPC, naming, hex, structure, security, parity, docs, duplication, ratchets, window events | `bun run lint` |
| Image tooling | sharp (icons, social card, character fills) | `scripts/` |

The full command map and CI twin is
[`../development/testing.md`](../development/testing.md). CI runs the
`Regression suite` workflow (`.github/workflows/regression.yml`) with a
cross-platform build and a helper release workflow beside it.

## Not used, on purpose

- No CSS framework, CSS-in-JS, or component kit. Tokens and hand-written CSS
  only (`bun run check:hex`, `bun run check:design-system`).
- No database. Markdown files are truth; `.rotli/` and the tantivy index are
  rebuildable projections
  ([`memex-data-contract.md`](memex-data-contract.md)).
- No Babel and no esbuild in the build. Vite 8's oxc and Rolldown cover both.
- No Electron. The shell decision and its idle-cost measurements are in
  [`../design/shell-runtime-decision.md`](../design/shell-runtime-decision.md).
