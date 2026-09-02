import { DEFAULT_BREVE_PDF_THEME } from "../brand/brevePdfThemes";
import type { BreveBrief, BreveConfig, BreveRoutine, BreveSnapshot } from "../lib/tauri";
import { nextRun } from "./schedule";

/** The wire shapes Breve's presentation models reason about, re-exported so
 * a pure model (health, dashboard digest) never imports the adapter itself. */
export type { BreveRoutineHealth, BreveSnapshot } from "../lib/tauri";

export const EMPTY_BREVE_CONFIG: BreveConfig = {
  version: 1,
  timezone: "America/New_York",
  deliveryTimes: { morning: "07:00", lunch: "12:00", night: "18:00" },
  leadMinutes: 30,
  leadOverrides: { morning: 60 },
  briefModel: "gemma-3-12b-it-qat-4bit",
  modelPolicy: {
    primary: "gemma-3-12b-it-qat-4bit",
    fallbacks: [],
    localHelper: "gemma-3-12b-it-qat-4bit",
  },
  pdfTheme: DEFAULT_BREVE_PDF_THEME,
  routines: [],
};

export const EMPTY_BREVE_SNAPSHOT: BreveSnapshot = {
  source: "empty",
  legacyRoot: null,
  config: EMPTY_BREVE_CONFIG,
  watchlist: "",
  counts: { sections: 0, topics: 0, creators: 0, pages: 0 },
  creators: [],
  pages: [],
  briefs: [],
  notifications: [],
  artifactCount: 0,
  imported: false,
  scheduler: "none",
  health: [],
};

/** A stable display order independent of filesystem enumeration. */
export function sortBriefs(briefs: readonly BreveBrief[]): BreveBrief[] {
  // custom-routine briefs (any other kind) sort after the three slots, by name
  const kindOrder: Record<string, number> = { morning: 0, lunch: 1, night: 2 };
  return [...briefs].sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      (kindOrder[a.kind] ?? 3) - (kindOrder[b.kind] ?? 3) ||
      a.kind.localeCompare(b.kind),
  );
}

export function nextRoutineEpoch(routine: BreveRoutine, nowMs: number, timezone: string): number | null {
  if (!routine.enabled || routine.schedule.kind === "alwaysOn") return null;
  try {
    return nextRun(routine.schedule, nowMs, timezone);
  } catch {
    return null;
  }
}

export function formatNextRoutine(routine: BreveRoutine, nowMs: number, timezone: string): string {
  if (!routine.enabled) return "Off";
  if (routine.schedule.kind === "alwaysOn") return "Always on";
  const epoch = nextRoutineEpoch(routine, nowMs, timezone);
  if (epoch === null) return "Schedule needs attention";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(epoch));
}

export function modelPolicyOptions(current: BreveConfig, available: readonly string[]): string[] {
  const all = [
    current.modelPolicy.primary,
    ...current.modelPolicy.fallbacks,
    current.modelPolicy.localHelper ?? "",
    current.briefModel,
    ...available,
  ].filter(Boolean);
  return [...new Set(all)];
}
