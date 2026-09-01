import { describe, expect, test } from "bun:test";

import type { ChatModelInfo } from "../lib/tauri";
import {
  attributedConsultReply,
  modelsForPrimaryProvider,
  parseConsultMention,
  providerFamilyFor,
  resolveConsultModel,
} from "./chatProvider";

const model = (provider: string, id: string, label: string): ChatModelInfo => ({
  id,
  label,
  provider,
  endpoint: "",
  api: "cli",
  vision: true,
  isDefault: false,
});

const opus = model("claude", "opus", "Claude Opus");
const sonnet = model("claude", "sonnet", "Claude Sonnet 5");
const gpt = model("codex", "gpt-5.6-sol", "GPT-5.6 Sol");
const cursor = model("cursor", "grok-4.6", "Grok 4.6");
const mlx = model("mlx", "gemma", "Gemma");

describe("one primary provider per chat", () => {
  test("normalizes transport ids into the provider family the user recognizes", () => {
    expect(providerFamilyFor(opus)).toBe("claude");
    expect(providerFamilyFor(gpt)).toBe("codex");
    expect(providerFamilyFor(cursor)).toBe("cursor");
    expect(providerFamilyFor(mlx)).toBe("local:mlx");
    expect(providerFamilyFor(model("openrouter", "custom", "Custom"))).toBe("provider:openrouter");
    expect(providerFamilyFor(model("preset", "preset:delegate", "Delegate"))).toBeNull();
  });

  test("offers another Claude model but never a model from another provider", () => {
    expect(modelsForPrimaryProvider([opus, sonnet, gpt, cursor], "claude")).toEqual([opus, sonnet]);
  });
});

describe("explicit cross-provider consultation", () => {
  test("recognizes friendly provider tags anywhere at a word boundary and removes the routing tag", () => {
    expect(parseConsultMention("Ask @GPT to challenge this plan")).toEqual({
      kind: "consult",
      provider: "codex",
      modelId: null,
      prompt: "Ask to challenge this plan",
    });
    expect(parseConsultMention("@ChatGPT compare both options")).toEqual({
      kind: "consult",
      provider: "codex",
      modelId: null,
      prompt: "compare both options",
    });
    expect(parseConsultMention("Ask @Cursor to inspect this code")).toEqual({
      kind: "consult",
      provider: "cursor",
      modelId: null,
      prompt: "Ask to inspect this code",
    });
    expect(parseConsultMention("@codex:gpt-5.6-terra challenge this")).toEqual({
      kind: "consult",
      provider: "codex",
      modelId: "gpt-5.6-terra",
      prompt: "challenge this",
    });
    expect(parseConsultMention("@cursor:{grok-4.6} give me a second opinion")).toEqual({
      kind: "consult",
      provider: "cursor",
      modelId: "grok-4.6",
      prompt: "give me a second opinion",
    });
    expect(parseConsultMention("email@claude.example is not a tag")).toEqual({ kind: "none" });
  });

  test("rejects an ambiguous turn that tags two different providers", () => {
    expect(parseConsultMention("@Claude and @Cursor compare this")).toEqual({
      kind: "error",
      message: "Consult one provider per message.",
    });
  });

  test("uses a validated provider default or an exact explicit model", () => {
    const defaults = { claude: "sonnet", codex: "gpt-5.6-sol", cursor: "grok-4.6" };
    const available = [opus, sonnet, gpt, cursor];
    expect(resolveConsultModel(available, "codex", null, defaults)).toEqual({ ok: true, model: gpt });
    expect(resolveConsultModel(available, "claude", "opus", defaults)).toEqual({
      ok: true,
      model: opus,
    });
    expect(resolveConsultModel([opus], "cursor", null, defaults)).toEqual({
      ok: false,
      message: expect.stringContaining("not enabled and ready"),
    });
    expect(resolveConsultModel(available, "codex", "not-a-model", defaults)).toEqual({
      ok: false,
      message: expect.stringContaining("not available"),
    });
  });

  test("attributes the durable assistant text to the consulted model", () => {
    expect(attributedConsultReply(gpt, "Try the smaller complete slice.")).toBe(
      "**Consulted Codex · GPT-5.6 Sol**\n\nTry the smaller complete slice.",
    );
  });
});
