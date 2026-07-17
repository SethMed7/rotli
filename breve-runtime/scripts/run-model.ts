/**
 * BREVE model-spawn helper — the ONE place every model subprocess gets OS-sandboxed.
 *
 * The tool-bearing tiers run claude/agy/codex with --dangerously-skip-permissions; without the
 * sandbox they read+write anywhere Seth can. signal-daemon.ts already wraps its spawns in
 * `sandboxed(argv)` (see sandbox.ts), but the one-shot scripts (daily-log, email-topic,
 * summarize-url, imagegen) spawned models UNSANDBOXED — a hole. runModel() closes it: every model
 * tier goes through `Bun.spawn(sandboxed(argv), …)`, so the brain+storage write/read boundary is
 * enforced at the OS for all of them, not just the daemon. Mirrors sandbox.ts; obeys BREVE_SANDBOX.
 *
 * argv[0] must be an ABSOLUTE program path — sandbox-exec does not search PATH. Use CLAUDE_BIN /
 * findAgy() / findCodex() to resolve them (same lookups already used across the daemon).
 */
import { existsSync } from "node:fs";
import { AGY_BIN_CANDIDATES, CLAUDE_BIN_CANDIDATES, CODEX_BIN_CANDIDATES, expandHome } from "./cliPaths";
import { sandboxed } from "./sandbox";

const HOME = process.env.HOME!;

function firstExisting(candidates: readonly string[]): string | null {
  return candidates.map((p) => expandHome(p, HOME)).find((p) => existsSync(p)) ?? null;
}

/** Spawn a model subprocess under the write+read sandbox. argv[0] must be an absolute program path. */
// Callers always pipe the stdio they touch, so pin the piped shape (FileSink
// stdin, ReadableStream stdout/stderr) instead of the loose default unions.
export function runModel(argv: string[], opts?: any): Bun.Subprocess<"pipe", "pipe", "pipe"> {
  return Bun.spawn(sandboxed(argv), opts) as Bun.Subprocess<"pipe", "pipe", "pipe">;
}

/** Flags that stop a `claude -p` run from loading ambient MCP servers (injection-to-side-effect defense). */
export const STRICT_MCP = ["--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}'];

export const CLAUDE_BIN = Bun.which("claude") ?? firstExisting(CLAUDE_BIN_CANDIDATES) ?? "claude";

/** First existing agy binary, or null (matches summarize-url.ts / signal-daemon.ts). */
export function findAgy(): string | null {
  return firstExisting(AGY_BIN_CANDIDATES);
}

/** Resolve codex: PATH first, then the usual install locations; null if absent. */
export function findCodex(): string | null {
  return Bun.which("codex") ?? firstExisting(CODEX_BIN_CANDIDATES);
}

// CLI: `bun scripts/run-model.ts --print` shows a sample sandboxed claude argv + resolved agy/codex.
if (import.meta.main) {
  if (process.argv[2] === "--print") {
    const sample = sandboxed([CLAUDE_BIN, "-p", "--model", "claude-haiku-4-5", ...STRICT_MCP, "hello"]);
    console.log(`claude: ${CLAUDE_BIN}`);
    console.log(`agy:    ${findAgy() ?? "(not found)"}`);
    console.log(`codex:  ${findCodex() ?? "(not found)"}`);
    console.log(`\nsandboxed argv:\n${JSON.stringify(sample, null, 2)}`);
  } else {
    console.error("usage: run-model.ts --print");
  }
}
