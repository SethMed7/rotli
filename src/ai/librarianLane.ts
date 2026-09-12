// Which connected clients the Librarian may file through, and what to offer
// on the Models step and in Settings. Pure; the Rust twin is
// organizer_knobs::LIBRARIAN_LANES (byte-identical id list).

import type { CliDetect } from "../lib/tauri";
import type { ProviderId } from "./models";

/** Cursor is a read-only code-chat lane and never takes part in background work. */
export const LIBRARIAN_LANES = ["claude", "codex", "antigravity"] as const satisfies readonly ProviderId[];
export type LibrarianLane = (typeof LIBRARIAN_LANES)[number];
export type LibrarianChoice = "local" | LibrarianLane;

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
