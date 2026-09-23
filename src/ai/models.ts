// The model catalog seam. LOCAL models come from the memex-ai store. The three
// connected lanes Rotli exposes are Claude Code, Codex, and Cursor through the
// user's own authenticated official clients. Cursor is code-chat only and uses
// its documented ACP custom-client protocol in read-only Ask mode. Unsupported
// provider ids are rejected again at the native boundary.
//
// Connected CLI models carry `endpoint: ""` ON PURPOSE: the secure-note gate
// derives locality from the endpoint and `endpoint_is_local("")` fails CLOSED
// (chat.rs / guard.ts), so a `secure: true` note can never reach a connected
// model without any new gating code.

import type { DiscoveredModel } from "../lib/cliModelTypes";
import type { ChatModelInfo } from "../lib/tauri";
import { currentDiscovery, type DiscoveryLanes } from "../state/connectedModels";

/** The connectable provider lanes (Settings → AI Models). */
export type ProviderId = "claude" | "codex" | "cursor" | "antigravity";
export type ConnectedProviderId = ProviderId;
export const PROVIDER_IDS: readonly ProviderId[] = ["claude", "codex", "cursor", "antigravity"];

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  claude: "Claude Code",
  codex: "Codex",
  cursor: "Cursor · Code chat",
  antigravity: "Antigravity · Gemini",
};

/** Initial explicit choices for a provider tag with no model suffix. Claude's
 * `default` is the account's own default in Claude Code (run with no model
 * flag); Codex and Cursor use provider-documented ids validated for Rotli. */
export const DEFAULT_PROVIDER_MODELS: Record<ProviderId, string> = {
  claude: "default",
  codex: "gpt-6-sol",
  cursor: "grok-4.6",
  antigravity: "gemini-3.8-flash-high",
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

const cli = (provider: ProviderId, id: string, label: string, vision = true): ChatModelInfo => ({
  id,
  label,
  provider,
  endpoint: "", // remote — fails the locality check on purpose (see header)
  api: "cli",
  vision,
  isDefault: DEFAULT_PROVIDER_MODELS[provider] === id,
});

/** The OFFLINE fallback: what each client offered when this was written
 * (2026-09-23). The live list is discovered from the client itself
 * (`providerCatalog`); Rust independently allowlists both before any spawn. */
export const CLI_CATALOG: Record<ProviderId, ChatModelInfo[]> = {
  claude: [
    cli("claude", "default", "Claude Default · Opus 5.5 (1M context)"),
    cli("claude", "opus[1m]", "Claude Opus 5.5 (1M context)"),
    cli("claude", "claude-fable-5-1[1m]", "Claude Fable 5.1"),
    cli("claude", "sonnet", "Claude Sonnet 5"),
    cli("claude", "haiku", "Claude Haiku 4.5"),
  ],
  codex: [
    cli("codex", "gpt-6-astra", "GPT-6 Astra"),
    cli("codex", "gpt-6-sol", "GPT-6 Sol"),
    cli("codex", "gpt-6-luna", "GPT-6 Luna"),
    cli("codex", "gpt-5.6-sol", "GPT-5.6 Sol"),
    cli("codex", "gpt-5.6-terra", "GPT-5.6 Terra"),
    cli("codex", "gpt-5.6-luna", "GPT-5.6 Luna"),
    cli("codex", "gpt-5.5", "GPT-5.5"),
  ],
  cursor: [
    cli("cursor", "grok-4.6", "Grok 4.6", false),
    // Kept as an explicit alternative for users who prefer Cursor to choose.
    // Native argv omits --model for this stable Rotli id.
    cli("cursor", "cursor-auto", "Cursor Auto", false),
  ],
  // Google's official ACP agent (ADR 2026-09-03). Ids are the agent's own
  // config-option values; Rust re-validates each turn against the account's
  // list and names what is available on mismatch. Images ride the ACP prompt
  // as blocks (2026-09-17, acp_images.rs); the agent advertises them.
  antigravity: [
    cli("antigravity", "gemini-3.8-flash-high", "Gemini 3.8 Flash (High)"),
    cli("antigravity", "gemini-3.8-flash-medium", "Gemini 3.8 Flash (Medium)"),
    cli("antigravity", "gemini-3.8-flash-low", "Gemini 3.8 Flash (Low)"),
    cli("antigravity", "gemini-3.7-flash-high", "Gemini 3.7 Flash (High)"),
    cli("antigravity", "gemini-3.7-flash-medium", "Gemini 3.7 Flash (Medium)"),
    cli("antigravity", "gemini-3.7-flash-low", "Gemini 3.7 Flash (Low)"),
  ],
};

/** Mirror of Rust `provider_models::valid_model_id` — the only id shape that
 * may reach argv. */
export function isModelIdShape(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}(\[1m\])?$/.test(id);
}

function discoveredInfo(provider: ProviderId, model: DiscoveredModel, isDefault: boolean): ChatModelInfo {
  return {
    id: model.id,
    label: model.label,
    provider,
    endpoint: "",
    api: "cli",
    vision: model.vision,
    isDefault,
  };
}

/** One lane's picker list: what the client itself reported once discovery
 * has answered, else the offline fallback. Exactly one entry is the default —
 * the client's own default entry, else the reviewed default, else the first. */
export function providerCatalog(
  provider: ProviderId,
  lanes: DiscoveryLanes = currentDiscovery(),
): ChatModelInfo[] {
  const lane = lanes[provider];
  if (lane?.status !== "ready" || lane.models.length === 0) return CLI_CATALOG[provider];
  const own =
    lane.models.find((model) => model.isDefault)?.id ??
    lane.models.find((model) => model.id === DEFAULT_PROVIDER_MODELS[provider])?.id ??
    lane.models[0]!.id;
  return lane.models.map((model) => discoveredInfo(provider, model, model.id === own));
}

/** The client-reported entry for a model, when discovery has one. */
export function discoveredModel(
  provider: string | undefined,
  id: string | undefined,
  lanes: DiscoveryLanes = currentDiscovery(),
): DiscoveredModel | undefined {
  const lane = provider && id ? lanes[provider as ProviderId] : undefined;
  return lane?.status === "ready" ? lane.models.find((model) => model.id === id) : undefined;
}

const CLAUDE_FAMILIES = new Set(["opus", "fable", "sonnet", "haiku"]);

/** The entry in `list` a saved id means. Exact first; then the ids older
 * versions saved: Claude's bare family aliases (`opus` → `opus[1m]`) and
 * retired built-in ids that share a label with a live entry (Cursor's
 * `grok-4.6` → the `cursor-grok-4.6-high` Cursor lists as "Grok 4.6"). */
export function findModel(list: readonly ChatModelInfo[], id: string): ChatModelInfo | undefined {
  const exact = list.find((model) => model.id === id);
  if (exact) return exact;
  const family = id.toLowerCase();
  if (CLAUDE_FAMILIES.has(family)) {
    const hit = list.find((m) => m.provider === "claude" && m.id !== "default" && m.id.includes(family));
    if (hit) return hit;
  }
  const retired = PROVIDER_IDS.flatMap((p) => CLI_CATALOG[p]).find((model) => model.id === id);
  return retired ? list.find((m) => m.provider === retired.provider && m.label === retired.label) : undefined;
}

/** What a saved model id resolves to on its lane, or null when it must heal:
 * a live (or aliased) entry wins; while discovery has not answered, a
 * well-formed id is KEPT — it may be one the client reports — and only a
 * discovery answer without it (or a failed discovery) retires it. */
export function resolveLaneModel(
  provider: ProviderId,
  id: string | null | undefined,
  lanes: DiscoveryLanes = currentDiscovery(),
): string | null {
  if (!id || !isModelIdShape(id)) return null;
  const hit = findModel(providerCatalog(provider, lanes), id);
  if (hit) return hit.id;
  // another lane's model never crosses over, answered or not
  const foreign = PROVIDER_IDS.some(
    (other) => other !== provider && CLI_CATALOG[other].some((m) => m.id === id),
  );
  if (foreign || (provider !== "claude" && CLAUDE_FAMILIES.has(id.toLowerCase()))) return null;
  const status = lanes[provider]?.status;
  return status === "ready" || status === "error" ? null : id;
}

/** A persisted provider default, resolved against the lane's live catalog.
 * Stale/hand-edited values heal to the lane default instead of becoming argv
 * or silently crossing providers. */
export function providerDefaultModel(
  provider: ProviderId,
  configured?: Readonly<Partial<Record<ProviderId, string>>> | null,
  lanes: DiscoveryLanes = currentDiscovery(),
): string {
  const catalog = providerCatalog(provider, lanes);
  const fallback =
    (catalog.find((model) => model.isDefault) ?? catalog[0])?.id ?? DEFAULT_PROVIDER_MODELS[provider];
  return resolveLaneModel(provider, configured?.[provider], lanes) ?? fallback;
}

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
  lanes: DiscoveryLanes = currentDiscovery(),
): ModelGroups {
  const off = new Set(blocked);
  const connected: ChatModelInfo[] = [];
  for (const id of PROVIDER_IDS) {
    // Settings can omit `ready` while editing a lane. The chat supplies it so
    // an enabled-but-missing/expired CLI never masquerades as a usable model.
    if (enabled[id] && (ready === undefined || ready[id] === true)) {
      connected.push(...providerCatalog(id, lanes).filter((m) => !off.has(m.id)));
    }
  }
  return { local, connected, presets: presets.map(presetModel) };
}

/** Cheapest verification model for each executable connected lane. */
export const LANE_PING_MODEL: Record<ConnectedProviderId, string> = {
  claude: "haiku",
  codex: "gpt-6-luna",
  cursor: "cursor-auto",
  antigravity: "gemini-3.8-flash-low",
};

/** Ready-made presets use a local organizer and at most the allowed official
 * Claude Code/Codex lanes. Disabled routes degrade to the on-device fallback. */
export const STARTER_PRESETS: HybridPreset[] = [
  {
    id: "starter-everyday",
    name: "Everyday — local first, frontier when it's hard",
    organizer: "gemma-3-12b-it-qat-4bit",
    routes: [
      { when: "notes lookups, summaries, quick questions", model: "gemma-3-12b-it-qat-4bit" },
      { when: "deep reasoning, long documents, careful writing", model: "sonnet" },
      { when: "code questions and debugging", model: "gpt-6-sol" },
    ],
    fallback: "gemma-3-12b-it-qat-4bit",
  },
  {
    id: "starter-delegate",
    name: "Frontier delegate — route to the specialist",
    organizer: "gemma-3-12b-it-qat-4bit",
    routes: [
      { when: "hard reasoning, analysis, strategy", model: "opus[1m]" },
      { when: "coding, refactors, technical depth", model: "gpt-6-sol" },
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

/** Every connected entry Rotli knows: the live lists, then the built-in ones
 * (a saved id from an older list still finds its lane and label). */
function knownConnected(lanes: DiscoveryLanes): ChatModelInfo[] {
  return PROVIDER_IDS.flatMap((p) => [...providerCatalog(p, lanes), ...CLI_CATALOG[p]]);
}

/** Which LANE a model id belongs to ("claude", "codex", "cursor",
 * "preset", or a local model's own provider). Undefined when the id matches
 * nothing rotli knows. Sibling of modelLabel — same three-catalog search, so
 * the label and the vendor mark can never disagree about a model. */
export function modelProvider(
  id: string,
  local: readonly ChatModelInfo[],
  presets: readonly HybridPreset[],
  lanes: DiscoveryLanes = currentDiscovery(),
): string | undefined {
  return (
    local.find((m) => m.id === id)?.provider ??
    findModel(knownConnected(lanes), id)?.provider ??
    (presets.some((p) => `${PRESET_PREFIX}${p.id}` === id) ? "preset" : undefined)
  );
}

/** The lane behind a model value no catalog knows any more: the old picker
 * stored its LABEL ("Gemini 3.5 Flash (Medium)"), and a retired Gemini id has
 * no lane entry — both are Google's Antigravity lane, never "this Mac". */
export function legacyModelProvider(id: string): string | undefined {
  return /^gemini[ -]\d/i.test(id) ? "antigravity" : undefined;
}

/** A model id's human label wherever one is known — the local store's listing,
 * any CLI lane's catalog (enabled or not: a sidebar badge should still read
 * well for a lane that's currently off), or a hybrid preset's name — else the
 * raw id. For the sidebar's per-chat model chip. */
export function modelLabel(
  id: string,
  local: readonly ChatModelInfo[],
  presets: readonly HybridPreset[],
  lanes: DiscoveryLanes = currentDiscovery(),
): string {
  return (
    local.find((m) => m.id === id)?.label ??
    findModel(knownConnected(lanes), id)?.label ??
    presets.find((p) => p.id === id)?.name ??
    id
  );
}
