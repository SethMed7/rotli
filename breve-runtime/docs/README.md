# Breve docs

Internal design notes — the *why* behind Breve. For standing it up, use the hands-on
[`../setup/`](../setup/00-overview.md) guides instead; for the project overview, the top-level
[`../README.md`](../README.md).

| Doc | What it covers |
|-----|----------------|
| [routing.md](routing.md) | Signal chat model routing — the 3-pass funnel (heuristics → Gemma self-judge → escalate) + tier-force prefixes |
| [provider-fallback.md](provider-fallback.md) | How a brief still ships when Claude is down — the `claude → claude-fallback → gemini → codex` chain + per-provider sandboxing |
| [self-healing.md](self-healing.md) | The doctor watchdog — observe → diagnose → heal/propose; plumbing heals silently, output is proposed |
| [memex-boundary.md](memex-boundary.md) | Why Breve mirrors (never imports) the vault's legacy-named portable contract — the path-resolved boundary |
| [email-policy.md](email-policy.md) | Read-only-by-construction email policy + prompt-injection posture *(kept local/gitignored)* |
| [theme.md](theme.md) | Rotli-managed PDF presets, custom colors, and rendering rules |

**Doc-freshness rule:** when you change code that one of these describes, update the doc in the same
commit (the pre-commit hook nudges you; see the repo `CHANGELOG.md`).
