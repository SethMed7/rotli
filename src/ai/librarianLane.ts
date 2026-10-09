// Which connected clients the Librarian may file through, and what to offer
// on setup's Librarian screen and in Settings. Pure; the Rust twin is
// organizer_knobs::LIBRARIAN_LANES (byte-identical id list).

import type { ChatModelInfo, CliDetect } from "../lib/tauri";
import { currentDiscovery, type DiscoveryLanes } from "../state/connectedModels";
import { endpointIsLocal } from "./guard";
import { type ProviderId, modelLabel, providerDefaultModel, resolveLaneModel } from "./models";

/** Cursor is a read-only code-chat lane and never takes part in background work. */
export const LIBRARIAN_LANES = ["claude", "codex", "antigravity"] as const satisfies readonly ProviderId[];
export type LibrarianLane = (typeof LIBRARIAN_LANES)[number];
export type LibrarianChoice = "local" | LibrarianLane;
/** The persisted `organizerModel` knob: this Mac or a lane. Junk and legacy
 * ids coerce to `local` (asEnum); Rust also requires the lane to be on. */
export type OrganizerModel = LibrarianChoice;
export const ORGANIZER_MODELS: readonly OrganizerModel[] = ["local", ...LIBRARIAN_LANES];

/** A Librarian-specific model id is kept only when it belongs to the chosen
 * lane's catalog (the client's live list once it has answered); anything else
 * (or a local lane) is null. */
export function librarianModelId(
  lane: LibrarianChoice,
  id: unknown,
  lanes: DiscoveryLanes = currentDiscovery(),
): string | null {
  if (lane === "local" || typeof id !== "string") return null;
  return resolveLaneModel(lane, id, lanes);
}

/** The model the Librarian asks: its own choice when valid, else the lane's
 * chat default. Rust resolves the same way (organizer_knobs::connected_lane). */
export function librarianModelFor(
  lane: LibrarianLane,
  ownId: string | null,
  providerDefaults: Readonly<Partial<Record<ProviderId, string>>>,
  lanes: DiscoveryLanes = currentDiscovery(),
): string {
  return librarianModelId(lane, ownId, lanes) ?? providerDefaultModel(lane, providerDefaults, lanes);
}

export const LIBRARIAN_LABELS: Record<LibrarianChoice, string> = {
  local: "On this Mac",
  claude: "Claude",
  codex: "ChatGPT",
  antigravity: "Gemini",
};

export function isLibrarianLane(value: string): value is LibrarianLane {
  return (LIBRARIAN_LANES as readonly string[]).includes(value);
}

const ready = (detection: CliDetect | undefined): boolean =>
  !!detection?.installed && detection.authenticated;

/** How far this Mac is with one lane. Every lane is offered either way (the
 * owner, 2026-10-02: people still choose when nothing is set up yet, and the
 * sidebar's Librarian helps them finish). */
export type LaneStatus = "checking" | "ready" | "no-model" | "not-installed" | "signed-out";

/** What this Mac has: its local models once listed, and each client's probe. */
export interface LaneEvidence {
  detections: Partial<Record<ProviderId, CliDetect>>;
  local: readonly Pick<ChatModelInfo, "endpoint" | "registered">[];
  localChecked: boolean;
}

export function librarianLaneStatus(lane: LibrarianChoice, evidence: LaneEvidence): LaneStatus {
  if (lane === "local") {
    if (!evidence.localChecked) return "checking";
    // an installed on-device model, not Rust's built-in fallback
    const installed = evidence.local.some(
      (model) => model.registered === true && endpointIsLocal(model.endpoint),
    );
    return installed ? "ready" : "no-model";
  }
  const detection = evidence.detections[lane];
  if (!detection) return "checking";
  if (!detection.installed) return "not-installed";
  return detection.authenticated ? "ready" : "signed-out";
}

export const LANE_STATUS_LABELS: Record<LaneStatus, string> = {
  checking: "Checking…",
  ready: "Ready",
  "no-model": "No model yet",
  "not-installed": "Not installed",
  "signed-out": "Not signed in",
};

/** What's left before the Librarian can work through this lane, or null when
 * nothing is (or it's still being checked). */
export function librarianSetupStep(lane: LibrarianChoice, status: LaneStatus): string | null {
  if (status === "ready" || status === "checking") return null;
  if (lane === "local")
    return "Add a local model in Settings → AI Models, and the Librarian files on this Mac.";
  const label = LIBRARIAN_LABELS[lane];
  return status === "signed-out"
    ? `Sign in to ${label} on this Mac (Settings → AI Models shows how), and the Librarian files through it.`
    : `Install ${label}'s official app (Settings → AI Models shows how), and the Librarian files through it.`;
}

/** The default the Librarian screen proposes: Gemini when it is signed in on this
 * Mac (the maintainer's preference), else whatever is chosen already. */
export function suggestedLibrarian(
  detections: Partial<Record<ProviderId, CliDetect>>,
  current: LibrarianChoice,
  setup: { chosen: boolean } = { chosen: false },
): LibrarianChoice {
  // a pick the person made, or a suggestion already made once, stands
  if (setup.chosen) return current;
  return current === "local" && ready(detections.antigravity) ? "antigravity" : current;
}

/** The one-sentence consequence of a choice, honest about the lane switch. */
export function librarianCaption(choice: LibrarianChoice, laneOn: boolean): string {
  if (choice === "local") {
    return "A local model on this Mac organizes — note content never enters a cloud-model provider.";
  }
  const label = LIBRARIAN_LABELS[choice];
  return laneOn
    ? `${label} files your notes through its official local client on the Librarian's own schedule. Secure and locked notes never leave this Mac.`
    : `${label} is chosen but turned off in Connections, so the Librarian files on this Mac until you turn it on.`;
}

/** A journal row's `filed_by` for people: "claude:sonnet" → "Claude · Claude Sonnet 5";
 * a bare local model id is shown as recorded. */
export function describeFiledBy(model: string): string {
  const colon = model.indexOf(":");
  if (colon < 0) return model;
  const lane = model.slice(0, colon);
  const id = model.slice(colon + 1);
  if (!isLibrarianLane(lane)) return model;
  const label = modelLabel(id, [], []);
  return `${LIBRARIAN_LABELS[lane]} · ${label}`;
}

/** The stamp on an Activity row: the time, plus who filed it when known. */
export function filedStamp(when: string, model?: string): string {
  return model ? `${when} · ${describeFiledBy(model)}` : when;
}
