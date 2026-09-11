// The remote-agent relay adapter seam for presentation: the five shell
// commands plus the one status-cache refresh. Development builds only (feature
// policy `agents`); stable builds refuse every command below.
import {
  type RemoteAgentPairing,
  isTauri,
  remoteAgentPair,
  remoteAgentStart,
  remoteAgentStatus,
  remoteAgentStop,
  remoteAgentUnpair,
} from "../lib/tauri";
import { queryClient } from "./query";

export type { RemoteAgentPairing };
export { remoteAgentPair, remoteAgentStart, remoteAgentStatus, remoteAgentStop, remoteAgentUnpair };

/** Pairing and connecting exist only in the native Mac app. */
export const remoteAgentsNative = (): boolean => isTauri();

export const REMOTE_AGENT_STATUS_KEY = ["remote-agent-status"] as const;

export function invalidateRemoteAgentStatus(): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: REMOTE_AGENT_STATUS_KEY });
}
