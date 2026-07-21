# Rotli documentation map

This directory holds current engineering contracts and historical material.
Code remains the executable truth; when code and a current contract diverge,
fix both in the same change.

## Start here

| Need | Canonical source |
|---|---|
| Public product promise and setup | [`../README.md`](../README.md) |
| Human contribution workflow | [`../CONTRIBUTING.md`](../CONTRIBUTING.md) |
| AI contribution and safety rules | [`../AGENTS.md`](../AGENTS.md) |
| Project-level system architecture | [`../ARCHITECTURE.md`](../ARCHITECTURE.md) |
| Product interface and interaction design | [`../DESIGN.md`](../DESIGN.md) |
| Syntax, naming, and formatting | [`../SYNTAX.md`](../SYNTAX.md) |
| Clean architecture and dependency direction | [`architecture/clean-architecture.md`](architecture/clean-architecture.md) |
| Memex storage, metadata, RAG, and secure notes | [`architecture/memex-data-contract.md`](architecture/memex-data-contract.md) |
| File editing and no-preview-only product law | [`architecture/memex-data-contract.md#editing-capabilities`](architecture/memex-data-contract.md#editing-capabilities) |
| FileSurface capability matrix | [`architecture/file-surface-capability-audit-2026-07-11.md`](architecture/file-surface-capability-audit-2026-07-11.md) |
| Current system-wide findings and priorities | [`architecture/system-audit-2026-07-11.md`](architecture/system-audit-2026-07-11.md) |
| Code organization audit | [`architecture/code-audit.md`](architecture/code-audit.md) |
| Managed Breve runtime | [`../breve-runtime/README.md`](../breve-runtime/README.md) |
| Brand implementation | [`../src/brand/README.md`](../src/brand/README.md) |
| AI-assisted development workflow | [`development/ai-workflow.md`](development/ai-workflow.md) |
| Testing, linting, and regression evidence | [`development/testing.md`](development/testing.md) |
| Egress map, security checks, and the threat model | [`development/security.md`](development/security.md) |
| Where new code, dependencies, and shared constants go | [`development/adding-things.md`](development/adding-things.md) |
| Token-efficient AI context and project CARL | [`architecture/ai-context-architecture.md`](architecture/ai-context-architecture.md) |
| Claude/Codex workspace CLI and MCP | [`architecture/agent-workspace.md`](architecture/agent-workspace.md) |

## Source-of-truth boundaries

- The repository owns code-facing architecture, development, testing, brand,
  and runtime contracts.
- The memex may hold broader product knowledge, research, decision context, and
  model-readable protocols. It does not replace current repository contracts.
- `.carl/carl.json` is a compact, project-scoped recall layer shared through the
  local CARL MCP server. It summarizes stable facts and decisions and links back
  to canonical documentation.
- `CHANGELOG.md` records shipped history. It does not define current behavior.
- `archive/` is read-only historical context. Never implement a rule solely
  because it appears there.

## Keeping documentation healthy

- Put a rule in the document that owns it and link to that rule elsewhere.
- Prefer short tool adapters that point to `AGENTS.md`; do not maintain multiple
  copies of AI instructions.
- Use dated filenames for audits and proposals. Move superseded proposals to
  `archive/` rather than leaving two apparently current specifications.
- Run `bun run check:docs` after changing contributor guidance, themes, commands,
  or source-of-truth boundaries.
