#!/usr/bin/env bun
import { readFileSync } from "node:fs";
/**
 * Escalation & usage policy ENGINE — reads the rules from policy.json (the config) and
 * answers "may Breve use this model directly, or must it ask the maintainer first?" + the cost label.
 * The rules are DATA in policy.json (edit there, no code change), mirroring how the client
 * layer's model rules live in clients/models.json. the maintainer's defaults: local OSS · Haiku · Gemini
 * = direct; Claude > Haiku and non-image Codex = ask; image gen always direct.
 */
import { join } from "node:path";

import { LLM } from "./llm";

export type Action = "direct" | "ask";
export type Verdict = { action: Action; cost: "free" | "subscription"; label: string; key: string };
type Rule = { match: string[]; action: Action; cost: "free" | "subscription"; label: string };

const POLICY_ROOT = process.env.ROTLI_BREVE_HOME ?? join(import.meta.dir, "..");
const POLICY = JSON.parse(readFileSync(join(POLICY_ROOT, "policy.json"), "utf8")) as {
  imageAlwaysDirect?: boolean;
  rules: Rule[];
  default: Omit<Rule, "match">;
};

export function policyFor(model: string): Verdict {
  const id = (model || "").toLowerCase();
  for (const r of POLICY.rules) {
    const key = r.match.find((s) => id.includes(s));
    if (key) return { action: r.action, cost: r.cost, label: r.label, key };
  }
  const d = POLICY.default;
  return { action: d.action, cost: d.cost, label: d.label, key: id || "unknown" };
}

/** Image generation is always allowed direct (incl. Codex) — the maintainer's rule (policy.json). */
export const imageAlwaysDirect: boolean = POLICY.imageAlwaysDirect ?? true;

// CLI check
if (import.meta.main) {
  for (const m of [LLM.model, "haiku", "gemini", "sonnet", "opus", "claude-fable-5", "codex", "qwen"]) {
    const v = policyFor(m);
    console.log(`${m.padEnd(20)} → ${v.action.toUpperCase().padEnd(7)} (${v.label})`);
  }
}
