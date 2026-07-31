#!/bin/bash
# Breve lunchtime brief — fired by launchd (its breve-lunch job) at 12:30 local.
# Delivers a mid-day "Pivot" to Signal only (no email, no audio by default).
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

PROMPT="Read the Breve instructions at $SKILL and generate today's LUNCHTIME brief. Output file: $BREVE/briefs/${TODAY}-lunch.md

Structure (use exactly these section headers):
## Delta Check
What moved since this morning's brief (${TODAY}.md). New developments on any story already covered, numbers that changed, follow-ups. If nothing significant changed, say so in one line — do not pad.

## Macro Scout
1-2 big-picture shifts: major funding rounds, policy moves, infrastructure announcements, or market signals in your watchlist domains. Prioritise what's 'coming' and 'shifting' over what already happened.

## Tooling Tease
1 item: something interesting shipping, a new open-source repo worth starring, or a notable UX pattern from another product. Concrete and specific — no vague trend summaries.

## Rabbit Hole Hooks
1-2 headlines or threads that deserve a deeper read tonight. Just the hook + link. No summary needed — the pull of the headline is the point.

Length: 300-500 words total. Quality bar: only items that pass 'you would stop eating for this.' No filler.
Source constraint: do not repeat items already in today's morning brief verbatim — surface what's new or evolved since 08:00. Research the web for the delta; read the morning brief first.
Output ONLY the markdown file (${TODAY}-lunch.md) — Breve renders the readable HTML + PDF from it and the wrapper handles audio/email/Signal. Do NOT write HTML, PDF, or send anything.
HARD RULE: everything except $BREVE and your memex is strictly read-only — never edit, commit, or push. Flag needed changes in the brief instead."

# Optional per-routine extra instructions from the user (Rotli Routines UI).
if [ -n "${ROTLI_ROUTINE_PROMPT:-}" ]; then
  PROMPT="$PROMPT

Additional instructions from the user (follow them; they refine, never replace, the structure above): $ROTLI_ROUTINE_PROMPT"
fi

if [ "$1" = "--test" ]; then
  PROMPT="Confirm the Breve lunch plumbing works: print the current date and time, confirm you can read $BREVE/briefs/${TODAY}.md (print its first heading or say 'morning brief not found'), and stop. Do not generate a brief."
fi

# Self-heal (#18): if the configured model produces no brief, retry on a fallback, then relay.
run_model() { caffeinate -i $SANDBOX claude -p --model "$1" --dangerously-skip-permissions "$PROMPT"; }
brief_exists() { [ "$1" = "--test" ] || [ -f "$BREVE/briefs/${TODAY}-lunch.md" ]; }

{
  echo "=== Breve lunch run: $(date) ==="
  # Ensure the sandbox profile exists before run_model is used.
  bun "$BREVE/scripts/sandbox.ts" --print >/dev/null 2>&1 || true
  [ "$BREVE_SANDBOX" != "0" ] && [ -f "$SB" ] && SANDBOX="/usr/bin/sandbox-exec -f $SB"
  # Optional read-only gh token (empty = gh uses default auth).
  export GH_TOKEN="$(bun "$BREVE/scripts/secret.ts" get breve-gh-readonly 2>/dev/null || true)"
  run_model "$BREVE_MODEL"
  echo "=== claude ($BREVE_MODEL) exit $? at $(date) ==="

  if ! brief_exists "$1"; then
    FALLBACK="haiku"; [ "$BREVE_MODEL" = "haiku" ] && FALLBACK="sonnet"
    echo "=== $BREVE_MODEL produced no lunch brief — self-heal: retry on $FALLBACK ==="
    run_model "$FALLBACK"
    echo "=== claude ($FALLBACK) exit $? at $(date) ==="
    if brief_exists "$1"; then
      bun "$BREVE/scripts/notify.ts" --idempotency-key "lunch-model-fallback-$TODAY" \
        "⚠ Your brief model ($BREVE_MODEL) was unavailable at lunch, so I generated the Pivot with $FALLBACK instead. On its way." || true
    else
      bun "$BREVE/scripts/notify.ts" --idempotency-key "lunch-generation-failure-$TODAY" \
        "⚠ Couldn't generate your lunch Pivot — both $BREVE_MODEL and $FALLBACK look unavailable (Claude sub may be down). Reply \"brief\" to retry, or check the Mac." || true
      echo "=== self-heal exhausted: notified the owner ==="
    fi
  fi

  if [ "$1" != "--test" ]; then
    STEM="${TODAY}-lunch"
    if [ -f "$BREVE/briefs/$STEM.md" ]; then
      # Breve renders the readable newsletter HTML + PDF from the markdown; then voice → Signal, PDF → email.
      bun "$BREVE/scripts/render-brief.ts" "$STEM" || echo "render-brief failed"
      caffeinate -i bun "$BREVE/scripts/audio-brief.ts" "$STEM" || echo "audio failed"
      [[ "$LANES" == *,signal,* ]] && { bun "$BREVE/scripts/send-signal-brief.ts" "$STEM" || echo "signal send failed"; }
      [[ "$LANES" == *,email,* ]] && [ -f "$STORE/brevePDFs/$STEM.pdf" ] && { bun "$BREVE/scripts/send-brief.ts" "$STEM" || echo "email failed"; }
    else
      echo "no $STEM.md — skipping delivery"
    fi
  fi
  echo "=== done at $(date) ==="
} >> "$LOG" 2>&1
