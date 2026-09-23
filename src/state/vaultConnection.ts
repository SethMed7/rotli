// Rotli Web's vault connection: the ONE answer to "may the editor run?".
// Only `connected` mounts notes; every other state is a setup or reconnect
// screen, never a stand-in vault (2026-09-22, the owner: a vault is required,
// and a lost connection must not quietly land notes somewhere else).

import { create } from "zustand";

export type VaultConnection =
  /** A real folder, read and written live. */
  | { status: "connected"; via: "folder" | "helper"; name: string }
  /** Chromium remembers the folder but asks once more before reading it. */
  | { status: "needs-permission"; name: string }
  /** Paired, but Rotli Helper doesn't answer on this computer. */
  | { status: "helper-offline"; name: string | null }
  /** The helper answers but refuses this browser's pairing token. */
  | { status: "helper-refused"; name: string | null }
  /** A helper from before it could serve a vault. */
  | { status: "helper-outdated"; name: string | null }
  /** The helper is running and paired, but serves no vault yet. */
  | { status: "helper-no-vault" }
  /** The helper now serves a different vault than this browser opened. */
  | { status: "vault-mismatch"; expected: string; served: string }
  /** Nothing chosen on this browser yet: first-run setup. */
  | { status: "unbound" }
  /** No way to reach a folder from this browser (Safari, phones). */
  | { status: "unsupported"; browser: string };

interface VaultConnectionState {
  connection: VaultConnection;
  /** Connected, but the helper stopped answering mid-session: edits wait,
   * unsaved, until it is back (the overlay says so). */
  reconnecting: boolean;
  setConnection: (connection: VaultConnection) => void;
  setReconnecting: (reconnecting: boolean) => void;
}

export const useVaultConnection = create<VaultConnectionState>((set) => ({
  connection: { status: "unbound" },
  reconnecting: false,
  setConnection: (connection) => set({ connection }),
  setReconnecting: (reconnecting) => set({ reconnecting }),
}));

/** The web build shows setup instead of the editor whenever this is false. */
export function vaultConnected(connection: VaultConnection): boolean {
  return connection.status === "connected";
}
