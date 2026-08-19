import { describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { consumeDevelopmentRestart, developmentRestartMarker } from "./tauri-dev-supervisor";

describe("the terminal-owned Tauri development supervisor", () => {
  test("uses one exact temp marker per terminal session", () => {
    expect(developmentRestartMarker(42, "/tmp")).toBe("/tmp/rotli-dev-restart-42");
  });

  test("consumes a restart request once and only once", () => {
    const marker = developmentRestartMarker(process.pid, tmpdir()) + "-test";
    writeFileSync(marker, "restart\n");
    expect(consumeDevelopmentRestart(marker)).toBe(true);
    expect(existsSync(marker)).toBe(false);
    expect(consumeDevelopmentRestart(marker)).toBe(false);
  });
});
