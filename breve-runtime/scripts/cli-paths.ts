// Model-CLI install candidates — ONE ordered list per CLI, byte-identical to the
// Rust allowlist in src-tauri/src/provider.rs (`CLIS` bins; F10). First existing
// path wins; "~/" expands against $HOME because sandbox-exec never searches PATH.
// Guarded by scripts/fixtures/parity.json + src/lib/parity.test.ts +
// src-tauri/src/parity_tests.rs — change a path there AND here, never one side.
// Pure module (no Bun/node imports) so app-side tests can import it directly.

export const CLAUDE_BIN_CANDIDATES = ["~/.local/bin/claude", "/opt/homebrew/bin/claude", "/usr/local/bin/claude"] as const;
export const CODEX_BIN_CANDIDATES = ["/opt/homebrew/bin/codex", "~/.local/bin/codex", "/usr/local/bin/codex"] as const;
// Parity-only: Breve never launches Cursor. The interactive Rust adapter owns
// this list and uses Cursor's documented ACP custom-client protocol.
export const CURSOR_BIN_CANDIDATES = [
  "~/.local/bin/agent",
  "~/.local/bin/cursor-agent",
  "/opt/homebrew/bin/agent",
  "/usr/local/bin/agent",
] as const;
/** Rotli's managed install of Google's official ACP agent (ADR 2026-09-03). */
export const ANTIGRAVITY_BIN_CANDIDATES = [
  "~/Library/Application Support/com.rotli.app/antigravity-acp/current/agy_acp_server.par",
] as const;

/** Expand a leading "~/" against the caller's home directory. */
export function expandHome(path: string, home: string): string {
  return path.startsWith("~/") ? `${home}/${path.slice(2)}` : path;
}
