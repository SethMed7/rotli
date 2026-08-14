# Rotli AI guide

Canonical repository instructions for AI-assisted work. Human contributors use
`CONTRIBUTING.md`; `docs/README.md` routes deeper reading.

## Start

1. Read `README.md`, this file, and the relevant contract from `docs/README.md`.
2. Call `carl_recall` with the task topic before broad scans; without it, read
   the matching `.carl/carl.json` domain.
3. Inspect implementation, focused tests, and `git status --short`. Preserve all
   unrelated work.

Current code and owning contracts outrank CARL summaries. `docs/archive/`, old
changelog entries, generated output, and Carl sessions are historical only.

## Product laws

- Rotli is local-first. User files are durable truth; `.rotli/` contains
  rebuildable projections and explicit settings.
- One folder is one vault. Main and named views are reference projections, never
  stores. Rotli's portable metadata layer is not a content store or database.
- Markdown is Rotli's primary knowledge surface and alone owns slash commands,
  wikilinks, embed fences, frontmatter, and note-native workflows. DOCX, sheets,
  Excalidraw boards, and assets are secondary bonus work surfaces that keep
  conventional formats behind adapters; they are not parallel note systems.
- Rotli is a workspace, not a preview catalog. Images and video are the only
  preview-only file surfaces. Every other format presented as supported must be
  editable in Rotli; otherwise offer an explicit local conversion/import path
  and describe the format as unsupported until that workflow exists.
- The vault owns portable structure, metadata, prompts, protocols, and
  capabilities—not provider calls or agent orchestration.
- Secure notes fail closed: remote models never see them; on-device models do
  unless a knob says no. Locked = no AI edits it, every class reads it. TS and
  Rust enforce both independently.
- Breve is a Rotli capability. Rotli owns its UI, runtime, configuration,
  lifecycle, and scheduler integration.
- Environments are Warm Light, Warm Dark, Paper, and Charcoal; all intentional.

## Architecture, design, and syntax

Follow `ARCHITECTURE.md`, `DESIGN.md`, and `SYNTAX.md`. Dependencies point
`domain -> application -> adapters -> composition -> presentation`. Domain is
pure; application uses narrow ports; effects and vendors stay in adapters;
composition chooses adapters; presentation sends intent. Define policy once.
Mechanical guards include `check:architecture`, `check:ipc`, `check:structure`,
and `check:design-system`.

## Safety

- Never mutate a live vault, installed app, scheduler, daemon, Keychain, launch
  agent, or production service without explicit target-specific authorization.
- Do not manage `bun run tauri dev` or another persistent process unless asked.
- Do not commit, push, deploy, publish, or release unless explicitly requested.
- Preserve dirty-worktree changes; never use destructive Git cleanup.
- Never expose credentials, private notes, Keychain values, or production data.

## Work and proof

1. Establish current behavior from code and tests.
2. Implement the smallest complete vertical slice; keep policy centralized.
3. Add focused behavior, failure-state, and boundary tests. Bug fixes start with
   a failing reproduction; model behavior adds deterministic offline evals.
4. Update the owning contract and `CHANGELOG.md` for user-visible changes.
5. Run:

```sh
bun run check
cargo test --manifest-path src-tauri/Cargo.toml
NODE_OPTIONS=--max-old-space-size=4096 bun run build
```

Iterate with focused commands: `bun test <file>` and the relevant `check:*`
script. Substantive changes land via Greptile-reviewed PRs (fixes on-thread);
releases gate on CI conclusion; E2E clicks real controls, never ⌘-chords.

UI work must follow `DESIGN.md`, use semantic tokens from `src/brand/`, remain
keyboard-safe and readable in all four environments, and cover loading, empty, error, saved,
disabled, destructive, and narrow-window states. Do not add a UI framework or
raw colors outside the brand layer.

Browser mode does not prove native titlebar, menu-bar, filesystem, Keychain,
updater, or scheduler behavior. Report exact checks, warnings, human visual
work, and any commit/publish/install/restart.

## Documentation ownership

- `AGENTS.md`: always-loaded rules, canonical for EVERY agent. Entry points:
  `CLAUDE.md` (Claude), `.codex/config.toml` (Codex)
- `.carl/carl.json`: topic recall + decisions. A hook injects it for Claude;
  Codex must call `carl_recall` itself, read-only (`check:docs` asserts both)
- `docs/README.md`: contract map · `docs/architecture/`: contracts and audits
- `ARCHITECTURE.md` / `DESIGN.md` / `SYNTAX.md`: project contracts
- README / CONTRIBUTING / PRODUCT / ROADMAP: public · `docs/archive/`: history
- `breve-runtime/README.md`, `src/brand/README.md`: runtime and brand

CARL routes to the smallest relevant contract; adapters point here, not copy it.
