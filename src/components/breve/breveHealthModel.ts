// Breve's health, derived from the snapshot — never stored. The scheduler's
// job ledger says what each routine last did; this reduces it to the one
// sentence the sidebar, the Today page, and the Routines banner all show, so
// seventeen days of "missing generated brief" can never again hide behind
// "Managed by Rotli" (audit 2026-09-02 §1.1).

import type { BreveRoutineHealth, BreveSnapshot } from "../../routines/briefs";

export type BreveHealthLevel = "ok" | "warn" | "off";

export interface BreveHealthSummary {
  level: BreveHealthLevel;
  /** Short status for the sidebar rail. */
  label: string;
  /** One sentence for the Today page and the Routines banner. */
  detail: string;
  /** Routines whose last run failed, in config order. */
  failing: BreveRoutineHealth[];
  /** Days since the newest readable brief; null when there is none. */
  daysSinceBrief: number | null;
}

const DAY_MS = 86_400_000;

/** The rail-status vocabulary, exported so tests and callers never restate it. */
export const HEALTH_LABELS = {
  managed: "Managed by Rotli",
  legacy: "Legacy scheduler active",
  unconfigured: "Not configured",
  unscheduled: "Not scheduled",
  failing: "Briefs failing",
} as const;

function daysBetween(dateIso: string, nowMs: number): number | null {
  const then = Date.parse(`${dateIso.slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(then)) return null;
  return Math.max(0, Math.floor((nowMs - then) / DAY_MS));
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

/** Trim the scheduler's reason to something a person can act on. */
export function healthReason(error: string | undefined): string {
  if (!error) return "";
  const first = error.split(/[:\n]/)[0]?.trim() ?? "";
  return first.length > 96 ? `${first.slice(0, 95)}…` : first;
}

export function breveHealthSummary(snapshot: BreveSnapshot, nowMs: number): BreveHealthSummary {
  const newest = snapshot.briefs.find((brief) => brief.path)?.date ?? null;
  const daysSinceBrief = newest ? daysBetween(newest, nowMs) : null;
  if (snapshot.scheduler !== "rotli") {
    return {
      level: "off",
      label:
        snapshot.scheduler === "legacy-launchd"
          ? HEALTH_LABELS.legacy
          : snapshot.source === "empty"
            ? HEALTH_LABELS.unconfigured
            : HEALTH_LABELS.unscheduled,
      detail:
        snapshot.scheduler === "legacy-launchd"
          ? "The previous Breve scheduler is still in charge. Changes are preserved here, but Rotli does not deliver scheduled briefs yet."
          : "Rotli stores these routines, but its delivery scheduler is not active in this vault yet.",
      failing: [],
      daysSinceBrief,
    };
  }
  const enabled = new Set(snapshot.config.routines.filter((r) => r.enabled).map((r) => r.id));
  const failing = snapshot.health.filter((job) => enabled.has(job.id) && job.lastOk === false);
  const briefFailing = failing.filter((job) =>
    snapshot.config.routines.some((r) => r.id === job.id && r.kind === "brief"),
  );
  if (briefFailing.length) {
    const reason = healthReason(briefFailing[0]?.lastError);
    const since =
      daysSinceBrief === null ? "No brief has landed yet" : `No brief for ${plural(daysSinceBrief, "day")}`;
    const names = briefFailing.map((job) => job.id).join(", ");
    return {
      level: "warn",
      label:
        daysSinceBrief === null ? HEALTH_LABELS.failing : `No brief for ${plural(daysSinceBrief, "day")}`,
      detail: `${since} — ${names} ${briefFailing.length === 1 ? "is" : "are"} failing${reason ? `: ${reason}` : ""}. Fix the writer, then the next slot retries on its own.`,
      failing,
      daysSinceBrief,
    };
  }
  if (failing.length) {
    const reason = healthReason(failing[0]?.lastError);
    return {
      level: "warn",
      label: `${failing.map((job) => job.id).join(", ")} failing`,
      detail: `Briefs are arriving, but ${failing.map((job) => job.id).join(", ")} failed last time${reason ? `: ${reason}` : ""}.`,
      failing,
      daysSinceBrief,
    };
  }
  return {
    level: "ok",
    label: HEALTH_LABELS.managed,
    detail:
      "Rotli is actively managing these routines and the always-on Signal assistant. Saved changes are adopted automatically.",
    failing,
    daysSinceBrief,
  };
}
