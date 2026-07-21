# AI context architecture

Rotli gives AI tools enough context to work safely without loading the whole
project into every prompt. Context is progressive: stable laws are cheap and
automatic; detail is retrieved only when the task needs it.

## Context ladder

| Layer | Content | Loading policy |
|---|---|---|
| L0 | `AGENTS.md` plus a tiny tool adapter | Always loaded by the coding tool |
| L1 | Matching project CARL domain | Claude hook matches recall phrases; no Rotli domain is always-on |
| L2 | `carl_recall` result | Agent asks for at most two domains and four rules by default |
| L3 | One owning project or architecture contract | Open only sources returned by CARL or `docs/README.md` |
| L4 | Relevant implementation and focused tests | Search by capability; avoid repository-wide reads |

`AGENTS.md` contains only durable product laws, safety, dependency direction,
and proof requirements. CARL contains compact facts and decisions grouped by
capability. Architecture documents explain the contract. Code and tests prove
the current behavior.

## Project-scoped CARL

`.carl/carl.json` is tracked and belongs only to Rotli. Domains are topic-sized:

- `ROTLI_CORE`: dependency direction, Main, and documentation ownership
- `ROTLI_MEMEX`: write lanes, metadata, organizer, and secure notes
- `ROTLI_MEMORY`: RAG, Model Mapping 0, chat summaries, and findability
- `ROTLI_DOCUMENTS`: DOCX, sheets, boards, slash commands, and embeds
- `ROTLI_EDITOR`: CodeMirror, live preview, Markdown widgets, and editor seams
- `ROTLI_KEYS`: actions, keybindings, chords, and keyboard discoverability
- `ROTLI_BREVE`: integrated runtime and dev/production isolation
- `ROTLI_DESIGN`: brand, themes, accessibility, and state design
- `ROTLI_MODELS`: provider boundaries and capability policy
- `ROTLI_OPERATIONS`: release, daemon, Keychain, and process safety

All domains are `always_on: false`. Claude's installed CARL hook walks upward
from the working directory, finds this project file, and injects only domains
whose recall phrases match the prompt. The hook may merge a separate user-level
Carl scope, but project domain names are Rotli-specific and cannot be confused
with unrelated projects.

## Shared MCP access

The dependency-free `.carl/mcpServer.mjs` exposes five project tools:

- `carl_recall`: bounded topic retrieval; the normal entry point
- `carl_list_domains`: compact discovery without rule bodies
- `carl_get_domain`: explicit full-domain fallback
- `carl_search_decisions`: decision lookup without loading every rule
- `carl_stage_proposal`: reviewable, inactive rule proposals

Claude reads the tracked `.mcp.json`. Codex reads the trusted project
`.codex/config.toml`; its configuration exposes only the four read-only tools.
The server resolves `carl.json` from its own repository location, so it cannot
accidentally read the home-level Carl file. It has no network access, provider
credentials, or application dependency.

Claude requires a one-time approval for the shared project MCP server; verify
with `claude mcp get rotli-carl` and approve it when the next Claude session
prompts. Codex loads project MCP configuration only for a trusted repository;
verify with `codex mcp list` and look for enabled `rotli_carl`.

Codex also reads `AGENTS.md` automatically and supports project-scoped MCP
servers through `.codex/config.toml`. Claude and Codex both require a new
session after changing project instructions or MCP configuration.

## Token and drift budgets

- `AGENTS.md` stays below 5 KiB.
- No project CARL domain is always-on.
- A rule is at most 600 characters; a decision rationale at most 400.
- `carl_recall` returns at most two domains/four rules by default and reports the
  owning source contracts.
- Carl summaries never duplicate full implementation guides.
- Tool-specific adapters point to the canonical files instead of copying them.

`bun run check:docs` enforces these limits, validates source links and project
MCP wiring, parses both configuration formats, and performs an MCP initialize,
tool-list, and recall smoke test.

## Updating context safely

1. Change code and its owning architecture contract together.
2. Update an existing CARL rule only when a durable fact or decision changed.
3. Add a new domain only when its recall vocabulary and contract ownership are
   genuinely distinct.
4. Stage uncertain rules with `carl_stage_proposal`; do not activate guesses.
5. Keep histories, investigations, and implementation detail out of CARL.

The intended result is replaceable tooling: Claude, Codex, or another MCP-aware
agent can retrieve the same compact project memory, while tools without MCP can
still follow `AGENTS.md` and the documentation map.
