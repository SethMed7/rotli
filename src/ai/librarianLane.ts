// Which connected clients the Librarian may file through, and what to offer
// on the Models step and in Settings. Pure; the Rust twin is
// organizer_knobs::LIBRARIAN_LANES (byte-identical id list).

import type { CliDetect } from "../lib/tauri";
import { currentDiscovery, type DiscoveryLanes } from "../state/connectedModels";
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

/** The lanes worth offering: local always, then every client that is installed
 * and signed in. A lane the user already chose stays listed even if its client
 * went missing, so the picker never hides the current value. */
export function librarianOptions(
  detections: Partial<Record<ProviderId, CliDetect>>,
  current: LibrarianChoice,
): LibrarianChoice[] {
  const offered: LibrarianChoice[] = ["local"];
  for (const lane of LIBRARIAN_LANES) if (ready(detections[lane]) || lane === current) offered.push(lane);
  return offered;
}

/** The default the Models step proposes: Gemini when it is signed in on this
 * Mac (the maintainer's preference), else whatever is chosen already. */
export function suggestedLibrarian(
  detections: Partial<Record<ProviderId, CliDetect>>,
  current: LibrarianChoice,
): LibrarianChoice {
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
