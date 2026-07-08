// The routines engine — the pure job dispatch behind the Bun sidecar that rotli's
// Rust shell spawns per scheduled job (breve-merge.md §4, §9 P0). At P0 every
// handler is a STUB: it proves the job → result contract end to end without any of
// Breve's real generation or delivery yet (those land in P1–P4). Pure and IO-free,
// so it unit-tests directly; the thin Bun entry (engine.entry.ts) is the only
// process/IO glue.

import type { RoutineKind } from "./types";

/** A job the Rust scheduler hands the sidecar. `params` is kind-specific (e.g. a
 * brief's `{ briefKind }`) — kept open at P0. */
export interface RoutineJob {
  id: string;
  kind: RoutineKind;
  params?: Record<string, unknown>;
}

/** What the sidecar returns for one job. `artifacts` are the memex paths / note
 * ids the job produced (always empty at P0 — nothing is generated yet). */
export interface RoutineResult {
  ok: boolean;
  /** Echoes the requested kind; `"unknown"` for a malformed/kind-less descriptor
   * (a plain string, not `RoutineKind`, so a bad wire value is representable and
   * the Rust decoder always sees a `kind`). */
  kind: string;
  artifacts: string[];
  log: string;
  error?: string;
}

type Handler = (job: RoutineJob) => RoutineResult | Promise<RoutineResult>;

const stub = (kind: RoutineKind, note: string): RoutineResult => ({
  ok: true,
  kind,
  artifacts: [],
  log: `[P0 stub] would ${note}`,
});

/** One handler per RoutineKind. At P0 they only DESCRIBE what the real subsystem
 * will do — no generation, no delivery, no IO (breve-merge.md §2.1). */
const HANDLERS: Record<RoutineKind, Handler> = {
  brief: (job) => stub("brief", `generate the ${String(job.params?.briefKind ?? "morning")} brief`),
  creators: () => stub("creators", "check watched creators for new posts"),
  watchers: () => stub("watchers", "check watched pages for changes"),
  doctor: () => stub("doctor", "run the self-heal health check"),
  signal: () => stub("signal", "service the Signal listener tick"),
};

/** Run one routine job, never throwing: an unknown kind or a handler error comes
 * back as `{ ok: false, error }` so the Rust side always gets a parseable result.
 * `job.kind` is typed `RoutineKind`, but a malformed descriptor can arrive over
 * the wire, so the lookup is guarded. */
export async function runJob(job: RoutineJob): Promise<RoutineResult> {
  // A malformed descriptor can arrive over the wire — `null`, a primitive, or a
  // kind-less object. Never throw, and ALWAYS emit a `kind` string, so the Rust
  // side can always decode the result (guarding job.kind BEFORE the try, since
  // reading it off `null` would itself throw).
  const valid = !!job && typeof job === "object";
  const kind = valid && typeof job.kind === "string" ? job.kind : "unknown";
  const handler = (valid ? HANDLERS[job.kind] : undefined) as Handler | undefined;
  if (!handler) {
    return { ok: false, kind, artifacts: [], log: "", error: `unknown routine kind: ${kind}` };
  }
  try {
    return await handler(job);
  } catch (e) {
    return { ok: false, kind, artifacts: [], log: "", error: e instanceof Error ? e.message : String(e) };
  }
}
