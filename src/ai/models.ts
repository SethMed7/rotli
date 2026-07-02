// The model catalog seam. LOCAL models come from the memex-ai store (Rust
// `chat_models` reads ~/.memex/ai/registry.json); CONNECTED models are the
// subscription CLIs installed on this Mac (Claude Code · Codex · Antigravity)
// plus a bring-your-own-key Gemini lane, spawned by the Rust provider bridge.
// Pure data + merge logic only — no I/O, so it unit-tests.
//
// Connected CLI models carry `endpoint: ""` ON PURPOSE: the secure-note gate
// derives locality from the endpoint and `endpoint_is_local("")` fails CLOSED
// (chat.rs / guard.ts), so a `secure: true` note can never reach a connected
// model without any new gating code.

import type { ChatModelInfo } from "../lib/tauri";

/** The connectable provider lanes (Settings → AI Models). */
export type ProviderId = "claude" | "codex" | "agy" | "gemini";
export const PROVIDER_IDS: readonly ProviderId[] = ["claude", "codex", "agy", "gemini"];

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  claude: "Claude Code",
  codex: "Codex",
  agy: "Antigravity",
  gemini: "Gemini API",
};

/** A hybrid preset (Settings → AI Models): an ORGANIZER model reads the prompt
 * and picks one of the ROUTES (each a "when …" description + a model); the
 * routed model runs the normal agent loop; FALLBACK catches a failed executor.
 * Selectable in the chat model dropdown as a pseudo-model (`preset:<id>`). */
export interface HybridPreset {
  id: string;
  name: string;
  /** Model id that routes the prompt (usually a fast local one). */
  organizer: string;
  routes: { when: string; model: string }[];
  /** Model id to retry on when the routed executor fails. */
  fallback?: string;
}

/** Gemini's OpenAI-compatible surface — rides the existing `chat_messages`
 * openai pipeline; the Rust side picks the keychain key for this base. */
export const GEMINI_OPENAI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai";

/** Model id prefix marking a hybrid preset in the dropdown. */
export const PRESET_PREFIX = "preset:";

/** One curated on-device model you can install from Settings → AI Models. These
 * are 4-bit MLX chat models from the `mlx-community` org (Apple-Silicon native);
 * `approxMb` is display-only (real disk use is measured after download). */
export interface LocalCatalogEntry {
  /** Hugging Face repo id (`owner/name`). */
  repo: string;
  /** The install dir name / registry id (lowercase-alnum-dash-dot). */
  name: string;
  label: string;
  approxMb: number;
  vision: boolean;
}

export const LOCAL_CATALOG: LocalCatalogEntry[] = [
  { repo: "mlx-community/Qwen2.5-3B-Instruct-4bit", name: "qwen2.5-3b-instruct-4bit", label: "Qwen2.5 3B Instruct", approxMb: 1800, vision: false },
  { repo: "mlx-community/Llama-3.2-3B-Instruct-4bit", name: "llama-3.2-3b-instruct-4bit", label: "Llama 3.2 3B Instruct", approxMb: 1800, vision: false },
  { repo: "mlx-community/Phi-3.5-mini-instruct-4bit", name: "phi-3.5-mini-instruct-4bit", label: "Phi-3.5 mini Instruct", approxMb: 2200, vision: false },
  { repo: "mlx-community/Qwen2.5-7B-Instruct-4bit", name: "qwen2.5-7b-instruct-4bit", label: "Qwen2.5 7B Instruct", approxMb: 4300, vision: false },
  { repo: "mlx-community/Ministral-8B-Instruct-2410-4bit", name: "ministral-8b-instruct-4bit", label: "Ministral 8B Instruct", approxMb: 4500, vision: false },
];

/** Derive a safe install name from a pasted HF repo id — the last path segment,
 * lowercased, non-slug chars → dashes. Matches the Rust `valid_name` law. */
export function nameFromRepo(repo: string): string {
  const last = repo.split("/").pop() ?? repo;
  return last.toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96);
}

/** A pasted repo id is `owner/name` (mirror of the Rust `valid_repo` gate). */
export function isValidRepo(repo: string): boolean {
  const parts = repo.trim().split("/");
  return (
    parts.length === 2 &&
    parts.every((p) => p.length > 0 && p.length <= 96 && p !== ".." && /^[A-Za-z0-9._-]+$/.test(p))
  );
}

/** The catalog minus anything already installed (matched by registry id). */
export function installableCatalog(installedIds: Set<string>): LocalCatalogEntry[] {
  return LOCAL_CATALOG.filter((e) => !installedIds.has(e.name));
}

const cli = (provider: ProviderId, id: string, label: string): ChatModelInfo => ({
  id,
  label,
  provider,
  endpoint: "", // remote — fails the locality check on purpose (see header)
  api: "cli",
  vision: false, // v1: CLI transports don't carry the composer's data-URL images
  isDefault: false,
});

const gemini = (id: string, label: string): ChatModelInfo => ({
  id,
  label,
  provider: "gemini",
  endpoint: GEMINI_OPENAI_BASE,
  api: "openai",
  vision: true, // rides the existing openai image parts
  isDefault: false,
});

/** What each connected lane offers. Model ids are the EXACT strings the CLI /
 * API expects (`--model <id>`); the label carries the human context. Kept to a
 * curated handful per lane — the dropdown is a picker, not a registry dump. */
export const CLI_CATALOG: Record<ProviderId, ChatModelInfo[]> = {
  claude: [
    cli("claude", "sonnet", "Claude Sonnet"),
    cli("claude", "opus", "Claude Opus"),
    cli("claude", "haiku", "Claude Haiku"),
    cli("claude", "fable", "Claude Fable"),
  ],
  codex: [
    cli("codex", "gpt-5.5", "GPT-5.5"),
    cli("codex", "gpt-5.4", "GPT-5.4"),
    cli("codex", "gpt-5.4-mini", "GPT-5.4 mini"),
  ],
  agy: [
    cli("agy", "Gemini 3.5 Flash (Medium)", "Gemini 3.5 Flash · agy"),
    cli("agy", "Gemini 3.1 Pro (High)", "Gemini 3.1 Pro · agy"),
    cli("agy", "Claude Sonnet 4.6 (Thinking)", "Claude Sonnet 4.6 · agy"),
    cli("agy", "Claude Opus 4.6 (Thinking)", "Claude Opus 4.6 · agy"),
  ],
  gemini: [
    gemini("gemini-3-pro", "Gemini 3 Pro"),
    gemini("gemini-3-flash", "Gemini 3 Flash"),
    gemini("gemini-2.5-pro", "Gemini 2.5 Pro"),
    gemini("gemini-2.5-flash", "Gemini 2.5 Flash"),
  ],
};

export interface ModelGroups {
  local: ChatModelInfo[];
  connected: ChatModelInfo[];
  presets: ChatModelInfo[];
}

/** A preset as a dropdown pseudo-model. `api: "preset"` diverts the send path
 * into runHybrid; it never reaches a completion transport directly. */
export function presetModel(p: HybridPreset): ChatModelInfo {
  return {
    id: `${PRESET_PREFIX}${p.id}`,
    label: p.name,
    provider: "preset",
    endpoint: "",
    api: "preset",
    vision: false,
    isDefault: false,
  };
}

/** Merge the memex-ai store's local models with the ENABLED connected lanes
 * and the saved presets — the chat dropdown's three groups. Pure.
 *
 * EVERY installed local model is offered: since server 0.3 the shared MLX
 * server honors the request's model and swaps its slot on demand (load lazily,
 * idle-unload — nothing runs 24/7). `localDefault` is a Settings badge, not a
 * usability gate. */
export function mergedModels(
  local: ChatModelInfo[],
  enabled: Record<ProviderId, boolean>,
  presets: HybridPreset[],
): ModelGroups {
  const connected: ChatModelInfo[] = [];
  for (const id of PROVIDER_IDS) {
    if (enabled[id]) connected.push(...CLI_CATALOG[id]);
  }
  return { local, connected, presets: presets.map(presetModel) };
}

/** The flat pick-list (local first, so the `isDefault`/first fallback stays
 * on-device when a persisted choice goes stale). */
export function flattenModels(g: ModelGroups): ChatModelInfo[] {
  return [...g.local, ...g.connected, ...g.presets];
}
