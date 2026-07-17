#!/bin/bash
# Breve nighttime brief — fired by launchd (its breve-night job) at 21:30 local.
# "The Archive": digs into the day's rabbit holes, sets up tomorrow. Signal text only.
# Requirements: same as morning-brief.sh (Mac awake, user logged in).

export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.bun/bin:$HOME/.claude/local:$PATH"
BREVE="${ROTLI_BREVE_HOME:-$(cd "$(dirname "$0")/.." && pwd)}"
SKILL="${ROTLI_BREVE_SKILL:-$BREVE/skills/breve/SKILL.md}"
LANES=",${ROTLI_BREVE_LANES:-inApp,signal,email},"
# Sandbox the brief's claude call exactly like the daemon tiers (write+read confinement).
SB="$HOME/.cache/breve/breve-write-sandbox.sb"
SANDBOX=""; if [ "$BREVE_SANDBOX" != "0" ] && [ -f "$SB" ]; then SANDBOX="/usr/bin/sandbox-exec -f $SB"; fi
# If the profile is missing, sandbox.ts below generates it from the managed runtime paths.
# Brief model is config-driven (settings.json "briefModel", default sonnet). Never inherit the system default.
BREVE_MODEL="${BREVE_MODEL:-$(bun "$BREVE/scripts/brief-model.ts" 2>/dev/null || echo sonnet)}"
STORE="$(bun "$BREVE/scripts/print-root.ts" storage 2>/dev/null || echo "$HOME/memex-storage")"
LOG_DIR="$BREVE/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/$(date +%F).log"
TODAY=$(bun "$BREVE/scripts/today.ts")

PROMPT="Read the Breve instructions at $SKILL and generate today's NIGHTTIME brief — 'The Archive'. Output file: $BREVE/briefs/${TODAY}-night.md

Read first: today's morning brief ($BREVE/briefs/${TODAY}.md) and lunch brief (${TODAY}-lunch.md, if it exists).

Structure (use exactly these section headers):
## Since Lunch
What moved since midday. One line if quiet — never pad.

## Rabbit Holes, Dug
Take the lunch brief's Rabbit Hole Hooks (or, if no lunch brief, the most intriguing unexplored threads from the morning) and actually dig: 1-2 items, each 150-250 words of real substance — what it is, why it matters to you, what to take from it. This is the deep-dive slot the daytime briefs deliberately defer to.

## Tomorrow Setup
What lands or is due tomorrow: releases, deadlines from the morning's action items, scheduled events. Concrete dates only.

## Long-form Pick
ONE essay, talk, video, or paper worth your evening. Why this one, in two sentences. Include the link.

Length: 400-700 words. Calmer register than the morning — this is wind-down reading, not an alert feed.
Source constraint: do not re-summarize what morning/lunch already said — go deeper or forward, never sideways.
Output ONLY the markdown file (${TODAY}-night.md) — Breve renders the readable HTML + PDF from it and the wrapper handles audio/email/Signal. Do NOT write HTML, PDF, or send anything.
HARD RULE: everything except $BREVE and your memex is strictly read-only — never edit, commit, or push. Flag needed changes in the brief instead."

if [ "$1" = "--test" ]; then
  PROMPT="Confirm the Breve night plumbing works: print the current date and time, confirm you can read $BREVE/briefs/${TODAY}.md (print its first heading or say 'morning brief not found'), and stop. Do not generate a brief."
fi

# Self-heal (#18): if the configured model produces no brief, retry on a fallback, then relay.
run_model() { caffeinate -i $SANDBOX claude -p --model "$1" --dangerously-skip-permissions "$PROMPT"; }
brief_exists() { [ "$1" = "--test" ] || [ -f "$BREVE/briefs/${TODAY}-night.md" ]; }

{
  echo "=== Breve night run: $(date) ==="
  # Ensure the sandbox profile exists before run_model is used.
  bun "$BREVE/scripts/sandbox.ts" --print >/dev/null 2>&1 || true
  [ "$BREVE_SANDBOX" != "0" ] && [ -f "$SB" ] && SANDBOX="/usr/bin/sandbox-exec -f $SB"
  # Optional read-only gh token (empty = gh uses default auth).
  export GH_TOKEN="$(bun "$BREVE/scripts/secret.ts" get breve-gh-readonly 2>/dev/null || true)"
  run_model "$BREVE_MODEL"
  echo "=== claude ($BREVE_MODEL) exit $? at $(date) ==="

  if ! brief_exists "$1"; then
    FALLBACK="haiku"; [ "$BREVE_MODEL" = "haiku" ] && FALLBACK="sonnet"
    echo "=== $BREVE_MODEL produced no night brief — self-heal: retry on $FALLBACK ==="
    run_model "$FALLBACK"
    echo "=== claude ($FALLBACK) exit $? at $(date) ==="
    if brief_exists "$1"; then
      bun "$BREVE/scripts/notify.ts" --idempotency-key "night-model-fallback-$TODAY" \
        "⚠ Your brief model ($BREVE_MODEL) was unavailable tonight, so I generated The Archive with $FALLBACK instead. On its way." || true
    else
      bun "$BREVE/scripts/notify.ts" --idempotency-key "night-generation-failure-$TODAY" \
        "⚠ Couldn't generate your night brief — both $BREVE_MODEL and $FALLBACK look unavailable (Claude sub may be down). Reply \"brief\" to retry, or check the Mac." || true
      echo "=== self-heal exhausted: notified the owner ==="
    fi
  fi

  if [ "$1" != "--test" ]; then
    STEM="${TODAY}-night"
    if [ -f "$BREVE/briefs/$STEM.md" ]; then
      # Breve renders the readable newsletter HTML + PDF from the markdown; then voice → Signal, PDF → email.
      bun "$BREVE/scripts/render-brief.ts" "$STEM" || echo "render-brief failed"
      caffeinate -i bun "$BREVE/scripts/audio-brief.ts" "$STEM" || echo "audio failed"
      [[ "$LANES" == *,signal,* ]] && { bun "$BREVE/scripts/send-signal-brief.ts" "$STEM" || echo "signal send failed"; }
      [[ "$LANES" == *,email,* ]] && [ -f "$STORE/brevePDFs/$STEM.pdf" ] && { bun "$BREVE/scripts/send-brief.ts" "$STEM" || echo "email failed"; }
    else
      echo "no $STEM.md — skipping delivery"
    fi
    # End-of-day: distill the day's record into the memex history/ + prune the local brief cache.
    # Breve holds NO durable knowledge — the memex digest is the record; briefs/ is just a cache.
    bun "$BREVE/scripts/daily-log.ts" || echo "daily-log failed"
  fi
  echo "=== done at $(date) ==="
} >> "$LOG" 2>&1
