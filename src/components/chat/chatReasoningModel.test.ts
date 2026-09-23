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
    expect(reasoningChoices("unknown", "remote-model")).toEqual([]);
  });

  test("switching models never forwards an incompatible stale choice", () => {
    expect(normalizedReasoning("codex", "gpt-5.5", "max")).toBeUndefined();
    expect(normalizedReasoning("codex", "gpt-5.6-terra", "ultra")).toBe("ultra");
    expect(normalizedReasoning("claude", "haiku", "high")).toBeUndefined();
    expect(normalizedReasoning("claude", "sonnet", "max")).toBe("max");
    expect(normalizedServiceTier("claude", "sonnet", "fast")).toBeUndefined();
    expect(normalizedServiceTier("codex", "gpt-5.5", "fast")).toBeUndefined();
    expect(normalizedServiceTier("codex", "gpt-5.6-luna", "fast")).toBe("fast");
  });

  test("shows Fast only on the GPT-5.6 and GPT-6 Codex families", () => {
    expect(serviceTierChoices("codex", "gpt-5.6-sol")).toEqual(["standard", "fast"]);
    expect(serviceTierChoices("codex", "gpt-6-astra")).toEqual(["standard", "fast"]);
    expect(serviceTierChoices("codex", "gpt-5.5")).toEqual([]);
    expect(serviceTierChoices("claude", "sonnet")).toEqual([]);
  });

  test("a discovered model's controls are exactly what its client reported", () => {
    const model = (id: string, efforts: string[], fastTier: boolean) => ({
      id,
      label: id,
      efforts,
      fastTier,
      vision: true,
      isDefault: false,
    });
    const lanes = {
      claude: { status: "ready" as const, at: 0, models: [model("claude-haiku-5", [], false)] },
      codex: {
        status: "ready" as const,
        at: 0,
        models: [model("gpt-5.5", ["low", "high", "turbo"], true), model("gpt-7-nova", ["ultra"], false)],
      },
    };
    expect(reasoningChoices("codex", "gpt-7-nova", lanes).map((c) => c.value)).toEqual([null, "ultra"]);
    // an effort outside Rotli's vocabulary is never offered
    expect(reasoningChoices("codex", "gpt-5.5", lanes).map((c) => c.value)).toEqual([null, "low", "high"]);
    expect(serviceTierChoices("codex", "gpt-5.5", lanes)).toEqual(["standard", "fast"]);
    expect(serviceTierChoices("codex", "gpt-7-nova", lanes)).toEqual([]);
    // reported no effort control → none, whatever the name suggests
    expect(reasoningChoices("claude", "claude-haiku-5", lanes)).toEqual([]);
    // not in the answered list → the reviewed static rules (claude aliases)
    expect(reasoningChoices("claude", "opus[1m]", lanes).at(-1)?.value).toBe("max");
  });
});
