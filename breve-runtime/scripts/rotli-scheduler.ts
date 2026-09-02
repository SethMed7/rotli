#!/usr/bin/env bun
/**
 * Rotli-owned Breve scheduler.
 *
 * One long-lived supervisor replaces all seven Breve launchd jobs. It polls the
 * canonical Rotli routine config, runs interval/daily jobs without overlap,
 * catches up one missed daily run after sleep, and keeps the Signal daemon
 * alive with bounded restart backoff. Durable state prevents duplicate sends
 * across Rotli restarts.
 */
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { BREVE, BRIEFS, CONFIG_PATH } from "./paths";
import { effectiveTz, minutesNowIn, todayIn } from "./timectx";
import {
  MAX_SLOT_ATTEMPTS,
  dailyDue,
  dailySlot,
  intervalDue,
  parseHm,
  schedulerParentGone,
  slotAttemptAllowed,
} from "./scheduler-core";
import { processIsAlive, tryAcquireProcessLock, type ProcessLock } from "./process-lock";

type DailySchedule = { kind: "dailyAt"; hhmm: string; leadMinutes: number };
type IntervalSchedule = { kind: "everySecs"; secs: number };
type AlwaysSchedule = { kind: "alwaysOn" };
type Routine = {
  id: string;
  kind: string;
  label: string;
  enabled: boolean;
  schedule: DailySchedule | IntervalSchedule | AlwaysSchedule;
  lanes: string[];
  /** User instructions (2026-07-31): required on custom routines, optional
   * extra instructions on the built-in briefs. Passed to jobs via env. */
  prompt?: string;
};
type Config = {
  timezone: string;
  deliveryTimes: { morning: string; lunch: string; night: string };
  leadMinutes: number;
  leadOverrides?: Partial<Record<"morning" | "lunch" | "night", number>>;
  travel?: { start: string; end: string; tz: string } | null;
  routines: Routine[];
};
type JobState = {
  lastStarted?: string;
  lastSlot?: string;
  pendingSlot?: string;
  lastFinished?: string;
  lastOk?: boolean;
  lastError?: string;
  /** Failed attempts at `pendingSlot`. A slot is retried a bounded number of
   * times, then left for the next slot — the old loop retried every five
   * minutes for the whole window and logged ~400 failures a day while the
   * writer was broken (audit 2026-09-02 §1.1). */
  attempts?: number;
};
type State = { version: 1; jobs: Record<string, JobState> };

const CONFIG = CONFIG_PATH;
const STATE = join(BREVE, "scheduler-state.json");
const LOG = join(BREVE, "logs", "rotli-scheduler.log");
const POLL_MS = 15_000;
const PARENT_POLL_MS = 2_000;
const LOCK_RETRY_MS = 2_000;
// New Rotli builds pass this explicitly. Falling back to the launch-time PPID
// lets an older Rotli supervisor pick up a synced runtime fix immediately.
const expectedParent = Number(process.env.ROTLI_PARENT_PID ?? process.ppid);
const running = new Map<string, Bun.Subprocess>();
let stopping = false;
let signalRestarts = 0;
let signalRetryAt = 0;
let saveChain: Promise<unknown> = Promise.resolve();
let schedulerLock: ProcessLock | null = null;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let parentTimer: ReturnType<typeof setInterval> | null = null;

mkdirSync(join(BREVE, "logs"), { recursive: true });
mkdirSync(BRIEFS, { recursive: true });

function log(message: string) {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(line);
  try {
    appendFileSync(LOG, `${line}\n`);
  } catch {}
}

async function readJson<T>(path: string): Promise<T | null> {
  return Bun.file(path)
    .json()
    .catch(() => null) as Promise<T | null>;
}

async function loadConfig(): Promise<Config | null> {
  const value = await readJson<Config>(CONFIG);
  return value && Array.isArray(value.routines) ? value : null;
}

async function loadState(): Promise<State> {
  const value = await readJson<State>(STATE);
  return value?.version === 1 && value.jobs ? value : { version: 1, jobs: {} };
}

async function saveState(state: State) {
  const bytes = `${JSON.stringify(state, null, 2)}\n`;
  const save = async () => {
    const temp = `${STATE}.${process.pid}.tmp`;
    await writeFile(temp, bytes);
    await rename(temp, STATE);
  };
  saveChain = saveChain.then(save, save);
  await saveChain;
}

function stemFor(routine: Routine, slot: string): string {
  return routine.id === "morning" ? slot : `${slot}-${routine.id}`;
}

async function verifyRun(
  routine: Routine,
  slot: string | undefined,
  code: number,
): Promise<string | undefined> {
  if (code !== 0) return `exit ${code}`;
  if (!slot || routine.schedule.kind !== "dailyAt") return undefined;
  const stem = stemFor(routine, slot);
  if (!(await Bun.file(join(BRIEFS, `${stem}.md`)).exists())) return `missing generated brief ${stem}.md`;
  for (const lane of ["signal", "email"] as const) {
    if (
      routine.lanes.includes(lane) &&
      !(await Bun.file(join(BREVE, "delivery-receipts", `${stem}.${lane}`)).exists())
    ) {
      return `missing ${lane} delivery receipt for ${stem}`;
    }
  }
  return undefined;
}

function commandFor(routine: Routine): string[] | null {
  switch (routine.id) {
    case "morning":
      return ["/bin/bash", join(BREVE, "scripts", "morning-brief.sh")];
    case "lunch":
      return ["/bin/bash", join(BREVE, "scripts", "lunch-brief.sh")];
    case "night":
      return ["/bin/bash", join(BREVE, "scripts", "night-brief.sh")];
    case "creators":
      return ["bun", join(BREVE, "scripts", "creator-alerts.ts")];
    case "watchers":
      return ["bun", join(BREVE, "scripts", "watcher-check.ts")];
    case "doctor":
      return ["bun", join(BREVE, "scripts", "breve-doctor.ts")];
    case "signal":
      return ["bun", join(BREVE, "scripts", "signal-daemon.ts")];
    default:
      // CUSTOM routines (2026-07-31): user-created, dispatched on KIND — the
      // routine's specifics (id/label/prompt/stem) ride the job env below.
      if (routine.kind === "brief") return ["/bin/bash", join(BREVE, "scripts", "custom-brief.sh")];
      if (routine.kind === "reminder") return ["bun", join(BREVE, "scripts", "reminder.ts")];
      return null;
  }
}

/** The user's brief-instructions override (rotli writes it beside the config;
 * it survives runtime syncs). Checked per JOB spawn so an edit applies within
 * one poll — no supervisor restart. */
function skillOverride(): string | undefined {
  const custom = join(dirname(CONFIG), "skill.custom.md");
  return existsSync(custom) ? custom : undefined;
}

async function runOne(routine: Routine, state: State, slot?: string) {
  if (running.has(routine.id)) return;
  const jobLock = tryAcquireProcessLock(BREVE, `job-${routine.id}`);
  if (!jobLock) {
    log(`[${routine.id}] skipped: another process owns the job lock`);
    return;
  }
  const command = commandFor(routine);
  if (!command) {
    jobLock.release();
    return;
  }
  const started = new Date().toISOString();
  try {
    const previous = state.jobs[routine.id] ?? {};
    state.jobs[routine.id] = {
      ...previous,
      lastStarted: started,
      ...(slot ? { pendingSlot: slot, attempts: previous.pendingSlot === slot ? previous.attempts ?? 0 : 0 } : {}),
      lastError: undefined,
    };
    await saveState(state);
    log(`[${routine.id}] start: ${command.join(" ")}`);
    const proc = Bun.spawn(command, {
      cwd: BREVE,
      env: {
        ...process.env,
        ROTLI_BREVE_HOME: BREVE,
        ROTLI_BREVE_CONFIG: CONFIG,
        ROTLI_BREVE_LANES: routine.lanes.join(","),
        ROTLI_SCHEDULED: "1",
        ROTLI_ROUTINE_ID: routine.id,
        ROTLI_ROUTINE_LABEL: routine.label,
        ROTLI_ROUTINE_PROMPT: routine.prompt ?? "",
        ROTLI_ROUTINE_STEM: slot ? stemFor(routine, slot) : "",
        ...(skillOverride() ? { ROTLI_BREVE_SKILL: skillOverride() } : {}),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    running.set(routine.id, proc);
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    running.delete(routine.id);
    const verificationError = await verifyRun(routine, slot, code);
    const error = verificationError
      ? `${verificationError}${stderr || stdout ? `: ${stderr || stdout}` : ""}`.slice(-1000)
      : undefined;
    const ok = !error;
    const attempts = ok ? 0 : (state.jobs[routine.id]?.attempts ?? 0) + 1;
    state.jobs[routine.id] = {
      ...state.jobs[routine.id],
      ...(ok && slot ? { lastSlot: slot, pendingSlot: undefined } : {}),
      ...(slot ? { attempts } : {}),
      lastFinished: new Date().toISOString(),
      lastOk: ok,
      lastError: error,
    };
    await saveState(state);
    const exhausted = !ok && slot && attempts >= MAX_SLOT_ATTEMPTS;
    log(
      `[${routine.id}] ${ok ? "complete" : "failed"}${error ? `: ${error.replace(/\s+/g, " ")}` : ""}${
        exhausted ? ` — giving up on slot ${slot} after ${attempts} attempts` : ""
      }`,
    );
  } finally {
    running.delete(routine.id);
    jobLock.release();
  }
}

function stopChild(id: string) {
  const proc = running.get(id);
  if (!proc) return;
  try {
    proc.kill("SIGTERM");
  } catch {}
  running.delete(id);
}

async function ensureSignal(routine: Routine | undefined, state: State) {
  if (!routine?.enabled || routine.schedule.kind !== "alwaysOn") {
    stopChild("signal");
    return;
  }
  if (running.has("signal") || Date.now() < signalRetryAt) return;
  const command = commandFor(routine)!;
  log("[signal] starting managed daemon");
  const proc = Bun.spawn(command, {
    cwd: BREVE,
    env: {
      ...process.env,
      ROTLI_BREVE_HOME: BREVE,
      ROTLI_BREVE_CONFIG: CONFIG,
      ROTLI_BREVE_LANES: routine.lanes.join(","),
      ROTLI_SCHEDULED: "0",
    },
    // Stream directly to the scheduler's Rotli-owned log. Holding a daemon's
    // pipe until exit would otherwise retain an unbounded lifetime of output.
    stdout: "inherit",
    stderr: "inherit",
  });
  running.set("signal", proc);
  state.jobs.signal = { ...state.jobs.signal, lastStarted: new Date().toISOString() };
  await saveState(state);
  void (async () => {
    const code = await proc.exited;
    if (running.get("signal") === proc) running.delete("signal");
    if (stopping) return;
    signalRestarts++;
    const delay = Math.min(60_000, 1000 * 2 ** Math.min(signalRestarts, 6));
    signalRetryAt = Date.now() + delay;
    state.jobs.signal = {
      ...state.jobs.signal,
      lastFinished: new Date().toISOString(),
      lastOk: code === 0,
      lastError: code === 0 ? undefined : `exit ${code}`,
    };
    await saveState(state);
    log(`[signal] exited ${code}; restart in ${Math.round(delay / 1000)}s`);
  })();
}

async function tick(state: State) {
  const config = await loadConfig();
  if (!config) {
    log(`config unavailable: ${CONFIG}`);
    return;
  }
  const tz = effectiveTz(config as Parameters<typeof effectiveTz>[0]);
  const today = todayIn(tz);
  const nowMinutes = minutesNowIn(tz);
  const now = Date.now();
  await ensureSignal(
    config.routines.find((r) => r.id === "signal"),
    state,
  );

  for (const routine of config.routines) {
    if (!routine.enabled || routine.id === "signal" || running.has(routine.id)) continue;
    const job = state.jobs[routine.id] ?? {};
    if (routine.schedule.kind === "dailyAt") {
      const lastAttempt = job.lastStarted ? Date.parse(job.lastStarted) : 0;
      if (Number.isFinite(lastAttempt) && now - lastAttempt < 5 * 60_000) continue;
      const delivery = parseHm(routine.schedule.hhmm);
      if (delivery == null) continue;
      const fire = (delivery - routine.schedule.leadMinutes + 1440) % 1440;
      const slot = dailySlot(today, nowMinutes, delivery, fire);
      if (job.lastSlot !== slot && (await verifyRun(routine, slot, 0)) === undefined) {
        state.jobs[routine.id] = {
          ...job,
          lastSlot: slot,
          pendingSlot: undefined,
          lastFinished: new Date().toISOString(),
          lastOk: true,
          lastError: undefined,
        };
        await saveState(state);
        log(`[${routine.id}] adopted completed slot ${slot}`);
        continue;
      }
      if (dailyDue(nowMinutes, fire, slot, job.lastSlot) && slotAttemptAllowed(job, slot)) {
        void runOne(routine, state, slot).catch((error) => log(`[${routine.id}] run error: ${error}`));
      }
    } else if (routine.schedule.kind === "everySecs") {
      if (!job.lastStarted) {
        state.jobs[routine.id] = { lastStarted: new Date().toISOString(), lastOk: true };
        await saveState(state);
      } else if (intervalDue(now, routine.schedule.secs, job.lastStarted)) {
        void runOne(routine, state).catch((error) => log(`[${routine.id}] run error: ${error}`));
      }
    }
  }
}

function parentIsGone(): boolean {
  return schedulerParentGone(expectedParent, process.ppid, processIsAlive);
}

function stop(terminateGroup = false) {
  if (stopping) return;
  stopping = true;
  if (tickTimer) clearInterval(tickTimer);
  if (parentTimer) clearInterval(parentTimer);
  for (const id of [...running.keys()]) stopChild(id);
  // On owner death, leave the lock record in place until this PID exits. A
  // standby can then recover it as stale without overlapping the old group.
  if (!terminateGroup) schedulerLock?.release();
  schedulerLock = null;
  log(
    terminateGroup ? "Rotli scheduler owner disappeared; stopping process group" : "Rotli scheduler stopped",
  );
  if (terminateGroup) {
    // The scheduler is the group leader. This also reaches grandchildren of
    // shell jobs that a direct Child.kill cannot reliably reap.
    try {
      process.kill(-process.pid, "SIGTERM");
    } catch {}
  }
  setTimeout(() => process.exit(0), 250);
}

async function waitForSchedulerLock(): Promise<ProcessLock | null> {
  let announced = false;
  while (!stopping) {
    const lock = tryAcquireProcessLock(BREVE, "scheduler");
    if (lock) return lock;
    if (!announced) {
      log("another Breve scheduler owns the singleton lock; standing by");
      announced = true;
    }
    if (parentIsGone()) return null;
    await Bun.sleep(LOCK_RETRY_MS);
  }
  return null;
}

async function main() {
  process.on("SIGINT", () => stop());
  process.on("SIGTERM", () => stop());
  parentTimer = setInterval(() => {
    if (parentIsGone()) stop(true);
  }, PARENT_POLL_MS);

  schedulerLock = await waitForSchedulerLock();
  if (!schedulerLock || stopping || parentIsGone()) {
    stop(parentIsGone());
    return;
  }

  // Load only after winning the singleton so a standby process never carries
  // stale state into a later takeover.
  const state = await loadState();
  log(`Rotli scheduler online; config=${CONFIG}`);
  await tick(state);
  tickTimer = setInterval(() => void tick(state).catch((e) => log(`tick error: ${e}`)), POLL_MS);
}

if (import.meta.main)
  void main().catch((e) => {
    log(`fatal: ${e}`);
    process.exit(1);
  });
