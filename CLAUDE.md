# Claude Code instructions

Read and follow [`AGENTS.md`](AGENTS.md). Project CARL automatically recalls
matching domains; use `carl_recall` before broad documentation or code scans and
open only the returned source contracts. Use [`docs/README.md`](docs/README.md)
as the fallback map. Do not duplicate repository policy in this file.

[`AGENTS.md`](AGENTS.md) is shared with Codex, which enters through
`.codex/config.toml` and — having no hook — must call `carl_recall` itself. Rules
that serve any agent belong there, not here.
