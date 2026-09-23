import { discoveredModel } from "../../ai/models";
import type { DiscoveryLanes } from "../../state/connectedModels";
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

const UPTO_MAX: readonly ChatReasoningEffort[] = ["low", "medium", "high", "xhigh", "max"];
const UPTO_ULTRA: readonly ChatReasoningEffort[] = [...UPTO_MAX, "ultra"];
const EFFORTS = Object.keys(LABELS) as ChatReasoningEffort[];

/** Presentation capability map: the efforts the client itself reported for
 * this model once discovery has answered, else the reviewed rules for the
 * built-in ids. Rust (provider_models::effort_allowed) enforces the same pair
 * independently before constructing provider argv. */
function supportedReasoning(
  provider: string | undefined,
  modelId: string | undefined,
  lanes?: DiscoveryLanes,
): readonly ChatReasoningEffort[] {
  const reported = discoveredModel(provider, modelId, lanes);
  if (reported) return EFFORTS.filter((effort) => reported.efforts.includes(effort));
  if (provider === "claude") return modelId && modelId !== "haiku" ? UPTO_MAX : [];
  if (provider !== "codex") return [];
  if (["gpt-6-astra", "gpt-6-sol", "gpt-5.6-sol", "gpt-5.6-terra"].includes(modelId ?? "")) return UPTO_ULTRA;
  if (modelId === "gpt-6-luna" || modelId === "gpt-5.6-luna") return UPTO_MAX;
  if (["gpt-5.5", "gpt-5.3-codex-spark"].includes(modelId ?? "")) {
    return ["low", "medium", "high", "xhigh"];
  }
  return [];
}

export function reasoningChoices(
  provider: string | undefined,
  modelId: string | undefined,
  lanes?: DiscoveryLanes,
): ReasoningChoice[] {
  const efforts = supportedReasoning(provider, modelId, lanes);
  if (efforts.length === 0) return [];
  return [{ value: null, label: "Default" }, ...efforts.map((value) => ({ value, label: LABELS[value] }))];
}

export function serviceTierChoices(
  provider: string | undefined,
  modelId: string | undefined,
  lanes?: DiscoveryLanes,
): readonly ChatServiceTier[] {
  if (provider !== "codex") return [];
  const reported = discoveredModel(provider, modelId, lanes);
  const fast = reported ? reported.fastTier : !!modelId && /^gpt-(5\.6|6)-/.test(modelId);
  return fast ? ["standard", "fast"] : [];
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
