import { describe, expect, test } from "bun:test";

import { normalizedReasoning, normalizedServiceTier, reasoningChoices } from "./chatReasoningModel";

describe("frontier reasoning presentation", () => {
  test("offers only settings accepted by each native provider", () => {
    expect(reasoningChoices("claude").map((choice) => choice.value)).toEqual([
      null,
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    expect(reasoningChoices("codex").map((choice) => choice.value)).toEqual([
      null,
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
    expect(reasoningChoices("agy")).toEqual([]);
  });

  test("switching providers never forwards an incompatible stale choice", () => {
    expect(normalizedReasoning("codex", "max")).toBeUndefined();
    expect(normalizedReasoning("claude", "max")).toBe("max");
    expect(normalizedServiceTier("claude", "fast")).toBeUndefined();
    expect(normalizedServiceTier("codex", "fast")).toBe("fast");
  });
});
