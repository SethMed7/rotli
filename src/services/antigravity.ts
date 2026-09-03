// Antigravity lane management — the one place presentation reaches the
// `antigravity_manage` command. Every action resolves to the lane's status,
// so callers never model install/sign-in state themselves (ADR
// docs/decisions/2026-09-03-antigravity-official-acp-lane.md).

import { type AntigravityStatus, antigravityManage, cliCancel } from "../lib/tauri";
import { queryClient } from "./query";

/** The request id the native sign-in registers under, so a waiting sign-in
 * can be aborted with the ordinary cancel command. Mirrors
 * src-tauri/src/antigravity.rs SIGN_IN_REQUEST_ID. */
export const ANTIGRAVITY_SIGN_IN_REQUEST_ID = "antigravity:sign-in";

export const ANTIGRAVITY_STATUS_KEY = ["antigravity", "status"] as const;

/** Re-read the lane status after any action (and after a chat turn that
 * reported sign-in was required). */
export function invalidateAntigravityStatus(): void {
  void queryClient.invalidateQueries({ queryKey: ANTIGRAVITY_STATUS_KEY });
}

export function antigravityStatus(): Promise<AntigravityStatus> {
  return antigravityManage("status");
}

/** Download, verify (pinned SHA-256 + sizes), extract, and activate Google's
 * registry-listed runtime. About 315 MB; the promise resolves when it is on
 * disk and executable. */
export function antigravityInstall(): Promise<AntigravityStatus> {
  return antigravityManage("install");
}

/** Start the agent's own Google sign-in. Rotli opens the authorization URL in
 * the default browser and resolves once the agent has stored its credential
 * (or after five minutes, with an error). */
export function antigravitySignIn(): Promise<AntigravityStatus> {
  return antigravityManage("sign_in");
}

export function antigravityCancelSignIn(): Promise<void> {
  return cliCancel(ANTIGRAVITY_SIGN_IN_REQUEST_ID);
}

/** Delete the agent's stored credential; the runtime stays installed. */
export function antigravitySignOut(): Promise<AntigravityStatus> {
  return antigravityManage("sign_out");
}

/** Remove the downloaded runtime; the Google credential is kept. */
export function antigravityRemove(): Promise<AntigravityStatus> {
  return antigravityManage("remove");
}
