// Connected lanes the owner has paused. A paused lane stays in the model
// picker, labelled, but nothing runs on it: `cliComplete` (lib/tauri.ts)
// refuses here before any IPC, and Rust refuses again on its own
// (src-tauri/src/lane_pause.rs). scripts/fixtures/parity.json pins the two
// copies equal; lifting a pause is a one-line change on each side.
//
// Cursor, 2026-11-24: Cursor can't be told to skip the user's own MCP
// servers (~/.cursor/mcp.json), so it is paused until a signed-in probe
// proves none of their tools reach the model.

export const PAUSED_PROVIDERS: readonly string[] = ["cursor"];

/** What the picker shows beside a paused lane's models. */
export const PAUSED_LABEL = "Paused for a privacy check";

/** What a chat shows in place of an answer from a paused lane. */
export const PAUSED_MESSAGE =
  "Cursor chats are paused for a privacy check. Rotli is making sure Cursor can't reach your notes through tools of its own. Pick another model to keep going.";

export function lanePaused(provider: string): boolean {
  return PAUSED_PROVIDERS.includes(provider);
}
