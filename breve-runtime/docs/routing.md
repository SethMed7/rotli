# Breve Signal — smart model routing

*Designed 2026-06-11 from research (lineage in the memex `wiki/research/breve-origins/`). Default = free/private; Claude only when the question needs it.*

## Key finding
Most agent frameworks (e.g. **OpenClaw**) don't do per-message *difficulty* routing — they do **static task-typed routing** (pin model→task) plus a **failure-only fallback chain** (escalate on rate-limit/outage, not on "this is hard"). OpenClaw's own guidance: make **Haiku the primary** (handles ~75% of work), reserve flagship for the ~20% that needs it. So Breve's difficulty router is *beyond* what those ship.

## The 3-pass funnel (in `scripts/signal-daemon.ts` → `smartRoute()`)
1. **Free heuristic gates** (microseconds, no tokens):
   - Live-data words (`latest/current/news/price/who won/as of/recent…`) → **Sonnet+web** (Gemma literally can't know live facts — its biggest failure mode is confidently hallucinating these).
   - Hard work (code fences, `regex/refactor/debug/stack trace`, >6000 chars, ≥3 questions, `compare/analyze/plan/design/architect`) → **Sonnet** (+tools if a repo/URL is mentioned).
2. **Gemma self-judge** (free local pass, local-model structured output): Gemma answers AND returns `{answer, confidence, needs_tools, needs_bigger_model}`. If `confidence=high && !needs_tools && !needs_bigger_model` → **use its free answer, done** (~70-80% of messages).
3. **Escalate by reason**: `needs_tools` → Sonnet+web · else → Haiku.

## Why this shape
- Free path is the default → matches the "don't burn credit" + local-first values.
- Heuristics hard-gate the two cases self-judging is worst at (live-data hallucination, obvious heavy work) — so the calibration risk is contained.
- Self-judge runs only on the ambiguous middle, so double-latency (local + cloud) is rare.
- Haiku is the default paid escalation (~3× cheaper than Sonnet); Sonnet reserved for genuine tool/web need.

## Overrides & transparency
- Force a tier: `p:` / `local:` (private/local Gemma) · `c:` (Haiku) · `deep:` (Sonnet+web) · `img:` (imagegen).
- Every reply is tagged: `·local · free` / `·Claude Haiku` / `·Claude Sonnet+web` — so you see what ran and can correct routing.
- Tunable: the keyword lists + the 6000-char threshold in `smartRoute()`. If Gemma over-escalates or under-answers, adjust there first (no classifier/embeddings — overkill for one user).

## Known risks (watch for)
- Hallucinated confidence: Gemma may confidently answer something wrong and not escalate (false negative), worst on rare/tail questions. Mitigation: heuristics catch live-data; tighten if you spot a pattern.
- Double latency on escalation (local round-trip + Claude). Acceptable; only on the ambiguous middle.
