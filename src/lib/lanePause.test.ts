import { describe, expect, test } from "bun:test";

import { resolveConsultModel } from "../ai/chatProvider";
import { completeOnCli } from "../ai/hostRemote";
import { PAUSED_LABEL, PAUSED_MESSAGE, lanePaused } from "./lanePause";
import { prompt } from "./promptText";
import { cliComplete } from "./tauri";

describe("paused connected lanes", () => {
  test("Cursor is paused and the other lanes are not", () => {
    expect(lanePaused("cursor")).toBe(true);
    for (const open of ["claude", "codex", "antigravity", "mlx"]) expect(lanePaused(open)).toBe(false);
    expect(PAUSED_LABEL).toBe("Paused for a privacy check");
    expect(PAUSED_MESSAGE).toContain("paused for a privacy check");
  });

  test("the IPC adapter refuses a paused lane before any call leaves the webview", async () => {
    await expect(
      cliComplete({ requestId: "r", provider: "cursor", model: "grok-4.6", prompt: prompt`hi` }),
    ).rejects.toHaveProperty("message", PAUSED_MESSAGE);
  });

  test("a chat already set to a Cursor model gets the paused message instead of an answer", async () => {
    await expect(
      completeOnCli(
        { provider: "cursor", id: "cursor-auto" },
        [{ role: "user", content: prompt`hi` }],
        undefined,
      ),
    ).rejects.toHaveProperty("message", PAUSED_MESSAGE);
  });

  test("@cursor in a message names the pause instead of consulting Cursor", () => {
    const cursor = {
      id: "grok-4.6",
      label: "Grok 4.6",
      provider: "cursor",
      endpoint: "",
      api: "cli",
      vision: false,
      isDefault: true,
    };
    expect(resolveConsultModel([cursor], "cursor", null, {})).toEqual({ ok: false, message: PAUSED_MESSAGE });
  });
});
