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
SANDBOX=""; if [ "$BREVE_SANDBOX" != "0" ] && [ -f "$SB" ]; then SANDBOX="/usr/bin/sandbox-exec -f $SB"; fi
# If the profile is missing, sandbox.ts below generates it from the managed runtime paths.
# Brief model is config-driven — your pick in settings.json "briefModel" (default sonnet,
# the "deeper reasoning" tier, approved for briefs). NEVER inherit the system default (it was
# fable, then opus — overpowered, and a vanished default = no brief). Env override wins.
BREVE_MODEL="${BREVE_MODEL:-$(bun "$BREVE/scripts/brief-model.ts" 2>/dev/null || echo sonnet)}"
# Resolve the memex + storage roots from config (config.local.json owns the real paths; no hardcoding).
KNOWLEDGE="$(bun "$BREVE/scripts/print-root.ts" knowledge 2>/dev/null || echo "$HOME/memex")"
STORE="$(bun "$BREVE/scripts/print-root.ts" storage 2>/dev/null || echo "$HOME/memex-storage")"
# Cross-provider fallback chain. Each agent CLI has INDEPENDENT auth (Anthropic / Google / OpenAI), so a
# Claude outage or 401 (the common failure) doesn't touch the others. argv[0] resolved to an absolute
# path (sandbox-exec runs the program directly).
CLAUDE_BIN="$(command -v claude 2>/dev/null || echo claude)"
AGY="$([ -x "$HOME/.local/bin/agy" ] && echo "$HOME/.local/bin/agy" || command -v agy 2>/dev/null || true)"
CODEX="$(command -v codex 2>/dev/null || true)"
LOG_DIR="$BREVE/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/$(date +%F).log"

# Shared task body; only the lead-in differs per provider (Claude invokes the skill; gemini/codex read
# the same SKILL.md file directly — same steps, same MARKDOWN output, so any provider yields the brief).
TASK="drain the inbox, generate today's brief as MARKDOWN only into $BREVE/briefs/ (Breve renders the readable newsletter HTML + PDF from the markdown — do NOT write the HTML or PDF yourself). If a brief for today already exists, refresh it instead of duplicating. Do NOT email or send anything — audio generation and the email send happen in the wrapper script after you finish. HARD RULE: everything except $BREVE and your memex is strictly read-only — never edit, commit, or push any other repo; flag needed changes in the brief instead. Do not take any other write actions."
PROMPT="Read the Breve instructions at $SKILL and follow them end to end: $TASK"
PROMPT_AGENT="$PROMPT"

if [ "$1" = "--test" ]; then
  PROMPT="Confirm the Breve scheduled-run plumbing works: print the current date, confirm you can read $BREVE/watchlist.md (print its first heading), and stop. Do not generate a brief."
  PROMPT_AGENT="$PROMPT"
fi

TODAY=$(bun "$BREVE/scripts/today.ts")

# Cross-provider self-heal: try Claude (configured model → a fallback model), then GEMINI (agy), then
# CODEX — independent auth, so a Claude outage/401 (the common case, e.g. an expired login) still yields
# a brief. We ALWAYS get the brief unless all three are down (rare). The OS write-sandbox ($SB) confines
# every provider to Rotli's managed runtime + your memex. Downstream render/audio/email need no model auth.
brief_made() { [ -f "$BREVE/briefs/$TODAY.md" ]; }

# Run ONE provider. claude uses $PROMPT (skill invocation); gemini/codex use $PROMPT_AGENT (read SKILL.md).
# claude + agy have no native OS sandbox, so we wrap them in $SANDBOX (sandbox-exec). codex ships its OWN
# Seatbelt sandbox (`-s workspace-write` confines writes to the workdir + --add-dir, blocking your
# other projects, etc.), and nesting it inside sandbox-exec fails ("can't initialize app-server") — so codex
# runs UNWRAPPED and self-confines. Same write boundary, just enforced by codex instead of our profile.
gen() {
  case "$1" in
    claude) caffeinate -i $SANDBOX "$CLAUDE_BIN" -p --model "$2" --dangerously-skip-permissions "$PROMPT" ;;
    gemini) [ -n "$AGY" ]   && caffeinate -i $SANDBOX "$AGY" -p "$PROMPT_AGENT" --dangerously-skip-permissions --print-timeout 15m \
              --add-dir "$KNOWLEDGE" --add-dir "$BREVE" || { echo "(gemini/agy unavailable)"; return 1; } ;;
    # codex runs with a CLEAN CODEX_HOME ($CODEX_HOME_CLEAN): real auth (symlinked) but mcp_servers
    # stripped — the brief needs no MCP, and the configured servers (Supabase/Railway) only added
    # oauth errors + latency. -c 'mcp_servers={}' didn't take (codex merges tables), hence the clean home.
    codex)  [ -n "$CODEX" ] && caffeinate -i env CODEX_HOME="$CODEX_HOME_CLEAN" "$CODEX" exec --skip-git-repo-check -s workspace-write \
              -C "$BREVE" --add-dir "$KNOWLEDGE" - <<<"$PROMPT_AGENT" || { echo "(codex unavailable)"; return 1; } ;;
  esac
}

{
  echo "=== Breve morning run: $(date) ==="
  # Ensure the sandbox profile exists before any model runs.
  bun "$BREVE/scripts/sandbox.ts" --print >/dev/null 2>&1 || true
  [ "$BREVE_SANDBOX" != "0" ] && [ -f "$SB" ] && SANDBOX="/usr/bin/sandbox-exec -f $SB"
  # Optional read-only gh token (empty = gh uses default auth).
  export GH_TOKEN="$(bun "$BREVE/scripts/secret.ts" get breve-gh-readonly 2>/dev/null || true)"

  # Clean CODEX_HOME for the codex fallback: real auth (symlinked, never copied) + the user's
  # config.toml MINUS any [mcp_servers*] table (all other config paths are absolute, so plugins /
  # projects / hooks still resolve). Strips the Supabase/Railway MCP oauth noise from the run.
  CODEX_HOME_CLEAN="$HOME/.codex"
  if [ -n "$CODEX" ] && [ -f "$HOME/.codex/auth.json" ]; then
    CODEX_HOME_CLEAN="$HOME/.cache/breve/codex-home"; mkdir -p "$CODEX_HOME_CLEAN"
    ln -sf "$HOME/.codex/auth.json" "$CODEX_HOME_CLEAN/auth.json"
    [ -f "$HOME/.codex/config.toml" ] && awk '/^\[mcp_servers/{skip=1;next} /^\[/&&!/^\[mcp_servers/{skip=0} !skip' "$HOME/.codex/config.toml" > "$CODEX_HOME_CLEAN/config.toml"
  fi

  FALLBACK="haiku"; [ "$BREVE_MODEL" = "haiku" ] && FALLBACK="sonnet"

  if [ "$1" = "--test" ]; then
    # Plumbing check: exercise EACH provider's auth + file access (writes no brief), report each exit.
    for prov in claude gemini codex; do
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
    for step in "claude:$BREVE_MODEL" "claude:$FALLBACK" "gemini:-" "codex:-"; do
      prov="${step%%:*}"; mdl="${step#*:}"; [ "$mdl" = "-" ] && mdl=""
      echo "=== try $prov ${mdl:+($mdl) }at $(date) ==="
      gen "$prov" "$mdl"
      echo "=== $prov ${mdl:+($mdl) }exit $? at $(date) ==="
      if brief_made; then USED="$prov${mdl:+ $mdl}"; break; fi
    done

    if brief_made; then
      rm -f "$BREVE/briefs/$TODAY.md.prev" "$BREVE/briefs/$TODAY.html.prev"   # fresh brief won — drop the regen set-aside
      # Surface a fallback so a silent provider outage is still visible (no message when Claude worked).
      if [ "$USED" != "claude $BREVE_MODEL" ]; then
        case "$USED" in
          claude*)
            # Still on Claude, just a smaller model — a soft note is enough.
            bun "$BREVE/scripts/notify.ts" "ℹ️ Today's brief was generated with $USED — your usual model ($BREVE_MODEL) was unavailable. It's on its way." || true
            ;;
          *)
            # Fell OFF Claude entirely (gemini/codex) — almost always a Claude auth failure (401).
            # Make this UNMISTAKABLE so a degraded brief never slips by unnoticed. Fully defensive:
            # try the Signal text path, then notify.ts, and never let an alert failure break the run.
            PROV="${USED%% *}"
            bun "$BREVE/scripts/send-signal-text.ts" --message "⚠ Heads up — this morning's brief fell back to $PROV because Claude auth failed (likely an expired login / 401). The brief still went out, but re-auth Claude when you get a moment." \
              || bun "$BREVE/scripts/notify.ts" "⚠⚠ MORNING BRIEF DEGRADED — fell back to $PROV; Claude auth failed (401). Re-auth Claude when you can." \
              || true
            ;;
        esac
      fi
    else
      # Restore a regen set-aside so a failed regeneration never loses the brief that was already there.
      [ -f "$BREVE/briefs/$TODAY.md.prev" ]   && mv -f "$BREVE/briefs/$TODAY.md.prev"   "$BREVE/briefs/$TODAY.md"
      [ -f "$BREVE/briefs/$TODAY.html.prev" ] && mv -f "$BREVE/briefs/$TODAY.html.prev" "$BREVE/briefs/$TODAY.html"
      # On-demand runs let the daemon relay (richer ask + latest-issue pointer); scheduled runs relay here.
      [ -z "$BREVE_ONDEMAND" ] && bun "$BREVE/scripts/notify.ts" "⚠ I couldn't generate your brief — Claude, Gemini AND Codex all look unavailable this morning (very rare — could be your network or all three providers). Reply \"brief\" to retry." || true
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
