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
  gemini: "Gemini API · Advanced",
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
  {
    repo: "mlx-community/Qwen2.5-3B-Instruct-4bit",
    name: "qwen2.5-3b-instruct-4bit",
    label: "Qwen2.5 3B Instruct",
    approxMb: 1800,
    vision: false,
  },
  {
    repo: "mlx-community/Llama-3.2-3B-Instruct-4bit",
    name: "llama-3.2-3b-instruct-4bit",
    label: "Llama 3.2 3B Instruct",
    approxMb: 1800,
    vision: false,
  },
  {
    repo: "mlx-community/Phi-3.5-mini-instruct-4bit",
    name: "phi-3.5-mini-instruct-4bit",
    label: "Phi-3.5 mini Instruct",
    approxMb: 2200,
    vision: false,
  },
  {
    repo: "mlx-community/Qwen2.5-7B-Instruct-4bit",
    name: "qwen2.5-7b-instruct-4bit",
    label: "Qwen2.5 7B Instruct",
    approxMb: 4300,
    vision: false,
  },
  {
    repo: "mlx-community/Ministral-8B-Instruct-2410-4bit",
    name: "ministral-8b-instruct-4bit",
    label: "Ministral 8B Instruct",
    approxMb: 4500,
    vision: false,
  },
  {
    repo: "mlx-community/Qwen2.5-14B-Instruct-4bit",
    name: "qwen2.5-14b-instruct-4bit",
    label: "Qwen2.5 14B Instruct",
    approxMb: 8500,
    vision: false,
  },
  {
    repo: "mlx-community/Qwen2.5-32B-Instruct-4bit",
    name: "qwen2.5-32b-instruct-4bit",
    label: "Qwen2.5 32B Instruct",
    approxMb: 18500,
    vision: false,
  },
];

// ── "Scan my Mac" comfort tiers (pure — the Rust command supplies raw facts) ──

/** How much MODEL a Mac's unified memory comfortably carries. Rule of thumb for
 * 4-bit MLX weights on Apple Silicon: comfortable ≤ ~45% of RAM (the OS, the
 * apps, and the KV cache keep breathing room), workable ≤ ~65% (it runs, with
 * swap pressure under load). Display guidance, not a hard gate. */
export function comfortFor(ramGb: number): { comfortableMb: number; workableMb: number } {
  return { comfortableMb: ramGb * 1000 * 0.45, workableMb: ramGb * 1000 * 0.65 };
}

export type FitLabel = "great fit" | "workable" | "too big";

export function fitLabel(approxMb: number, ramGb: number): FitLabel {
  const c = comfortFor(ramGb);
  if (approxMb <= c.comfortableMb) return "great fit";
  if (approxMb <= c.workableMb) return "workable";
  return "too big";
}

/** The scan verdict line — one human sentence from the raw facts. */
export function scanVerdict(ramGb: number): string {
  const c = comfortFor(ramGb);
  const gb = (mb: number) => (mb / 1000).toFixed(0);
  return `comfortably runs models up to ~${gb(c.comfortableMb)} GB of weights (4-bit); up to ~${gb(c.workableMb)} GB is workable under load.`;
}

/** Derive a safe install name from a pasted HF repo id — the last path segment,
 * lowercased, non-slug chars → dashes. Matches the Rust `valid_name` law. */
export function nameFromRepo(repo: string): string {
  const last = repo.split("/").pop() ?? repo;
  return last
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
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
    cli("claude", "sonnet", "Claude Sonnet 5"),
    cli("claude", "opus", "Claude Opus"),
    cli("claude", "haiku", "Claude Haiku"),
    cli("claude", "fable", "Claude Fable 5"),
  ],
  codex: [
    cli("codex", "gpt-5.6-sol", "GPT-5.6 Sol"),
    cli("codex", "gpt-5.6-terra", "GPT-5.6 Terra"),
    cli("codex", "gpt-5.6-luna", "GPT-5.6 Luna"),
    cli("codex", "gpt-5.5", "GPT-5.5"),
    cli("codex", "gpt-5.4", "GPT-5.4"),
    cli("codex", "gpt-5.4-mini", "GPT-5.4 mini"),
    cli("codex", "gpt-5.3-codex-spark", "GPT-5.3 Codex Spark"),
  ],
  agy: [
    cli("agy", "Gemini 3.5 Flash (Medium)", "Gemini 3.5 Flash"),
    cli("agy", "Gemini 3.1 Pro (High)", "Gemini 3.1 Pro"),
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
 * usability gate. `blocked` hides individual CONNECTED models the user turned
 * off inside a lane (e.g. keep Sonnet, block Opus). */
export function mergedModels(
  local: ChatModelInfo[],
  enabled: Record<ProviderId, boolean>,
  presets: HybridPreset[],
  blocked: readonly string[] = [],
  ready?: Readonly<Partial<Record<ProviderId, boolean>>>,
): ModelGroups {
  const off = new Set(blocked);
  const connected: ChatModelInfo[] = [];
  for (const id of PROVIDER_IDS) {
    // Settings can omit `ready` while editing a lane. The chat supplies it so
    // an enabled-but-missing/expired CLI never masquerades as a usable model.
    if (enabled[id] && (ready === undefined || ready[id] === true)) {
      connected.push(...CLI_CATALOG[id].filter((m) => !off.has(m.id)));
    }
  }
  return { local, connected, presets: presets.map(presetModel) };
}

/** The cheapest model per lane for the toggle-on VERIFICATION ping — a real
 * one-line completion is the only honest "this lane works". */
export const LANE_PING_MODEL: Record<ProviderId, string> = {
  claude: "haiku",
  codex: "gpt-5.6-luna",
  agy: "Gemini 3.5 Flash (Medium)",
  gemini: "gemini-3-flash",
};

/** Ready-made hybrid presets (stable ids so re-adding never duplicates). They
 * reference Seth's real defaults — routes to a lane you haven't enabled simply
 * fall away at runtime (runHybrid degrades, never fails a turn). */
export const STARTER_PRESETS: HybridPreset[] = [
  {
    id: "starter-everyday",
    name: "Everyday — local first, frontier when it's hard",
    organizer: "gemma-3-12b-it-qat-4bit",
    routes: [
      { when: "notes lookups, summaries, quick questions", model: "gemma-3-12b-it-qat-4bit" },
      { when: "deep reasoning, long documents, careful writing", model: "sonnet" },
      { when: "code questions and debugging", model: "gpt-5.5" },
    ],
    fallback: "gemma-3-12b-it-qat-4bit",
  },
  {
    id: "starter-private",
    name: "Private by default",
    organizer: "qwen2.5-3b-instruct-4bit",
    routes: [
      { when: "almost everything — stay on this Mac", model: "gemma-3-12b-it-qat-4bit" },
      { when: "only when explicitly asked to go big or use the web's knowledge", model: "gemini-3-flash" },
    ],
    fallback: "gemma-3-12b-it-qat-4bit",
  },
  {
    id: "starter-delegate",
    name: "Frontier delegate — route to the specialist",
    organizer: "gemma-3-12b-it-qat-4bit",
    routes: [
      { when: "hard reasoning, analysis, strategy", model: "opus" },
      { when: "coding, refactors, technical depth", model: "gpt-5.5" },
      { when: "everything else", model: "sonnet" },
    ],
    fallback: "gemma-3-12b-it-qat-4bit",
  },
];

/** The flat pick-list (local first, so the `isDefault`/first fallback stays
 * on-device when a persisted choice goes stale). */
export function flattenModels(g: ModelGroups): ChatModelInfo[] {
  return [...g.local, ...g.connected, ...g.presets];
}
