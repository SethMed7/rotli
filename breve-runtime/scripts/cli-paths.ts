// Model-CLI install candidates — ONE ordered list per CLI, byte-identical to the
// Rust allowlist in src-tauri/src/provider.rs (`CLIS` bins; F10). First existing
// path wins; "~/" expands against $HOME because sandbox-exec never searches PATH.
// Guarded by scripts/fixtures/parity.json + src/lib/parity.test.ts +
// src-tauri/src/parity_tests.rs — change a path there AND here, never one side.
// Pure module (no Bun/node imports) so app-side tests can import it directly.

export const CLAUDE_BIN_CANDIDATES = ["~/.local/bin/claude", "/opt/homebrew/bin/claude", "/usr/local/bin/claude"] as const;
export const CODEX_BIN_CANDIDATES = ["/opt/homebrew/bin/codex", "~/.local/bin/codex", "/usr/local/bin/codex"] as const;
export const AGY_BIN_CANDIDATES = ["~/.local/bin/agy", "/opt/homebrew/bin/agy"] as const;

/** Expand a leading "~/" against the caller's home directory. */
export function expandHome(path: string, home: string): string {
  return path.startsWith("~/") ? `${home}/${path.slice(2)}` : path;
}
