# Rotli-managed Breve runtime

This directory is the versioned runtime that replaces the standalone `~/breve`
project. Rotli copies executable code into the active corpus at
`.rotli/breve-runtime/`, keeps mutable/private state at `.rotli/breve/`, and
supervises `scripts/rotli-scheduler.ts` through stable compatibility aliases.
The code/dependency bundle is staged and frozen-installed before an atomic
directory swap; a failed or interrupted upgrade restores the previous complete
bundle without replacing mutable state.

The scheduler owns exactly the former launchd workload:

- `morning`, `lunch`, `night` — generation, rendering, TTS, Signal/email delivery
- `creators` — hourly YouTube creator checks
- `watchers` — page/condition checks
- `doctor` — health, missed artifacts, disk/model/bridge checks
- `signal` — always-on Signal assistant with reminders, mail, media, voice,
  model routing, and confirmed maintenance actions

Runtime configuration is canonical at `.rotli/routines/config.json`. The
watchlist, creators, watchers, and briefs are aliases to their canonical vault
locations, so the UI, scheduler, and note index never maintain competing copies.
Private installation files (`signal.json`, mail/recipient/access configuration),
logs, transcripts, pending actions, and scheduler state live only under
`.rotli/breve/` and remain gitignored with other `.rotli` state.

Rotli's Breve dashboard is a read projection of those same vault-owned files:
saved brief Markdown supplies the issue carousel, top stories, actions, and
source links. Each top story keeps its own cited links, and dashboard citations
open in Rotli's session-only private browser rather than leaving the app;
routine configuration supplies the schedule; a sanitized bounded
tail of `logs/rotli-scheduler.log` supplies Notifications. Raw commands,
prompts, paths, and stderr never cross the native IPC boundary. Watchlist
editing and web research remain separate effects. **Refresh last 30 days** is
an explicit user action that runs the ordinary sandboxed custom-brief pipeline
with `inApp` delivery only and writes its Markdown into the canonical briefs
lane. Debug builds simulate the notification in memory and never start a model,
scheduler, or production-vault write.

Breve model generation is on-device only. Managed configuration is normalized
to a registered local model at read, write, import, and takeover boundaries;
legacy cloud-model settings cannot reactivate a subscription lane. Scheduled,
Signal, watcher, and one-shot scripts use the loopback local-model adapter, and
the retained legacy cloud-spawn shim refuses before binary lookup or process
creation. Claude Code, Codex, Antigravity, Gemini, and provider-backed image
generation are not Breve execution paths.

Production dependencies are a separate deployment boundary. The committed
`defaults/bun.lock` is staged beside the managed runtime's `package.json`, and
Rotli runs a production-only frozen install before activation. A missing Bun
executable or any lockfile/install failure stops Breve startup with an explicit
error while the prior runtime remains active and complete. An old
`node_modules` directory is never accepted as proof that the pinned graph is
current. The root's Bun 1.4 policy mechanically holds this install to lockfile
v2, isolated project-local resolution, and disabled package lifecycle scripts;
the native/generated dependency smoke catches packages that cannot actually
operate under that policy. Bundling Bun itself remains separate future hardening.

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
idempotent owner warnings, plus the frozen dependency install. Tests never contact Signal, email, model providers,
or watcher targets; real delivery remains an explicitly authorized live check.
