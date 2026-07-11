# Breve — Self-Healing & Recommendations

*Design note, 2026-06-11. Principle: Breve is a **true assistant** — it keeps itself
running and brings you ideas, but it does not become a coding agent. The line:
**plumbing heals silently; anything that produces output or changes behavior is
proposed, never assumed.***

## The loop

```
observe → diagnose → { heal (safe) | propose (CONFIRM) } → verify → report
```

Every layer of Breve already emits observations; the doctor closes the loop:

| Signal | Source | Response |
|--------|--------|----------|
| Daemon dead | Rotli supervisor state | heal: restart with bounded backoff; report only if it cannot recover |
| Local model down | `<provider>/api/version` | heal: kickstart its launchd service (chat already falls back to Claude meanwhile) |
| Missed brief (07:00 / 12:00 / 18:00 arrival; fires lead 30 earlier) | expected artifact missing after a grace window | **propose** rerun via the CONFIRM flow — reruns send messages/emails, so a human gates it |
| Errors accruing | `logs/failures.log` growth | report (the transcript shows *what* failed; you decide if it matters) |
| Disk low | `df` | report |

Cadence: Rotli's managed doctor routine every 30 min. **Quiet when healthy** —
the absence of 🩺 messages is the health signal. One proposal at a time, once per
artifact per day: an assistant that nags is worse than one that's occasionally late.

### Why proposals instead of full autonomy
Reruns produce sends (email, Signal drops). Auto-rerunning a "missed" morning brief
that actually half-ran would double-send. The Rule of Two (OWASP, in Issue 002):
an agent with private data + untrusted web content + outbound comms needs a human
in the loop — the CONFIRM reply *is* that human, kept as cheap as one word.

### What self-healing is NOT here
No self-modifying code, no "the model edits its own daemon when it sees an error."
Healing actions are a **fixed, validated menu** (restart services, rerun known
scripts via the action allowlist). If something novel breaks, the doctor's job is a
good diagnosis in your pocket, not a patch. Code changes stay a Mac-session
activity where review is natural.

## Recommendations

Same shape as healing — observe → infer → propose — pointed at usefulness instead of uptime:

1. **Radar** (live): one adjacent company per brief, yes/no by reply. The watchlist
   grows by accretion of cheap decisions, not curation sessions.
2. **Usage-pattern suggestions** (next): the transcripts + logs are an honest record
   of what you actually use. Patterns worth surfacing as one-line proposals:
   - asks that always escalate to Sonnet → "want a scheduled drop for this topic?"
   - a watchlist lens that hasn't produced an item in 2+ weeks → "retire it?"
   - repeated manual asks at a consistent hour → "schedule it?"
   Cadence: weekly, ONE suggestion max, inside the Sunday night brief — never a
   separate nag channel. Yes/no by reply, same as Radar.
3. **Capability offers** (sparingly): when a conversation hits a wall the toolkit
   could fix (like the "I can't send PDFs" failure that led to /brief), the deep
   tier proposes the *setup* via the CONFIRM flow. The assistant extends itself
   only through the gated menu, in response to a real need.

## Invariants (carry into every future change)

- Local-first, free-first: healing and recommending must not add metered calls.
  The doctor is pure Bun + filesystem; pattern inference rides existing brief runs.
- One question at a time; one word answers (yes/no/CONFIRM/cancel).
- Everything observable: doctor writes `logs/doctor.log`, proposals go through the
  same `signal/awaiting-action.json` gate as everything else.
- the memex stays text; your storage stays binaries; runtime stays in `~/.cache`.
