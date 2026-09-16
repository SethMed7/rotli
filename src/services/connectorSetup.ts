// The connector walkthrough's one question of the machine: is this tool
// installed and signed in? Presentation asks through here; only the desktop
// shell can look, so on the web the question is never asked and the guide
// shows every step undone.

import { type CliDetect, cliDetect, isTauri } from "../lib/tauri";

export type { CliDetect };

/** Whether Rotli can look at the user's machine for a connector at all. */
export function canDetectConnectors(): boolean {
  return isTauri();
}

/** The shared detection query for one lane (same key as Settings → AI Models). */
export function connectorDetectionQuery(lane: string): {
  queryKey: readonly ["cli-detect", string];
  queryFn: () => Promise<CliDetect>;
  enabled: boolean;
  staleTime: number;
} {
  return {
    queryKey: ["cli-detect", lane] as const,
    queryFn: () => cliDetect(lane),
    enabled: isTauri(),
    staleTime: 60_000,
  };
}
