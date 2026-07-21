# Rotli AI guide

Canonical repository instructions for AI-assisted work. Human contributors use
`CONTRIBUTING.md`; `docs/README.md` routes deeper reading.

## Start

1. Read `README.md`, this file, and the relevant contract from `docs/README.md`.
2. If project CARL tools are available, call `carl_recall` with the task topic
   before broad code or documentation scans. Otherwise inspect only the matching
   domain in `.carl/carl.json`.
3. Inspect implementation, focused tests, and `git status --short`. Preserve all
   unrelated work.

Current code and owning contracts outrank CARL summaries. `docs/archive/`, old
changelog entries, generated output, and Carl sessions are historical/runtime
material—not current specifications.

## Product laws

- Rotli is local-first. User files are durable truth; `.rotli/` contains
  rebuildable projections and explicit settings.
- One notes folder is one memex. Main is a reference view, never another store.
  Do not add a database for memex content.
- Markdown is Rotli's primary knowledge surface and alone owns slash commands,
  wikilinks, embed fences, frontmatter, and note-native workflows. DOCX, sheets,
  Excalidraw boards, and assets are secondary bonus work surfaces that keep
  conventional formats behind adapters; they are not parallel note systems.
- Rotli is a workspace, not a preview catalog. Images and video are the only
  preview-only file surfaces. Every other format presented as supported must be
  editable in Rotli; otherwise offer an explicit local conversion/import path
  and describe the format as unsupported until that workflow exists.
- The memex owns portable knowledge structure, metadata, prompts, protocols, and
  capability maps—not provider calls or agent orchestration.
- Secure notes fail closed. Remote models never receive secure content; local
  access requires explicit permission. Preserve independent TypeScript and Rust
  enforcement.
- Breve is a Rotli capability. Rotli owns its UI, runtime, configuration,
  lifecycle, and scheduler integration.
- Environments: Warm Light, Warm Dark, Paper, and Charcoal. Paper/Charcoal are
  the calm defaults; the warm pair is intentional.

## Architecture, design, and syntax

Follow `ARCHITECTURE.md`, `DESIGN.md`, and `SYNTAX.md`. Dependencies point
`domain -> application -> adapters -> composition -> presentation`. Domain is
pure; application uses narrow ports; effects and vendors stay in adapters;
composition chooses adapters; presentation sends intent. Define policy once.
Mechanical guards include `check:architecture`, `check:ipc`, `check:structure`,
and `check:design-system`.

## Safety

- Never mutate a live memex, installed app, scheduler, daemon, Keychain, launch
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

Use focused commands while iterating: `bun test <file>`, `bun run test:breve`,
and the relevant `check:*` script.

UI work must follow `DESIGN.md`, use semantic tokens from `src/brand/`, remain
keyboard-safe and readable in all four environments, and cover loading, empty, error, saved,
disabled, destructive, and narrow-window states. Do not add a UI framework or
raw colors outside the brand layer.

Browser mode does not prove native titlebar, menu-bar, filesystem, Keychain,
updater, or scheduler behavior. Report exact checks, remaining warnings, human
visual work, and whether anything was committed, published, installed, or
restarted.

## Documentation ownership

- `README.md` / `CONTRIBUTING.md`: public setup and human workflow
- `AGENTS.md`: always-loaded AI rules
- `ARCHITECTURE.md` / `DESIGN.md` / `SYNTAX.md`: project-level contracts
- `.carl/carl.json`: compact topic recall and decisions
- `docs/README.md`: current contract map
- `docs/architecture/`: code-facing contracts and dated audits
- `breve-runtime/README.md`: managed runtime boundary
- `src/brand/README.md`: brand implementation
- `docs/archive/`: historical context only

Tool adapters should point here, not copy policy. Carl should route an agent to
the smallest relevant contract rather than becoming another large manual.
