#!/usr/bin/env bun
/**
 * BREVE binary resolver — find external CLIs (signal-cli, bun) without relying on PATH.
 * WHY: launchd jobs run with a bare PATH, so Bun.which can miss Homebrew/~/.bun binaries
 * and Bun.spawn throws ENOENT on a missing one — which would crash a watchdog
 * (creator-alerts / breve-doctor / watcher-check) instead of just logging. Everything
 * here resolves robustly and NEVER throws: a missing binary returns null, not a crash.
 */
import { existsSync } from "node:fs";

/** Bun.spawn options, minus the argv these wrappers supply themselves. */
type SpawnOptions = Parameters<typeof Bun.spawn>[1];

// Bun.which first (respects PATH when set), then known install dirs, else null.
export function resolveBin(name: string, fallbacks: string[] = []): string | null {
  const expand = (p: string) =>
    p.replace(/^~(?=\/|$)/, process.env.HOME ?? "").replace(/\$\{?HOME\}?/g, process.env.HOME ?? "");
  const which = Bun.which(name);
  if (which) return which;
  for (const f of fallbacks) {
    const p = expand(f);
    if (p && existsSync(p)) return p;
  }
  return null;
}

export const signalCli = () => resolveBin("signal-cli", ["/opt/homebrew/bin/signal-cli", "/usr/local/bin/signal-cli"]);
export const bunBin = () => resolveBin("bun", [`${process.env.HOME}/.bun/bin/bun`, "/opt/homebrew/bin/bun"]);

// Spawn that returns null instead of throwing when argv[0] is missing/unresolvable.
export function safeSpawn(argv: string[], opts?: SpawnOptions): Bun.Subprocess | null {
  if (!argv[0]) return null;
  try {
    return Bun.spawn(argv, opts);
  } catch {
    return null;
  }
}

// One Signal send with retries; the dedup of the identical loops in the watchdogs.
// Returns false (caller logs "signal-cli not found") if the CLI can't be resolved.
export async function sendSignal(bot: string, owner: string, text: string, tries = 3): Promise<boolean> {
  const cli = signalCli();
  if (!cli) return false;
  for (let i = 0; i < tries; i++) {
    const p = safeSpawn([cli, "-a", bot, "send", owner, "-m", text], { stdout: "ignore", stderr: "ignore" });
    if (p && (await p.exited) === 0) return true;
    if (i < tries - 1) await Bun.sleep(4000);
  }
  return false;
}

if (import.meta.main && process.argv.includes("--print")) {
  console.log(`signal-cli: ${signalCli() ?? "(not found)"}`);
  console.log(`bun:        ${bunBin() ?? "(not found)"}`);
}
