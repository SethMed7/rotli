# Rotli-managed Breve runtime

This directory is the versioned runtime that replaces the standalone `~/breve`
project. Rotli copies executable code into the active corpus at
`.rotli/breve/`, keeps mutable/private state there, and supervises
`scripts/rotli-scheduler.ts`.

The scheduler owns exactly the former launchd workload:

- `morning`, `lunch`, `night` — generation, rendering, TTS, Signal/email delivery
- `creators` — hourly YouTube creator checks
- `watchers` — page/condition checks
- `doctor` — health, missed artifacts, disk/model/bridge checks
- `signal` — always-on Signal assistant with reminders, mail, media, voice,
  model routing, and confirmed maintenance actions

Runtime configuration is canonical at `.rotli/routines/config.json`. The
watchlist, creators, watchers, and briefs are aliases to their canonical memex
locations, so the UI, scheduler, and note index never maintain competing copies.
Private installation files (`signal.json`, mail/recipient/access configuration),
logs, transcripts, pending actions, and scheduler state live only under
`.rotli/breve/` and remain gitignored with other `.rotli` state.

Takeover is deliberately ordered: copy and validate data → install runtime and
dependencies → initialize duplicate-prevention state → unload/remove the seven
legacy agents → write the managed marker → start the scheduler. The old project
is retained until the separate retirement check verifies the scheduler and moves
it to Trash.
