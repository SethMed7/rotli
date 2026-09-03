import type { ChatModelInfo } from "../lib/tauri";
import { PROVIDER_LABELS, type ProviderId, providerDefaultModel } from "./models";

export type ConsultProvider = ProviderId;
export type PrimaryProvider = ProviderId | `local:${string}` | `provider:${string}`;

export type ConsultMention =
  | { kind: "none" }
  | { kind: "error"; message: string }
  | { kind: "consult"; provider: ConsultProvider; modelId: string | null; prompt: string };

const CONSULT_TAG =
  /(^|\s)@(claude|gpt|chatgpt|codex|openai|cursor|antigravity|gemini|agy)(?::(?:\{([a-z0-9][a-z0-9._-]*)\}|([a-z0-9][a-z0-9._-]*)))?(?=$|\s|[),.!?;])/gi;

function consultProvider(alias: string): ConsultProvider {
  if (/^(gpt|chatgpt|codex|openai)$/i.test(alias)) return "codex";
  if (/^(gemini|agy)$/i.test(alias)) return "antigravity";
  return alias.toLowerCase() as ConsultProvider;
}

export function providerFamilyFromProvider(provider: string): PrimaryProvider | null {
  if (provider === "claude") return "claude";
  if (provider === "codex") return "codex";
  if (provider === "cursor") return "cursor";
  if (provider === "antigravity") return "antigravity";
  if (provider === "preset" || !provider) return null;
  if (provider === "mlx" || provider === "llamacpp" || provider === "ollama") return `local:${provider}`;
  return `provider:${provider}`;
}

export function providerFamilyFor(model: Pick<ChatModelInfo, "provider">): PrimaryProvider | null {
  return providerFamilyFromProvider(model.provider);
}

export function providerFamilyLabel(provider: PrimaryProvider): string {
  if (provider === "claude") return "Claude";
  if (provider === "codex") return "Codex";
  if (provider === "cursor") return "Cursor";
  if (provider === "antigravity") return "Antigravity";
  if (provider.startsWith("local:")) return "On this Mac";
  const name = provider.slice("provider:".length);
  return name ? name[0]!.toUpperCase() + name.slice(1) : "Provider";
}

export function modelsForPrimaryProvider(
  models: readonly ChatModelInfo[],
  provider: PrimaryProvider,
): ChatModelInfo[] {
  return models.filter((model) => providerFamilyFor(model) === provider);
}

export function parseConsultMention(text: string): ConsultMention {
  const found = [...text.matchAll(CONSULT_TAG)];
  if (found.length === 0) return { kind: "none" };
  const providers = new Set(found.map((match) => consultProvider(match[2] ?? "")));
  if (providers.size !== 1) return { kind: "error", message: "Consult one provider per message." };
  const provider = providers.values().next().value;
  if (!provider) return { kind: "none" };
  const requestedModels = new Set(
    found.map((match) => (match[3] ?? match[4])?.toLowerCase()).filter((model): model is string => !!model),
  );
  if (requestedModels.size > 1) {
    return { kind: "error", message: "Choose one model for the provider consultation." };
  }
  const prompt = text
    .replace(CONSULT_TAG, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
  return {
    kind: "consult",
    provider,
    modelId: requestedModels.values().next().value ?? null,
    prompt,
  };
}

export type ConsultModelResolution = { ok: true; model: ChatModelInfo } | { ok: false; message: string };

/** Resolve only against this chat's usable model list: enabled, authenticated,
 * unblocked, and already stripped of every remote lane for secure chats. */
export function resolveConsultModel(
  available: readonly ChatModelInfo[],
  requested: ConsultProvider,
  modelId: string | null,
  defaults: Readonly<Partial<Record<ProviderId, string>>>,
): ConsultModelResolution {
  const providerModels = available.filter((model) => providerFamilyFor(model) === requested);
  if (providerModels.length === 0) {
    return {
      ok: false,
      message: `${PROVIDER_LABELS[requested]} is not enabled and ready for this chat. Check Settings → AI Models.`,
    };
  }
  const requestedId = modelId ?? providerDefaultModel(requested, defaults);
  const model = providerModels.find((entry) => entry.id.toLowerCase() === requestedId.toLowerCase());
  if (!model) {
    return {
      ok: false,
      message: `Model “${requestedId}” is not available for @${requested}. Choose a visible ${PROVIDER_LABELS[requested]} model.`,
    };
  }
  return { ok: true, model };
}

export function attributedConsultReply(model: ChatModelInfo, reply: string): string {
  const provider = providerFamilyFor(model);
  const label = provider ? providerFamilyLabel(provider) : model.provider;
  return `**Consulted ${label} · ${model.label}**\n\n${reply}`;
}
