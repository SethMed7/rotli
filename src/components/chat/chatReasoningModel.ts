import type { ChatReasoningEffort, ChatServiceTier } from "../../state/ui";

export interface ReasoningChoice {
  value: ChatReasoningEffort | null;
  label: string;
}

const LABELS: Record<ChatReasoningEffort, string> = {
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
  ultra: "Ultra",
};

/** Presentation capability map for the exact models in `CLI_CATALOG`. Rust
 * independently enforces the same boundary before constructing provider argv. */
function supportedReasoning(
  provider: string | undefined,
  modelId: string | undefined,
): readonly ChatReasoningEffort[] {
  if (provider === "claude") {
    return modelId && ["sonnet", "opus", "fable"].includes(modelId)
      ? ["low", "medium", "high", "xhigh", "max"]
      : [];
  }
  if (provider !== "codex") return [];
  if (modelId === "gpt-5.6-sol" || modelId === "gpt-5.6-terra") {
    return ["low", "medium", "high", "xhigh", "max", "ultra"];
  }
  if (modelId === "gpt-5.6-luna") return ["low", "medium", "high", "xhigh", "max"];
  if (["gpt-5.5", "gpt-5.3-codex-spark"].includes(modelId ?? "")) {
    return ["low", "medium", "high", "xhigh"];
  }
  return [];
}

export function reasoningChoices(
  provider: string | undefined,
  modelId: string | undefined,
): ReasoningChoice[] {
  const efforts = supportedReasoning(provider, modelId);
  if (efforts.length === 0) return [];
  return [{ value: null, label: "Default" }, ...efforts.map((value) => ({ value, label: LABELS[value] }))];
}

export function serviceTierChoices(
  provider: string | undefined,
  modelId: string | undefined,
): readonly ChatServiceTier[] {
  return provider === "codex" && modelId?.startsWith("gpt-5.6-") ? ["standard", "fast"] : [];
}

export function normalizedReasoning(
  provider: string | undefined,
  modelId: string | undefined,
  value: ChatReasoningEffort | undefined,
): ChatReasoningEffort | undefined {
  if (!value) return undefined;
  return supportedReasoning(provider, modelId).includes(value) ? value : undefined;
}

export function normalizedServiceTier(
  provider: string | undefined,
  modelId: string | undefined,
  value: ChatServiceTier | undefined,
): ChatServiceTier | undefined {
  return serviceTierChoices(provider, modelId).includes(value ?? "standard") ? value : undefined;
}
