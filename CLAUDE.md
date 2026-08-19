# Claude Code instructions

@AGENTS.md

The line above imports [`AGENTS.md`](AGENTS.md) — the canonical rules for
every agent (Codex and Copilot load it through their own entry points).
Project CARL injects matching domains via hook; still call `carl_recall`
before broad documentation or code scans and open only the returned source
contracts. Fallback map: [`docs/README.md`](docs/README.md). Do not duplicate
repository policy in this file.
