import { describe, expect, test } from "bun:test";

import type { BreveRoutine } from "../lib/tauri";
import { EMPTY_BREVE_CONFIG, formatNextRoutine, modelPolicyOptions, sortBriefs } from "./briefs";

describe("Breve workspace model", () => {
  test("briefs sort newest-first and morning/lunch/night within a day", () => {
    expect(
      sortBriefs([
        { stem: "n", title: "Night", kind: "night", date: "2026-07-09", imported: true },
        { stem: "m", title: "Morning", kind: "morning", date: "2026-07-09", imported: true },
        { stem: "o", title: "Old", kind: "morning", date: "2026-07-08", imported: true },
      ]).map((b) => b.stem),
    ).toEqual(["m", "n", "o"]);
  });

  test("routine status is honest about off and always-on jobs", () => {
    const base: BreveRoutine = {
      id: "signal",
      label: "Signal listener",
      kind: "signal",
      enabled: true,
      schedule: { kind: "alwaysOn" },
      lanes: ["signal"],
    };
    expect(formatNextRoutine(base, 0, "UTC")).toBe("Always on");
    expect(formatNextRoutine({ ...base, enabled: false }, 0, "UTC")).toBe("Off");
  });

  test("model options retain configured models that are temporarily unavailable", () => {
    const config = {
      ...EMPTY_BREVE_CONFIG,
      modelPolicy: { primary: "sonnet", fallbacks: ["gemini"], localHelper: "gemma" },
    };
    expect(modelPolicyOptions(config, ["sonnet", "gpt", "gemma"])).toEqual([
      "sonnet",
      "gemini",
      "gemma",
      "gemma-3-12b-it-qat-4bit",
      "gpt",
    ]);
  });
});
