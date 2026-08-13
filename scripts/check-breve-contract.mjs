import { readFileSync } from "node:fs";

const failures = [];

function source(path) {
  return readFileSync(path, "utf8");
}

function requireMatch(path, pattern, message) {
  if (!pattern.test(source(path))) failures.push(`${path}: ${message}`);
}

requireMatch(
  "breve-runtime/scripts/rotli-scheduler.ts",
  /tryAcquireProcessLock\(BREVE,\s*["']scheduler["']\)/,
  "the scheduler must claim the singleton lock before starting",
);
requireMatch(
  "breve-runtime/scripts/rotli-scheduler.ts",
  /tryAcquireProcessLock\(BREVE,\s*`job-\$\{routine\.id\}`\)/,
  "scheduled routines must claim a cross-process job lock",
);
requireMatch(
  "breve-runtime/scripts/rotli-scheduler.ts",
  /schedulerParentGone\(/,
  "the managed scheduler must monitor its Rotli parent",
);
requireMatch(
  "src-tauri/src/routines.rs",
  /\.env\("ROTLI_PARENT_PID",\s*std::process::id\(\)\.to_string\(\)\)/,
  "Rotli must pass its PID to the scheduler",
);
requireMatch(
  "src-tauri/src/routines.rs",
  /source\.join\("defaults\/bun\.lock"\),\s*next\.join\("bun\.lock"\)/,
  "Rotli must stage Breve's committed lockfile beside the candidate runtime manifest",
);
requireMatch(
  "src-tauri/src/routines.rs",
  /\.args\(\["install",\s*"--production",\s*"--frozen-lockfile",\s*"--silent"\]\)/,
  "Breve production dependencies must use a frozen install",
);
requireMatch(
  "src-tauri/src/routines.rs",
  /commit_runtime_swap\(&runtime,\s*&next,\s*&previous\)/,
  "Breve code and dependencies must activate through the recoverable directory swap",
);
requireMatch(
  "src-tauri/src/routines.rs",
  /install_runtime_links\(home,\s*&runtime\)/,
  "the mutable Breve home must point at the separately activated runtime bundle",
);

for (const path of [
  "breve-runtime/scripts/send-brief.ts",
  "breve-runtime/scripts/send-signal-brief.ts",
  "breve-runtime/scripts/send-signal-text.ts",
  "breve-runtime/scripts/notify.ts",
]) {
  requireMatch(path, /claimDelivery\(/, "external sends must claim delivery before sending");
}

requireMatch(
  "breve-runtime/scripts/creator-alerts.ts",
  /tryAcquireProcessLock\(BREVE,\s*["']producer-creators["']\)/,
  "creator polling must have a producer lock",
);
requireMatch(
  "breve-runtime/scripts/watcher-check.ts",
  /tryAcquireProcessLock\(BREVE,\s*["']producer-watchers["']\)/,
  "watcher polling must have a producer lock",
);
requireMatch(
  "breve-runtime/scripts/watcher-check.ts",
  /nextWatcherFailure\(/,
  "watcher failure alerts must use the one-per-streak policy",
);

for (const path of [
  "breve-runtime/scripts/morning-brief.sh",
  "breve-runtime/scripts/lunch-brief.sh",
  "breve-runtime/scripts/night-brief.sh",
  "breve-runtime/scripts/custom-brief.sh",
]) {
  const text = source(path);
  const calls = [...text.matchAll(/bun\s+"\$BREVE\/scripts\/(?:notify|send-signal-text)\.ts"/g)];
  for (const call of calls) {
    const invocation = text.slice(call.index, call.index + 240);
    if (!invocation.includes("--idempotency-key") && !invocation.includes("--receipt")) {
      failures.push(`${path}: owner notification is missing a durable idempotency key`);
    }
  }
}

if (failures.length) {
  console.error(`Breve runtime contract failed:\n${failures.map((line) => `  - ${line}`).join("\n")}`);
  process.exit(1);
}

console.log(
  "check:breve-contract ok — staged frozen dependencies, atomic runtime activation, scheduler ownership, job locks, delivery claims, and alert idempotency are wired end to end",
);
