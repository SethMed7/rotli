import { describe, expect, test } from "bun:test";

import type { ChatModelInfo } from "../lib/tauri";
import {
  attributedConsultReply,
  modelsForPrimaryProvider,
  parseConsultMention,
  providerFamilyFor,
  selectConsultModel,
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
const geminiCli = model("agy", "Gemini 3.5 Flash (Medium)", "Gemini 3.5 Flash");
const geminiApi = model("gemini", "gemini-3-pro", "Gemini 3 Pro");
const mlx = model("mlx", "gemma", "Gemma");

describe("one primary provider per chat", () => {
  test("normalizes transport ids into the provider family the user recognizes", () => {
    expect(providerFamilyFor(opus)).toBe("claude");
    expect(providerFamilyFor(gpt)).toBe("gpt");
    expect(providerFamilyFor(geminiCli)).toBe("gemini");
    expect(providerFamilyFor(geminiApi)).toBe("gemini");
    expect(providerFamilyFor(mlx)).toBe("local:mlx");
    expect(providerFamilyFor(model("openrouter", "custom", "Custom"))).toBe("provider:openrouter");
    expect(providerFamilyFor(model("preset", "preset:delegate", "Delegate"))).toBeNull();
  });

  test("offers another Claude model but never a model from another provider", () => {
    expect(modelsForPrimaryProvider([opus, sonnet, gpt, geminiCli], "claude")).toEqual([opus, sonnet]);
  });
});

describe("explicit cross-provider consultation", () => {
  test("recognizes friendly provider tags anywhere at a word boundary and removes the routing tag", () => {
    expect(parseConsultMention("Ask @GPT to challenge this plan")).toEqual({
      kind: "consult",
      provider: "gpt",
      prompt: "Ask to challenge this plan",
    });
    expect(parseConsultMention("@ChatGPT compare both options")).toEqual({
      kind: "consult",
      provider: "gpt",
      prompt: "compare both options",
    });
    expect(parseConsultMention("email@claude.example is not a tag")).toEqual({ kind: "none" });
  });

  test("rejects an ambiguous turn that tags two different providers", () => {
    expect(parseConsultMention("@Claude and @Gemini compare this")).toEqual({
      kind: "error",
      message: "Consult one provider per message.",
    });
  });

  test("selects only a configured, available second provider and never the primary", () => {
    const available = [opus, gpt, geminiCli];
    expect(selectConsultModel(available, "gpt", "claude")).toBe(gpt);
    expect(selectConsultModel(available, "claude", "claude")).toBeNull();
    expect(selectConsultModel([opus], "gemini", "claude")).toBeNull();
  });

  test("attributes the durable assistant text to the consulted model", () => {
    expect(attributedConsultReply(gpt, "Try the smaller complete slice.")).toBe(
      "**Consulted GPT · GPT-5.6 Sol**\n\nTry the smaller complete slice.",
    );
  });
});
