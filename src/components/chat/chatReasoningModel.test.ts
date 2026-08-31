import { describe, expect, test } from "bun:test";

import {
  normalizedReasoning,
  normalizedServiceTier,
  reasoningChoices,
  serviceTierChoices,
} from "./chatReasoningModel";

describe("frontier reasoning presentation", () => {
  test("offers only settings accepted by each exact native model", () => {
    expect(reasoningChoices("claude", "sonnet").map((choice) => choice.value)).toEqual([
      null,
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    expect(reasoningChoices("claude", "haiku")).toEqual([]);
    expect(reasoningChoices("codex", "gpt-5.6-sol").map((choice) => choice.value)).toEqual([
      null,
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "ultra",
    ]);
    expect(reasoningChoices("codex", "gpt-5.6-luna").at(-1)?.value).toBe("max");
    expect(reasoningChoices("codex", "gpt-5.5").at(-1)?.value).toBe("xhigh");
    expect(reasoningChoices("agy", "gemini-3.7-flash-high")).toEqual([]);
  });

  test("switching models never forwards an incompatible stale choice", () => {
    expect(normalizedReasoning("codex", "gpt-5.5", "max")).toBeUndefined();
    expect(normalizedReasoning("codex", "gpt-5.6-terra", "ultra")).toBe("ultra");
    expect(normalizedReasoning("claude", "haiku", "high")).toBeUndefined();
    expect(normalizedReasoning("claude", "sonnet", "max")).toBe("max");
    expect(normalizedServiceTier("claude", "sonnet", "fast")).toBeUndefined();
    expect(normalizedServiceTier("codex", "gpt-5.4", "fast")).toBeUndefined();
    expect(normalizedServiceTier("codex", "gpt-5.6-luna", "fast")).toBe("fast");
  });

  test("shows Fast only on the GPT-5.6 Codex family", () => {
    expect(serviceTierChoices("codex", "gpt-5.6-sol")).toEqual(["standard", "fast"]);
    expect(serviceTierChoices("codex", "gpt-5.5")).toEqual([]);
    expect(serviceTierChoices("claude", "sonnet")).toEqual([]);
  });
});
