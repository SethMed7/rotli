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

Exactly one scheduler may own a managed Breve home. The scheduler claims an
atomic, crash-recoverable process lock before loading state; additional Rotli
processes stand by without starting jobs or Signal. Rotli passes its PID to the
scheduler, which terminates its whole process group if the owning app disappears
without a graceful exit. Every scheduled job also has a cross-process lock, so
stale or briefly overlapping supervisors cannot launch the same routine twice.

Outbound delivery is claimed before the external send and completed with the
existing durable receipt afterward. This closes the check-then-send race while
retaining recoverable retries. Creator and watcher producers have their own
locks, and warning receipts/flags make fallback and watcher notices one-per-event
rather than one-per-process.

Takeover is deliberately ordered: copy and validate data → install runtime and
dependencies → initialize duplicate-prevention state → unload/remove the seven
legacy agents → write the managed marker → start the scheduler. The old project
is retained until the separate retirement check verifies the scheduler and moves
it to Trash.

## Regression checks

`bun run test:breve` covers policy and failure behavior, including real
cross-process lock contention and stale-owner recovery. `bun run
check:breve-runtime` bundles every TypeScript entry point, validates the three
shell pipelines, and runs a wiring contract that requires scheduler ownership,
parent-death monitoring, per-job and producer locks, delivery claims, and
idempotent owner warnings. Tests never contact Signal, email, model providers,
or watcher targets; real delivery remains an explicitly authorized live check.
