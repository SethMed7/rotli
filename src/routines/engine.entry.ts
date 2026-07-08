// The routines-engine sidecar entry (P0 skeleton). rotli's Rust shell (routines.rs)
// spawns this under Bun once per job: the job descriptor arrives as argv[2] (a JSON
// string), we run it, and print the RoutineResult as JSON on stdout — the ONLY
// thing on stdout, since Rust parses the whole payload. Exit 0 when the job is ok,
// 1 otherwise. Keep this glue thin; all real logic lives in engine.ts (unit-tested).
//
// Not part of the test run (not a *.test.ts) and not imported by the frontend — it
// is a Bun process entry, mirroring how rotli already shells out to bun for
// validate.ts (src-tauri/src/memex.rs).

import { runJob, type RoutineJob } from "./engine";

/** Emit a JSON failure and exit — used before we have a real RoutineResult. */
function fail(error: string): never {
  process.stdout.write(JSON.stringify({ ok: false, kind: "unknown", artifacts: [], log: "", error }));
  process.exit(1);
}

async function main(): Promise<void> {
  const raw = process.argv[2];
  if (!raw) fail("no job descriptor (expected JSON in argv[2])");

  let job: RoutineJob;
  try {
    job = JSON.parse(raw) as RoutineJob;
  } catch {
    fail("job descriptor is not valid JSON");
  }

  const result = await runJob(job);
  process.stdout.write(JSON.stringify(result));
  process.exit(result.ok ? 0 : 1);
}

void main();
