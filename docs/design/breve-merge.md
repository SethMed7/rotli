# Breve → rotli — the full-merge design

**Status:** DESIGN (approved direction 2026-07-03; no code yet). Sequenced after the
0.24.3 organizer-controls release. This doc is the spec; build it in phases (§9).

**Decision (Seth, 2026-07-03):** a **full merge** — rotli absorbs Breve entirely
(routines/briefs, watchlist, Signal I/O, on-device TTS, PDF + email delivery, email
triage, page/creator watchers), then Breve is renamed → rotli and `~/breve` /
`SethMed7/breve` archived per `~/smLab/LIFECYCLE.md`. Breve and rotli are the two faces
of one brain over the memex — Breve = ambient/push/mobile (Signal, voice), rotli =
interactive/desktop. One product now.

## Seth's three hard constraints (load-bearing — every phase honors them)
1. **Tests run at the end.** `bun run check` (tsc + `bun test` + check:hex) **and**
   `cargo test` are green when the merge lands. Breve's existing test suite is ported,
   not dropped; new subsystems ship with tests. No phase is "done" without proof.
2. **Never lose the briefs or the watchlist.** The three daily drops (times, content,
   voices, delivery) and the full watchlist (watch/lens pairs) migrate faithfully. The
   verbatim inventory is §2; the migration checklist is §8. This is the acceptance bar.
3. **Signal is manual, in Settings.** No auto-provisioning. rotli ships a **Settings →
   Signal** pane with a **step-by-step Twilio → Signal walkthrough** (buy a number, solve
   captcha, register, verify the SMS code, test two-way) — §6.

---

## 1. What rotli already has that Breve needs (reuse, don't rebuild)
The merge is smaller than it looks because rotli already owns most of the machinery:

| Breve needs | rotli already has |
|---|---|
| Provider fallback for briefs (Claude→Gemini→Codex) | **`provider.rs`** lanes — `claude`/`codex`/`agy`/`gemini`, `cli_complete`, `build_args`, detection (`cli_detect`) |
| A model to write the brief | The **organizer's pluggable transport** (0.24.3: local MLX **or** `claude -p` Sonnet) — generalize it |
| An always-on background worker + scheduler | The **organizer daemon** (`organizer.rs`) — a `std::thread` worker with gates; generalize into a **routines scheduler** |
| Lane detection + config UI | The **AI Models pane** pattern (installed/authenticated probes, per-lane cards) |
| The memex as knowledge base | Already the corpus (`CorpusStore`, id↔path index, `storage/`) |
| Secrets in Keychain | `keychain.rs` (`get_secret`) already used for the gemini key |
| Rendered output to `storage/` | `import_file` / the `storage:` asset lane |

**What's genuinely new in rotli:** the **routines scheduler** (replaces launchd), the
**Signal lane** (signal-cli send/receive + the Settings walkthrough), **TTS** (Kokoro),
**PDF** (headless Chrome), **email** (Resend send + IMAP read), and the **brief SKILL**
(the generation prompt/flow, today `~/.claude/skills/breve/SKILL.md`).

**Runtime shape decision:** keep Breve's proven TS as a **Bun "routines engine" sidecar**
that rotli's Rust shell manages (spawn, schedule, health) — the same pattern rotli already
uses for the MLX python sidecar and the provider CLIs. This **maximizes preservation**
(Breve's tested scripts move largely intact) and **satisfies constraint #1** (its `bun test`
suite ports directly). Rust owns scheduling, gating, Keychain, and the Settings UI; the
sidecar owns brief generation, rendering, TTS, and delivery. *(Alt considered: port
everything to Rust — rejected: throws away tested TS, multiplies risk, no upside.)*

---

## 2. PRESERVE — the verbatim Breve inventory (source of truth for migration)
Captured 2026-07-03 from `~/breve`. Full detail in the migration checklist (§8); this is
the shape that must survive.

### 2.1 The seven routines (today launchd; become rotli Routines §4)
| Routine | Script (today) | Cadence | Delivers |
|---|---|---|---|
| **Morning brief** | `morning-brief.sh` | fires 06:00 → **delivers 07:00** (60-min lead) | audio→Signal · PDF→email · PNG→Signal `/brief` |
| **Lunch "Pivot"** | `lunch-brief.sh` | fires 11:30 → **delivers 12:00** | audio→Signal · PDF→email (on-demand) |
| **Nightcap** | `night-brief.sh` | fires 17:30 → **delivers 18:00** + daily-log archive | text→Signal · PDF→email |
| **Creator alerts** | `creator-alerts.ts` | hourly | Signal when a watched channel posts |
| **Doctor (health)** | `breve-doctor.ts` | every 30 min | self-heal / propose (this is what sent the check-up pings) |
| **Watchers** | `watcher-check.ts` | every 30 min | Signal on a watched-URL change |
| **Signal daemon** | `signal-daemon.ts` | always-on (KeepAlive) | the two-way chat listener (owner allowlist) |

### 2.2 Brief content contracts (render + TTS parse these — keep the headers exact)
- **Morning:** `## Headline` · `## Action Items` · industry sections · `## Projects` ·
  `## Personal` · `## Worth Your Time` · `## 📡 Radar` (one new company + a yes/no Signal
  vote). Mondays rotate a spoken passphrase. 3-host podcast audio (Ava/Marcus/Emma).
- **Lunch (300–500w):** `## Delta Check` · `## Macro Scout` · `## Tooling Tease` ·
  `## Rabbit Hole Hooks`. No verbatim repeat from morning.
- **Night (400–700w):** `## Since Lunch` · `## Rabbit Holes, Dug` · `## Tomorrow Setup` ·
  `## Long-form Pick`. Calmer register; archives the day to memex `history/`.

### 2.3 The watchlist (`watchlist.md`, ~92 lines, gitignored)
**Watch/Lens** tables — the *lens* (Seth's angle) is the point, not the name. Sections:
Runtimes & JS ecosystem · AI labs & coding agents · AI code-review/security tools ·
Open-weight models · Companies & infra · Security & privacy · Markets (light) · People &
creators (Theo) · Chess (Carlsen/Hikaru/Pragg/Gotham) · Gaming (CoD) · **Brief preferences**
("Seth would stop scrolling for this"; 5–10 min; always end with a "worth your time"
shortlist). **Migrates verbatim** into the merged app (§5).

### 2.4 Generation pipeline
Inputs: watchlist lenses · `inbox.md` captures (drained + routed) · memex knowledge (RO) ·
3 IMAP accounts (RO EXAMINE) · GitHub via `gh` (RO) · smLab dashboard staleness · web
research (parallel agents). Model: `settings.json briefModel` (=`sonnet`) via the provider
chain **Claude(brief)→Claude(fallback)→Gemini(agy)→Codex**, stop at first success,
independent auth per provider. Sandboxed (`sandbox-exec` for Claude/Gemini; Codex
self-confined). The prompt/flow lives in `~/.claude/skills/breve/SKILL.md` (all providers
read it). Render: md→HTML→PDF (headless Chrome, dark theme `docs/theme.md`). Audio:
md→spoken script (local Gemma)→**Kokoro** multi-voice TTS→mp3.

### 2.5 Config + secrets to carry over (§5, §7)
`settings.json` (timezone · leadMinutes · leadOverrides · deliveryTimes · briefModel) ·
`config.local.json` (paths · local LLM) · `policy.json` (model cost/ask tiers) ·
`capabilities.json` · `creators.json` · `watchers.json` · `mail-accounts.json` ·
`recipients.json` · `signal.json`. Secrets in a dedicated **`breve.keychain-db`** under
services `resend-breve`, `breve-mail-*`, `breve-gh-readonly`. **Signal identity keys live
in `~/.local/share/signal-cli/` — backing this up is catastrophic to lose.**

---

## 3. The conceptual model in merged rotli
rotli today: three fronts (Inbox · Chat · Notes). The merge adds a fourth capability that
threads through them rather than a new front:

- **Routines** — scheduled jobs that run a model over the memex and produce an artifact
  (a brief note + audio + PDF) then **deliver** it. Live in a new **Settings → Routines**
  pane; each brief is also written into the memex (so it's a real note you can open, and
  "everything has a chat").
- **Delivery lanes** — Signal · Email · (in-app). Configured in Settings, detected like
  the AI Model lanes. A routine picks which lanes it uses.
- **The Signal chat** — the two-way listener becomes rotli's **remote mouth/ears**: the
  same assistant, reachable from your phone. In-app it's just another chat surface.

The briefs stop being "Breve's private output" and become **first-class memex notes**
(`history/` or a `briefs/` area) that rotli already knows how to render, search, and chat
about — which is exactly the consolidation Seth wants.

---

## 4. Routines scheduler (replaces launchd)
rotli is an always-running menu-bar `Accessory` app, so it hosts the scheduler in-process
— no launchd, no separate daemon.

- **Where:** generalize `organizer.rs`'s worker into a `scheduler.rs` (or extend it): a
  `std::thread` planner holding a list of **Routines** `{ id, kind, schedule, lanes, enabled }`.
  Schedules: `daily@HH:MM` (briefs, with lead/delivery split) and `every N secs`
  (watchers/creators/doctor). The Signal listener is an always-on child, not a tick.
- **Gates:** reuse the organizer's gate model where it fits (don't fire a brief mid-Focus?
  — actually briefs are time-critical, so they run regardless; watchers/creators respect
  the same idle/AC courtesy). Missed-run policy: if the Mac was asleep at 07:00, deliver
  on next wake with a "late" note (launchd's `StartCalendarInterval` fires on wake; match
  that).
- **Persistence:** routine definitions + times in `settings.json` (frontend-owned, Rust
  reads — same pattern as `organizerQuietSecs`). Editing a time in Settings reschedules
  live (no `apply-schedule.ts`).
- **Execution:** the planner invokes the **Bun routines-engine sidecar** with a job
  descriptor; the sidecar runs the ported Breve script; Rust captures artifacts + drives
  delivery lanes. Model calls route through the **generalized transport** (the 0.24.3
  local/claude dispatch, extended to the full provider chain).
- **Status/visibility:** a **Settings → Routines** pane lists each routine, last run,
  next run, last artifact (link into the note), and a **Run now** per routine (mirrors the
  organizer's Run-now). Failures surface quietly (rotli is low-pulse), never a toast storm.

---

## 5. Data migration (nothing lost)
One-time importer (a `bun` script + a Settings "Import from Breve" action) that maps
`~/breve/*` into merged rotli:

| Breve file | → merged rotli home |
|---|---|
| `watchlist.md` | memex `wiki/reference/watchlist.md` (a real, editable note) **or** `.rotli/routines/watchlist.md` — **verbatim**; editable in-app |
| `settings.json` (times/model) | rotli `settings.json` under a `routines` block (timezone, deliveryTimes, leadOverrides, briefModel) |
| `config.local.json` (LLM) | folds into rotli's existing model config / AI Models pane |
| `creators.json`, `watchers.json` | `.rotli/routines/creators.json`, `watchers.json` (+ Settings editors; managed in-app the way Signal did `/creators add`) |
| `mail-accounts.json`, `recipients.json`, `signal.json` | Settings panes (Email, Signal) — PII entered by the user, never committed; written to `.rotli/` (gitignored) |
| `policy.json`, `capabilities.json` | rotli policy/capability config (cost tiers already partly exist in the AI Models pane) |
| `briefs/*.md` history | memex `history/` (Breve already archived there via `daily-log.ts`) — import the back-catalog |
| `~/.local/share/signal-cli/` | **left in place** — the Signal identity keys stay; rotli's signal lane points at them (a backup reminder in Settings) |
| `~/.claude/skills/breve/SKILL.md` | ships **inside rotli** as the brief-generation spec the routines engine reads (versioned with the app) |
| Kokoro model cache, sandbox profiles | reused in place / regenerated by rotli |

Secrets are **not** migrated as values — the Settings panes guide the user to (re-)enter
them into the Keychain (§7). Migration is idempotent and prints a report; it never deletes
`~/breve` (that's the archive step, §10, done only after Seth confirms parity).

---

## 6. Signal — manual, in Settings, with a Twilio → Signal walkthrough
**Constraint #3.** No auto-provisioning; a guided wizard the user drives. Backed by
`signal-cli` (detected like a CLI lane; if absent, the pane explains `brew install
signal-cli` first). The wizard turns `setup/03-signal-channel.md`'s 12 steps into screens:

**Settings → Signal** (states: `Not set up` · `Registering` · `Connected`):

1. **Prerequisite check** — probe `signal-cli` (installed? version) + Java. If missing,
   show the one-line install and a re-check button. (Mirrors `cli_detect`.)
2. **Get a phone number (Twilio)** — explain *why* (Signal needs a number to register; the
   number is only used once, the identity keys become the account). Steps on screen:
   - Open **console.twilio.com** (button) → Phone Numbers → Buy a number → filter **US ·
     SMS + Voice** → buy (~$1.15/mo). Paste the number back into rotli (`bot` = `+1…`).
   - Enter **your personal Signal number** (`owner` = the hard allowlist).
3. **Solve the captcha** — button opens `https://signalcaptchas.org/registration/generate.html`;
   the user solves it and pastes the `signalcaptcha://…` link back.
4. **Register** — rotli runs `signal-cli -a <bot> register --captcha '<link>'` (Rust
   subprocess; output surfaced inline; errors explained).
5. **Enter the SMS code** — instruct: open Twilio Console → Monitor → Logs → Messaging,
   read the 6-digit code, paste it → rotli runs `signal-cli -a <bot> verify <code>`.
6. **Name the bot** — `signal-cli updateProfile --given-name "rotli"` (shows in your phone).
7. **Test two-way** — rotli sends "hello from rotli" to `owner`; asks you to **reply from
   your phone**; rotli runs a bounded `receive` and confirms it saw your reply → **Connected**.
8. **Backup reminder** — a clear note to back up `~/.local/share/signal-cli/` (the real
   account); offer a "Reveal in Finder" button.
9. **Persist** — write `.rotli/signal.json` (`bot`, `owner`, `ownerUuid` parsed from the
   receive log). Start the always-on Signal listener routine.

Each screen degrades gracefully (a failed step explains the fix and lets you retry) and
never blocks the rest of rotli. The Rust side wraps `signal-cli` (send `--voice-note` /
`-m`, bounded `receive`, the owner allowlist) reusing Breve's serialized-access lock logic.

---

## 7. Secrets
Keep the Keychain model. rotli's `keychain.rs` gains helpers for the service names Breve
uses: `resend-breve` (email send), `breve-mail-*` (IMAP), `breve-gh-readonly` (optional).
Settings panes (Email, Signal, Delivery) have "Set key" fields that write to the Keychain —
never to a file, never committed. The dedicated `breve.keychain-db` can be reused or its
items migrated into rotli's own keychain; **secure/locked notes still never reach a remote
model** (the 0.24.3 guarantee holds for briefs too — a brief's inputs are RO memex + web,
not secure notes).

## 8. Migration checklist (the "don't lose it" acceptance list)
- [ ] Three brief schedules preserved (deliver 07:00 / 12:00 / 18:00, with lead offsets)
- [ ] `settings.json` keys: timezone · leadMinutes · leadOverrides · deliveryTimes · briefModel
- [ ] Watchlist verbatim (watch/lens pairs, all sections, brief-preferences block)
- [ ] Provider fallback chain (Claude→Claude-fallback→Gemini→Codex, independent auth)
- [ ] Exact brief headers (`## Headline`, `## Action Items`, …) — render + TTS parse them
- [ ] Per-brief artifacts: `.md` + `.html` + `.pdf` + `.mp3` (+ morning `.png`)
- [ ] Delivery routing per brief (morning audio→Signal + PDF→email; PNG for `/brief`)
- [ ] Hold-until-delivery for scheduled runs; immediate for on-demand
- [ ] Dark theme tokens (bg `#161616`, text `#e9e7e2`, accent `#d9a868`)
- [ ] 3-host morning audio (Ava/Marcus/Emma); security lines always in Marcus voice
- [ ] Creators + watchers + doctor routines
- [ ] Signal two-way (owner allowlist; Whisper transcription of voice notes)
- [ ] Secrets in Keychain (Resend, mail, GitHub); Signal identity keys backed up
- [ ] `SKILL.md` brief spec shipped in-app
- [ ] The recurring **doctor/validate** check runs in rotli (and the storage-slug fix from
      0.24.3 means it stays green)

## 9. Phased build plan (each phase ends green — constraint #1)
- **P0 · Foundations** — generalize the organizer transport into a full **provider chain**
  (reuse `provider.rs`); stand up the **routines-engine Bun sidecar** skeleton + port
  Breve's `bun test` suite into rotli's test run. *Gate: `bun run check` + `cargo test`.*
- **P1 · Scheduler + one routine** — `scheduler.rs` + a **Settings → Routines** pane;
  wire the **morning brief** end-to-end **to an in-app note** (no external delivery yet).
  Watchlist migrated + editable. *Gate: a real morning brief note generates on schedule; tests.*
- **P2 · Delivery: PDF + email** — headless-Chrome PDF + Resend send + the Email settings
  pane + Keychain. *Gate: PDF+email arrive; tests for the renderers/senders.*
- **P3 · Delivery: TTS + Signal** — Kokoro audio + the **Signal lane** + the **Settings →
  Signal walkthrough** (§6). Two-way listener routine. *Gate: audio brief lands on the
  phone; walkthrough completes on a clean machine; tests.*
- **P4 · The rest** — lunch + night briefs, creators, watchers, doctor, email triage (RO
  IMAP), inbox drain. *Gate: full parity with the §8 checklist; tests.*
- **P5 · Cutover + archive** — run rotli and Breve in parallel for a few days; when Seth
  confirms parity, disable Breve's launchd jobs, **archive `~/breve` → `~/smArchive`** +
  archived GitHub repo (`~/smLab/LIFECYCLE.md`), rename Breve→rotli in the SM-suite docs.

## 10. Archive plan (after parity, P5)
Per `~/smLab/LIFECYCLE.md`: git bundle → `~/smArchive/projects/breve/` + a private archived
`SethMed7/breve` + an `ARCHIVE.md` (what it was, wake-up steps). Update `~/CLAUDE.md`, the
SM-suite map, and `~/smArchive/INDEX.md`. Unload the seven launchd jobs. Keep
`~/.local/share/signal-cli/` (rotli now owns the Signal account).

## 11. Decisions (RESOLVED — Seth, 2026-07-03)
1. **Runtime shape → Bun routines-engine sidecar.** rotli's Rust shell schedules/manages a
   Bun sidecar running Breve's proven TS largely intact (not a Rust port). Preserves tested
   code + makes the test-port clean (constraint #1).
2. **Watchlist → a real memex note** (`wiki/reference/watchlist.md`) — editable, searchable,
   chat-able like any note. Not app-private.
3. **Distribution → opt-in capabilities with detection.** Routines/Signal/TTS/email are OFF
   by default; each is a lane rotli detects + the user enables in Settings (AI-Models-pane
   pattern). A plain notes install stays lean.
4. **Email → keep Breve's posture.** Read-only IMAP (EXAMINE) for triage/context; Resend
   outbound ONLY for scheduled brief PDFs; no drafting/sending without a per-message confirm.

---

*Companion inventory (verbatim Breve state, 2026-07-03) is preserved in the agent findings
of this session; `~/breve` remains the reference until P5 archive.*
