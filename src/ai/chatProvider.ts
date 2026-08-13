import type { ChatModelInfo } from "../lib/tauri";

export type ConsultProvider = "claude" | "gpt" | "gemini";
export type PrimaryProvider = ConsultProvider | `local:${string}` | `provider:${string}`;

export type ConsultMention =
  | { kind: "none" }
  | { kind: "error"; message: string }
  | { kind: "consult"; provider: ConsultProvider; prompt: string };

const CONSULT_TAG = /(^|\s)@(claude|gpt|chatgpt|codex|openai|gemini)\b/gi;

function consultProvider(alias: string): ConsultProvider {
  if (/^(gpt|chatgpt|codex|openai)$/i.test(alias)) return "gpt";
  return alias.toLowerCase() as ConsultProvider;
}

export function providerFamilyFromProvider(provider: string): PrimaryProvider | null {
  if (provider === "claude") return "claude";
  if (provider === "codex") return "gpt";
  if (provider === "agy" || provider === "gemini") return "gemini";
  if (provider === "preset" || !provider) return null;
  if (provider === "mlx" || provider === "llamacpp" || provider === "ollama") return `local:${provider}`;
  return `provider:${provider}`;
}

export function providerFamilyFor(model: Pick<ChatModelInfo, "provider">): PrimaryProvider | null {
  return providerFamilyFromProvider(model.provider);
}

export function providerFamilyLabel(provider: PrimaryProvider): string {
  if (provider === "claude") return "Claude";
  if (provider === "gpt") return "GPT";
  if (provider === "gemini") return "Gemini";
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
  const prompt = text
    .replace(CONSULT_TAG, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
  return { kind: "consult", provider, prompt };
}

export function selectConsultModel(
  available: readonly ChatModelInfo[],
  requested: ConsultProvider,
  primary: PrimaryProvider,
): ChatModelInfo | null {
  if (requested === primary) return null;
  return available.find((model) => providerFamilyFor(model) === requested) ?? null;
}

export function attributedConsultReply(model: ChatModelInfo, reply: string): string {
  const provider = providerFamilyFor(model);
  const label = provider ? providerFamilyLabel(provider) : model.provider;
  return `**Consulted ${label} · ${model.label}**\n\n${reply}`;
}
