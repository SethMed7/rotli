// Routines — the scheduled jobs rotli inherits from Breve (briefs, creator/page
// watchers, the self-heal "doctor", and the always-on Signal listener). Only the
// pure scheduling shape lives here; the routine record itself is the Tauri
// adapter's contract type (BreveRoutine* in src/lib/tauri.ts), so this file does
// not keep a second, drifting mirror of it.
//
// The live supervisor/runtime lives in src-tauri/src/routines.rs and
// breve-runtime/scripts/rotli-scheduler.ts.

/**
 * When a routine fires.
 * - `dailyAt` — a wall-clock delivery time (`hhmm`, 24h "HH:MM") with a
 *   `leadMinutes` head-start: generation FIRES `leadMinutes` before the delivery
 *   time (Breve generates the morning brief ~06:00 to deliver 07:00). So the
 *   fire moment = the delivery time minus the lead.
 * - `everySecs` — a fixed cadence (watchers/creators/doctor); the next fire is
 *   simply `now + secs`.
 */
export type Schedule =
  | { kind: "dailyAt"; hhmm: string; leadMinutes: number }
  | { kind: "everySecs"; secs: number };
