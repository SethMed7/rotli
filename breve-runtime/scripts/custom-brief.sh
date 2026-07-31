#!/bin/bash
# A CUSTOM brief routine (2026-07-31): the user's own scheduled research brief.
# Generic sibling of lunch-brief.sh — the routine's identity and instructions
# arrive via the scheduler's job env (ROTLI_ROUTINE_ID / LABEL / PROMPT / STEM,
# ROTLI_BREVE_LANES). Output: $BREVE/briefs/$STEM.md, then text delivery —
# Signal as flattened text, email PDF-less via send-brief.ts. No audio/PDF in
# v1 (those pipelines are slot-shaped).

export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.bun/bin:$HOME/.claude/local:$PATH"
BREVE="${ROTLI_BREVE_HOME:-$(cd "$(dirname "$0")/.." && pwd)}"
SKILL="${ROTLI_BREVE_SKILL:-$BREVE/skills/breve/SKILL.md}"
LANES=",${ROTLI_BREVE_LANES:-inApp},"
RID="${ROTLI_ROUTINE_ID:?custom-brief needs ROTLI_ROUTINE_ID}"
RLABEL="${ROTLI_ROUTINE_LABEL:-$RID}"
RPROMPT="${ROTLI_ROUTINE_PROMPT:?custom-brief needs ROTLI_ROUTINE_PROMPT}"
STEM="${ROTLI_ROUTINE_STEM:?custom-brief needs ROTLI_ROUTINE_STEM}"

# Sandbox + model selection: identical to the slot wrappers.
SB="$HOME/.cache/breve/breve-write-sandbox.sb"
SANDBOX=""; if [ "$BREVE_SANDBOX" != "0" ] && [ -f "$SB" ]; then SANDBOX="/usr/bin/sandbox-exec -f $SB"; fi
BREVE_MODEL="${BREVE_MODEL:-$(bun "$BREVE/scripts/brief-model.ts" 2>/dev/null || echo sonnet)}"
LOG_DIR="$BREVE/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/$(date +%F).log"

PROMPT="Read the Breve instructions at $SKILL for voice, quality bar, and hard rules, then generate a CUSTOM brief. Output file: $BREVE/briefs/${STEM}.md

This custom brief is called \"$RLABEL\". Its purpose, from the user:
$RPROMPT

Structure (use exactly these section headers):
# $RLABEL
## Headline
One line: the single most important thing for this brief today.
## Findings
The substance — research the web as needed. Concrete, specific, linked.
## Action Items
0-3 checkbox items ONLY if something genuinely needs the user's action.

Length: 200-500 words. Quality bar: only items that pass 'the user would stop scrolling for this' — a short brief on a slow day is correct.
Output ONLY the markdown file (${STEM}.md). Do NOT write HTML, PDF, or send anything — the wrapper handles delivery.
HARD RULE: everything except $BREVE and your memex is strictly read-only — never edit, commit, or push. Flag needed changes in the brief instead."

# Self-heal (#18): same ladder as the slot wrappers.
run_model() { caffeinate -i $SANDBOX claude -p --model "$1" --dangerously-skip-permissions "$PROMPT"; }
brief_exists() { [ -f "$BREVE/briefs/${STEM}.md" ]; }

{
  echo "=== Breve custom brief '$RID' run: $(date) ==="
  bun "$BREVE/scripts/sandbox.ts" --print >/dev/null 2>&1 || true
  [ "$BREVE_SANDBOX" != "0" ] && [ -f "$SB" ] && SANDBOX="/usr/bin/sandbox-exec -f $SB"
  export GH_TOKEN="$(bun "$BREVE/scripts/secret.ts" get breve-gh-readonly 2>/dev/null || true)"
  run_model "$BREVE_MODEL"
  echo "=== claude ($BREVE_MODEL) exit $? at $(date) ==="

  if ! brief_exists; then
    FALLBACK="haiku"; [ "$BREVE_MODEL" = "haiku" ] && FALLBACK="sonnet"
    echo "=== $BREVE_MODEL produced no custom brief — self-heal: retry on $FALLBACK ==="
    run_model "$FALLBACK"
    echo "=== claude ($FALLBACK) exit $? at $(date) ==="
    if ! brief_exists; then
      bun "$BREVE/scripts/notify.ts" --idempotency-key "custom-generation-failure-$STEM" \
        "⚠ Couldn't generate your '$RLABEL' brief — both $BREVE_MODEL and $FALLBACK look unavailable." || true
      echo "=== self-heal exhausted: notified the owner ==="
    fi
  fi

  if brief_exists; then
    [[ "$LANES" == *,signal,* ]] && { bun "$BREVE/scripts/send-signal-text.ts" --file "$BREVE/briefs/$STEM.md" --prefix "☕ $RLABEL" --receipt "$STEM.signal" || echo "signal send failed"; }
    [[ "$LANES" == *,email,* ]] && { bun "$BREVE/scripts/send-brief.ts" "$STEM" || echo "email failed"; }
  else
    echo "no $STEM.md — skipping delivery"
  fi
  echo "=== done at $(date) ==="
} >> "$LOG" 2>&1
