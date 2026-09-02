// Breve wire types — the shapes `breve_*` commands exchange with the app,
// mirrored from src-tauri/src/breve.rs (and breve_pdf.rs / breve_health.rs).
// Pure declarations, no imports: the adapter (lib/tauri.ts) re-exports them,
// and the routines models import them without touching the adapter.

/** `rotli` = match the app theme (the default since 2026-09-02): the main
 * window writes its live tokens into `resolved` on every appearance change. */
export type BrevePdfThemePreset = "rotli" | "charcoal" | "warmLight" | "warmDark" | "paper" | "custom";

export interface BrevePdfPalette {
  background: string;
  surface: string;
  text: string;
  muted: string;
  accent: string;
  rule: string;
}

export interface BrevePdfTheme {
  preset: BrevePdfThemePreset;
  custom: BrevePdfPalette;
  /** The app theme's six tokens as last synced by the main window; what the
   * `rotli` preset renders with. Absent until the first sync. */
  resolved?: BrevePdfPalette;
}

/** One routine's last scheduler outcome (from the supervisor's job ledger). */
export interface BreveRoutineHealth {
  id: string;
  lastOk?: boolean;
  lastSlot?: string;
  pendingSlot?: string;
  lastStarted?: string;
  lastFinished?: string;
  lastError?: string;
}

export interface BreveConfig {
  version: 1;
  timezone: string;
  deliveryTimes: { morning: string; lunch: string; night: string };
  leadMinutes: number;
  leadOverrides: { morning?: number; lunch?: number; night?: number };
  briefModel: string;
  modelPolicy: {
    primary: string;
    fallbacks: string[];
    localHelper: string | null;
  };
  pdfTheme: BrevePdfTheme;
  routines: BreveRoutine[];
  travel?: { start: string; end: string; tz: string } | null;
}

export interface BreveBrief {
  stem: string;
  title: string;
  /** "morning" | "lunch" | "night" for the slots; a custom routine's briefs
   * carry its slug (2026-07-31). */
  kind: string;
  date: string;
  imported: boolean;
  path?: string;
  /** Vault-relative path of the spoken version (storage/breveAudios/<stem>.mp3)
   * when the runtime produced one — the reader shows a player. */
  audioPath?: string;
}

export interface BreveNotification {
  id: string;
  at: string;
  routine?: string;
  kind: "running" | "success" | "warning" | "info";
  title: string;
  detail: string;
}

export interface BreveSnapshot {
  source: "rotli" | "legacy" | "empty";
  legacyRoot: string | null;
  config: BreveConfig;
  watchlist: string;
  counts: { sections: number; topics: number; creators: number; pages: number };
  creators: Array<{ name: string; handle: string; channelId?: string }>;
  pages: Array<{ id: number; url: string; condition: string }>;
  briefs: BreveBrief[];
  /** Sanitized projection of the current vault's recent scheduler log. Raw
   * commands, paths, prompts, and stderr never cross IPC. */
  notifications: BreveNotification[];
  artifactCount: number;
  imported: boolean;
  scheduler: "rotli" | "legacy-launchd" | "none";
  /** Per-routine last outcome; empty until Rotli manages this vault. */
  health: BreveRoutineHealth[];
}

export interface BreveBackfillResult {
  snapshot: BreveSnapshot;
  status: "preview" | "complete";
  message: string;
}

export interface BreveDeliverySettings {
  emailFrom: string;
  emailTo: string[];
  signalBot: string;
  signalOwner: string;
  signalOwnerUuid: string;
  resendKeyConfigured: boolean;
}

export interface BreveRoutine {
  id: string;
  label: string;
  /** Built-ins use the five job kinds; CUSTOM routines (2026-07-31) are a
   * "brief" (scheduled custom-prompt research) or a "reminder". */
  kind: "brief" | "creators" | "watchers" | "doctor" | "signal" | "reminder";
  enabled: boolean;
  schedule: BreveRoutineSchedule;
  lanes: string[];
  /** User instructions: required on custom routines, optional extra
   * instructions on the built-in briefs. */
  prompt?: string;
}

export type BreveRoutineSchedule =
  | { kind: "dailyAt"; hhmm: string; leadMinutes: number }
  | { kind: "everySecs"; secs: number }
  | { kind: "alwaysOn" };
