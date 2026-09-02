#!/bin/bash
# Breve morning brief — fired by launchd (its breve-brief job) at 06:30 local
# (delivery 07:00, leadMinutes 30 in settings.json).
# Requirements: Mac awake (lid open + plugged in + "prevent sleep on power adapter"),
# user logged in (Keychain unlocked). Logs to breve/logs/.

export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.bun/bin:$HOME/.claude/local:$PATH"
BREVE="${ROTLI_BREVE_HOME:-$(cd "$(dirname "$0")/.." && pwd)}"
SKILL="${ROTLI_BREVE_SKILL:-$BREVE/skills/breve/SKILL.md}"
LANES=",${ROTLI_BREVE_LANES:-inApp,signal,email},"
# Sandbox the brief's claude call exactly like the daemon tiers (write+read confinement).
SB="$HOME/.cache/breve/breve-write-sandbox.sb"
SANDBOX=""
# If the profile is missing, sandbox.ts below generates it from the managed runtime paths.
# Brief model is config-driven — your pick in settings.json "briefModel" (default sonnet,
# the "deeper reasoning" tier, approved for briefs). NEVER inherit the system default (it was
# fable, then opus — overpowered, and a vanished default = no brief). Env override wins.
BREVE_MODEL="${BREVE_MODEL:-$(bun "$BREVE/scripts/brief-model.ts" 2>/dev/null || echo sonnet)}"
# Resolve the memex + storage roots from config (config.local.json owns the real paths; no hardcoding).
KNOWLEDGE="$(bun "$BREVE/scripts/print-root.ts" knowledge 2>/dev/null || echo "$HOME/memex-vault")"
STORE="$(bun "$BREVE/scripts/print-root.ts" storage 2>/dev/null || echo "$HOME/memex-storage")"
LOG_DIR="$BREVE/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/$(date +%F).log"

# Shared task body; only the lead-in differs per provider (Claude invokes the skill; Gemini reads
# the same SKILL.md file directly — same steps, same MARKDOWN output, so any provider yields the brief).
TASK="drain the inbox, generate today's brief as MARKDOWN only into $BREVE/briefs/ (Breve renders the readable newsletter HTML + PDF from the markdown — do NOT write the HTML or PDF yourself). If a brief for today already exists, refresh it instead of duplicating. Do NOT email or send anything — audio generation and the email send happen in the wrapper script after you finish. HARD RULE: everything except $BREVE and your memex is strictly read-only — never edit, commit, or push any other repo; flag needed changes in the brief instead. Do not take any other write actions."
PROMPT="Read the Breve instructions at $SKILL and follow them end to end: $TASK"
# Optional per-routine extra instructions from the user (Rotli Routines UI).
if [ -n "${ROTLI_ROUTINE_PROMPT:-}" ]; then
  PROMPT="$PROMPT

Additional instructions from the user (follow them; they refine, never replace, the structure above): $ROTLI_ROUTINE_PROMPT"
fi
PROMPT_AGENT="$PROMPT"

if [ "$1" = "--test" ]; then
  PROMPT="Confirm the Breve scheduled-run plumbing works: print the current date, confirm you can read $BREVE/watchlist.md (print its first heading), and stop. Do not generate a brief."
  PROMPT_AGENT="$PROMPT"
fi

TODAY=$(bun "$BREVE/scripts/today.ts")

# Provider-account policy: the legacy chain now resolves only to Rotli's
# on-device generator. Provider-shaped fallback steps fail without spawning.
brief_made() { [ -f "$BREVE/briefs/$TODAY.md" ]; }

# Run ONE provider. Claude uses $PROMPT (skill invocation); Gemini uses $PROMPT_AGENT (read SKILL.md).
# Both are wrapped in the generated macOS sandbox.
gen() {
  case "$1" in
    claude) printf '%s\n' "$PROMPT" | caffeinate -i bun "$BREVE/scripts/local-brief.ts" "$TODAY" ;;
    gemini) echo "cloud providers disabled — no process started"; return 78 ;;
  esac
}

{
  echo "=== Breve morning run: $(date) ==="
  FALLBACK="haiku"; [ "$BREVE_MODEL" = "haiku" ] && FALLBACK="sonnet"

  if [ "$1" = "--test" ]; then
    # Plumbing check: exercise EACH provider's auth + file access (writes no brief), report each exit.
    for prov in claude gemini; do
      echo "=== test $prov at $(date) ==="; gen "$prov" "$BREVE_MODEL"; echo "=== test $prov exit $? at $(date) ==="
    done
    echo "=== test done at $(date) ==="
  else
    # Provider chain — stop at the first attempt that actually writes today's brief.
    USED=""
    # Forced regen (BREVE_REGEN=1, e.g. "regenerate my brief"): set today's brief aside so brief_made()
    # tracks a FRESH run, not the stale file — restored below if EVERY provider fails (never lose it).
    if [ "$BREVE_REGEN" = "1" ]; then
      [ -f "$BREVE/briefs/$TODAY.md" ]   && mv -f "$BREVE/briefs/$TODAY.md"   "$BREVE/briefs/$TODAY.md.prev"
      [ -f "$BREVE/briefs/$TODAY.html" ] && mv -f "$BREVE/briefs/$TODAY.html" "$BREVE/briefs/$TODAY.html.prev"
      echo "=== regen: set aside existing brief (.prev) ==="
    fi
    for step in "claude:$BREVE_MODEL" "claude:$FALLBACK" "gemini:-"; do
      prov="${step%%:*}"; mdl="${step#*:}"; [ "$mdl" = "-" ] && mdl=""
      # the "claude" step label is a compatibility name: since 0.84.0 it runs the
      # on-device writer (local-brief.ts); say so in the log, or the next outage
      # gets misread as a cloud-provider failure (audit 2026-09-02 §1.1)
      label="$prov"; [ "$prov" = claude ] && label="on-device writer"
      echo "=== try $label ${mdl:+($mdl) }at $(date) ==="
      gen "$prov" "$mdl"
      echo "=== $label ${mdl:+($mdl) }exit $? at $(date) ==="
      if brief_made; then USED="$prov${mdl:+ $mdl}"; break; fi
    done

    if brief_made; then
      rm -f "$BREVE/briefs/$TODAY.md.prev" "$BREVE/briefs/$TODAY.html.prev"   # fresh brief won — drop the regen set-aside
      # Surface a fallback so a silent provider outage is still visible (no message when Claude worked).
      if [ "$USED" != "claude $BREVE_MODEL" ]; then
        case "$USED" in
          claude*)
            # Still on Claude, just a smaller model — a soft note is enough.
            bun "$BREVE/scripts/notify.ts" --idempotency-key "morning-model-fallback-$TODAY" \
              "ℹ️ Today's brief was generated with $USED — your usual model ($BREVE_MODEL) was unavailable. It's on its way." || true
            ;;
          *)
            # A provider-shaped fallback must never execute in local-only mode.
            # Make this UNMISTAKABLE so a degraded brief never slips by unnoticed. Fully defensive:
            # try the Signal text path, then notify.ts, and never let an alert failure break the run.
            PROV="${USED%% *}"
            bun "$BREVE/scripts/send-signal-text.ts" --idempotency-key "morning-provider-fallback-$TODAY" \
              --message "⚠ Heads up — this morning's brief used the on-device safety fallback. No cloud provider account was used." \
              || bun "$BREVE/scripts/notify.ts" --idempotency-key "morning-provider-fallback-$TODAY" \
                "⚠ Morning brief used the on-device safety fallback; cloud providers remain disabled." \
              || true
            ;;
        esac
      fi
    else
      # Restore a regen set-aside so a failed regeneration never loses the brief that was already there.
      [ -f "$BREVE/briefs/$TODAY.md.prev" ]   && mv -f "$BREVE/briefs/$TODAY.md.prev"   "$BREVE/briefs/$TODAY.md"
      [ -f "$BREVE/briefs/$TODAY.html.prev" ] && mv -f "$BREVE/briefs/$TODAY.html.prev" "$BREVE/briefs/$TODAY.html"
      # On-demand runs let the daemon relay (richer ask + latest-issue pointer); scheduled runs relay here.
      [ -z "$BREVE_ONDEMAND" ] && bun "$BREVE/scripts/notify.ts" --idempotency-key "morning-generation-failure-$TODAY" \
        "⚠ I couldn't generate your brief with the on-device model. No cloud provider was contacted. Reply \"brief\" to retry." || true
      echo "=== all providers exhausted — skipping downstream ==="
    fi
  fi

  if [ "$1" != "--test" ]; then
    # Render the readable newsletter HTML + PDF from the markdown (Breve owns presentation — light
    # blog/newsletter, no issue number; overrides whatever the model may have written).
    [ -f "$BREVE/briefs/$TODAY.md" ] && { bun "$BREVE/scripts/render-brief.ts" "$TODAY" || echo "render-brief failed"; }
    # Monday: rotate the weekly step-up passphrase (hash → breve keychain) and pass the plaintext word
    # to the audio render via env ONLY — it's spoken into the mp3, never written to any file.
    if [ "$(date +%u)" = "1" ]; then
      export BREVE_PASSPHRASE="$(bun "$BREVE/scripts/auth.ts" rotate 2>/dev/null)"
      [ -n "$BREVE_PASSPHRASE" ] && echo "weekly passphrase rotated (spoken in today's audio)"
    fi
    # Audio digest (local Gemma + Kokoro TTS) — only for today's freshly generated brief
    if [ -f "$BREVE/briefs/$TODAY.md" ]; then
      caffeinate -i bun "$BREVE/scripts/audio-brief.ts" "$TODAY" || echo "audio-brief failed (continuing)"
    else
      echo "no $TODAY.md — skipping audio"
    fi
    # Inline-view PNG for Signal's /brief — binaries live in the storage root, not the memex
    mkdir -p "$STORE/breveViews"
    if [ -f "$BREVE/briefs/$TODAY.html" ]; then
      npx playwright screenshot --full-page --viewport-size="760,1000" \
        "file://$BREVE/briefs/$TODAY.html" "$STORE/breveViews/$TODAY.png" || echo "png render failed"
    fi
    # Generate-early, deliver-on-time: a SCHEDULED run HOLDS the send until the morning arrival time
    # (settings.json deliveryTimes.morning). On-demand ("morning brief"/regenerate, BREVE_ONDEMAND=1)
    # and --test send immediately. Only holds when today's brief actually exists.
    if [ -z "$BREVE_ONDEMAND" ] && [ -f "$BREVE/briefs/$TODAY.md" ]; then
      WAIT="$(bun "$BREVE/scripts/hold-until.ts" morning 2>/dev/null || echo 0)"
      case "$WAIT" in ''|*[!0-9]*) WAIT=0 ;; esac
      if [ "$WAIT" -gt 0 ]; then
        echo "=== generated early; holding send ${WAIT}s until morning arrival ($(date)) ==="
        caffeinate -i sleep "$WAIT"
        echo "=== hold done; delivering ($(date)) ==="
      fi
    fi
    # Signal gets the audio (wake-up listen); email gets the PDF (quiet read later)
    if [[ "$LANES" == *,signal,* ]] && [ -f "$STORE/breveAudios/$TODAY.mp3" ]; then
      bun "$BREVE/scripts/send-signal-brief.ts" "$TODAY" || echo "signal send failed"
    fi
    # Email send (pre-authorized by the owner: standing approval for the scheduled run only)
    if [[ "$LANES" == *,email,* ]] && [ -f "$BREVE/briefs/$TODAY.html" ]; then
      bun "$BREVE/scripts/send-brief.ts" "$TODAY" || echo "send-brief failed"
    else
      echo "no $TODAY.html — skipping email"
    fi
  fi
  echo "=== done at $(date) ==="
} >> "$LOG" 2>&1
