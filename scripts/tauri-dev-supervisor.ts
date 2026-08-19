// Keep the terminal-owned Tauri/Vite process tree authoritative across a
// deliberate vault switch. The debug app drops a one-shot marker and exits;
// this supervisor then starts a fresh `tauri dev` generation. Re-executing the
// compiled binary directly orphaned it from the CLI, left a stale Rotli process
// behind, and made the terminal session look like it had crashed.

import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const DEV_RESTART_MARKER_ENV = "ROTLI_DEV_RESTART_MARKER";

export function developmentRestartMarker(pid: number, temporaryDirectory = tmpdir()): string {
  return join(temporaryDirectory, `rotli-dev-restart-${pid}`);
}

export function consumeDevelopmentRestart(marker: string): boolean {
  if (!existsSync(marker)) return false;
  unlinkSync(marker);
  return true;
}

async function run(): Promise<number> {
  const root = join(import.meta.dir, "..");
  const tauri = join(root, "node_modules", ".bin", process.platform === "win32" ? "tauri.cmd" : "tauri");
  const marker = developmentRestartMarker(process.pid);
  if (existsSync(marker)) unlinkSync(marker);

  for (;;) {
    const child = Bun.spawn([tauri, "dev", "--config", "src-tauri/tauri.dev.conf.json"], {
      cwd: root,
      env: { ...process.env, [DEV_RESTART_MARKER_ENV]: marker },
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    const code = await child.exited;
    if (consumeDevelopmentRestart(marker)) continue;
    return code;
  }
}

if (import.meta.main) process.exit(await run());
