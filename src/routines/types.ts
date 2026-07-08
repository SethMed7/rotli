// Routines — the scheduled jobs rotli inherits from Breve (briefs, creator/page
// watchers, the self-heal "doctor", and the always-on Signal listener). These
// are PURE type shapes for the P0 foundation: the scheduler (P1) and the Bun
// routines-engine sidecar consume them; nothing here touches the clock or IO.
//
// Design notes are in memex-vault wiki/projects/rotli/breve-merge.md §4 (scheduler) and §9 (P0).

/** Which Breve subsystem a routine drives. */
export type RoutineKind = "brief" | "creators" | "watchers" | "doctor" | "signal";

/** The three daily brief drops (verbatim from Breve — see breve-merge.md §2.1). */
export type BriefKind = "morning" | "lunch" | "night";

/**
 * Delivery lanes a routine may use. Opt-in + detected like the AI-Model lanes
 * (breve-merge.md §11.3); `inApp` is always available (the brief becomes a memex
 * note regardless).
 */
export type Lane = "signal" | "email" | "inApp";

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

/** One scheduled job. */
export interface Routine {
  id: string;
  kind: RoutineKind;
  schedule: Schedule;
  lanes: Lane[];
  enabled: boolean;
}
