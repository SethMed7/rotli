import type { ChatReasoningEffort, ChatServiceTier } from "../../state/ui";

export interface ReasoningChoice {
  value: ChatReasoningEffort | null;
  label: string;
}

export function reasoningChoices(provider: string | undefined): ReasoningChoice[] {
  if (provider === "claude") {
    return [
      { value: null, label: "Default" },
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
      { value: "xhigh", label: "Extra high" },
      { value: "max", label: "Max" },
    ];
  }
  if (provider === "codex") {
    return [
      { value: null, label: "Default" },
      { value: "minimal", label: "Minimal" },
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
      { value: "xhigh", label: "Extra high" },
    ];
  }
  return [];
}

export function normalizedReasoning(
  provider: string | undefined,
  value: ChatReasoningEffort | undefined,
): ChatReasoningEffort | undefined {
  if (!value) return undefined;
  return reasoningChoices(provider).some((choice) => choice.value === value) ? value : undefined;
}

export function normalizedServiceTier(
  provider: string | undefined,
  value: ChatServiceTier | undefined,
): ChatServiceTier | undefined {
  return provider === "codex" && (value === "standard" || value === "fast") ? value : undefined;
}
