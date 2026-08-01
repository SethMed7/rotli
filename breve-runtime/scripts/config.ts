/**
 * Breve local configuration — the one place that wires this install to its
 * environment. Secrets NEVER live here or in any committed file:
 *   • API keys / mail passwords → macOS Keychain
 *   • phone numbers / emails     → gitignored signal.json / recipients.json /
 *                                  mail-accounts.json (see their *.example files)
 * This module only resolves non-secret wiring — chiefly knowledgePath, the
 * memex knowledge base Breve reads from and routes captures into.
 *
 * Values come from config.local.json (gitignored; copy config.example.json),
 * overridable per-key by env. Missing config falls back to sane defaults so a
 * fresh checkout still runs.
 */
import { join } from "node:path";
import { homedir } from "node:os";
import { readFileSync } from "node:fs";

const expand = (p: string): string => (p.startsWith("~") ? join(homedir(), p.slice(1)) : p);

type LocalConfig = {
  knowledgePath?: string;
  assetsPath?: string;
  storagePath?: string;
  launchdOrg?: string;
  llm?: {
    provider?: string;
    providers?: Record<string, { endpoint?: string; model?: string; launchdLabel?: string; api?: string }>;
    endpoint?: string; model?: string; launchdLabel?: string; // legacy flat fallback (pre-provider)
    allowRemote?: boolean; // explicit opt-out of the loopback-only local-tier gate
  };
};

const CONFIG_PATH =
  process.env.BREVE_CONFIG ??
  join(process.env.ROTLI_BREVE_HOME ?? join(import.meta.dir, ".."), "config.local.json");

let local: LocalConfig = {};
try {
  local = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
} catch {
  // No local config yet — defaults below keep the app runnable.
}

/** Built-in defaults per local-model provider. MLX (Apple-native; weights in the shared ~/.memex/ai
 *  store) is the Mac default; Ollama is kept as a selectable backup (e.g. Gemma 4, which mlx-lm can't
 *  load yet). config.local.json "llm.providers" overrides these; env (BREVE_LLM_*) overrides all. */
const LLM_PROVIDER_DEFAULTS: Record<string, { endpoint: string; model: string; launchdLabel: string; api: string }> = {
  mlx:      { endpoint: "http://localhost:11435", model: "gemma-3-12b-it-qat-4bit", launchdLabel: "com.local.memex-mlx",      api: "generate" },
  llamacpp: { endpoint: "http://localhost:11436", model: "gemma4-12b-it-qat",       launchdLabel: "com.local.memex-llamacpp", api: "openai" },
  ollama:   { endpoint: "http://localhost:11434", model: "gemma4:12b-it-qat",       launchdLabel: "com.local.ollama-serve",    api: "generate" },
};

/** Is a model ENDPOINT loopback-local? The Breve local-model tier promises page text, Signal
 *  conversation text, and memex-derived prompts stay on the machine — so its endpoint MUST be
 *  loopback. Unparseable ⇒ false (fail closed).
 *
 *  MIRROR-NOT-IMPORT across the app boundary — the same locality rule is written THREE times so that
 *  no boundary inherits another's security policy by import: src/ai/guard.ts endpointIsLocal (the
 *  app's pre-flight check) · src-tauri/src/chat.rs endpoint_is_local (the Rust backstop) · this one
 *  (Breve's local tier). They stay in lockstep by FIXTURE, never by shared code: the agreed verdicts
 *  live in scripts/fixtures/parity.json → endpointLocality, and each side asserts them independently
 *  (src/lib/parity.test.ts · src-tauri/src/parity_tests.rs · breve-runtime/tests/test-config-locality.ts).
 *  Change the rule here and you must change all three + the fixture, or one of those suites fails. */
export function llmEndpointIsLocal(endpoint: string): boolean {
  let url: URL;
  try { url = new URL(endpoint); } catch { return false; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const h = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h === "::1") return true;
  const m = h.match(/^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  return m !== null && m.slice(1).every((o) => Number(o) <= 255);
}

/** Resolve the local-model wiring for a provider. `provider` (or env BREVE_LLM_PROVIDER, or config
 *  "llm.provider", default "mlx") selects the backend, so a use case can opt into Ollama for Gemma 4
 *  while everything else uses the Mac default (MLX). Switching the default is a config edit, not code.
 *
 *  LOCALITY GATE (audit 2026-07): the endpoint must be loopback. A config/env edit pointing this
 *  tier at a remote host would silently ship local-tier content off-machine — the Rust side pinned
 *  this invariant (endpoint_is_local); the Bun runtime now fails closed too. The escape hatch is the
 *  explicit knob `llm.allowRemote: true` (or env BREVE_LLM_ALLOW_REMOTE=1) per the memex Configuration
 *  Rule (knob-not-constant, safe default = loopback-only). */
export function llmConfig(provider?: string): { provider: string; endpoint: string; model: string; launchdLabel: string; api: string } {
  const llm = local.llm ?? {};
  const active = (provider ?? process.env.BREVE_LLM_PROVIDER ?? llm.provider ?? "mlx").toLowerCase();
  const p = (llm.providers ?? {})[active] ?? {};
  const d = LLM_PROVIDER_DEFAULTS[active] ?? LLM_PROVIDER_DEFAULTS.mlx;
  const endpoint = (process.env.BREVE_LLM_ENDPOINT ?? p.endpoint ?? llm.endpoint ?? d.endpoint).replace(/\/+$/, "");
  const allowRemote = process.env.BREVE_LLM_ALLOW_REMOTE === "1" || llm.allowRemote === true;
  if (!allowRemote && !llmEndpointIsLocal(endpoint)) {
    throw new Error(
      `Breve local-model endpoint "${endpoint}" is not loopback — local-tier content stays on the machine. ` +
        `Set llm.allowRemote:true (or BREVE_LLM_ALLOW_REMOTE=1) to deliberately override.`,
    );
  }
  return {
    provider: active,
    endpoint,
    model: process.env.BREVE_LLM_MODEL ?? p.model ?? llm.model ?? d.model,
    launchdLabel: process.env.BREVE_LLM_LAUNCHD ?? p.launchdLabel ?? llm.launchdLabel ?? d.launchdLabel,
    api: (process.env.BREVE_LLM_API ?? p.api ?? d.api ?? "generate"),
  };
}

/** The sentinel partition for a single-tenant install — resolves to the flat memex base (today). */
export const DEFAULT_USER = "__default__";

/** Reverse-DNS namespace for Breve's own launchd jobs (`<org>.breve-brief`, `<org>.breve-signal`, …).
 *  Generic default; set `launchdOrg` in config.local.json to YOUR namespace so the labels match the
 *  jobs you actually install (no migration). Env override: BREVE_LAUNCHD_ORG. */
export const launchdOrg = (): string => process.env.BREVE_LAUNCHD_ORG ?? local.launchdOrg ?? "com.local";

/** The memex BASE — the repo root that holds the contracts, clients/, and (if multi-tenant) the
 *  users.json registry + users/<name>/ partitions. This is the value `knowledgePath()` returns. */
const memexBase = (): string =>
  expand(process.env.BREVE_KNOWLEDGE ?? local.knowledgePath ?? join(homedir(), "memex-vault"));

/** The memex knowledge base Breve reads and routes captures into (the memex base / default partition). */
export const knowledgePath = (): string => memexBase();

// DELIBERATE MIRROR of memex/scripts/mounts.ts (registry / accessMode / userRoot). Rotli's embedded
// brief runtime has NO memex implementation dependency: the knowledge base is resolved by PATH at
// runtime and may be ABSENT on a fresh install, so these readers must work before/without a healthy memex. DO NOT "DRY
// this up" by importing mounts.ts — that re-introduces module-load coupling and crashes Breve when the
// memex is missing or its engine has drifted. These track the FROZEN file-format contract
// (users.json / mode); the accessMode fail-closed table below must stay byte-identical to mounts.ts.
/** One partition owner in users.json. */
export type MemexUser = { name: string; role?: string; path?: string; powers?: string[] };

/** The memex partition registry + access policy (users.json). */
export type MemexRegistry = {
  primary?: string;
  mode?: "local" | "open" | "secure";
  auth?: { stepUp?: string[] };
  users: MemexUser[];
};

/** Read the memex partition registry + access POLICY (the WHERE + the rules). Null when single-tenant. */
export function readMemexRegistry(): MemexRegistry | null {
  try {
    const reg = JSON.parse(readFileSync(join(memexBase(), "users.json"), "utf8"));
    return Array.isArray(reg?.users) ? reg : null;
  } catch { return null; }
}

/** The access mode the app honors. No registry ⇒ "local"; a registry with no explicit mode ⇒ "secure".
 *  Normalize + FAIL CLOSED: any malformed/typo/non-string value (e.g. "Secure", "secure ", "", 0)
 *  collapses to "secure" so a corrupt mode can never silently disable the step-up gate (FORGE M3). */
export function accessMode(): "local" | "open" | "secure" {
  const reg = readMemexRegistry();
  if (!reg) return "local";
  const m = typeof reg.mode === "string" ? reg.mode.trim().toLowerCase() : "";
  return m === "local" || m === "open" ? m : "secure";
}

/** The shared, gitignored identity handles (name → phone/uuid/email) — the SAME store every frontend
 *  resolves a login against. PII; never committed. Absent ⇒ {} (single-user / local). */
export function readMemexIdentities(): Record<string, { phone?: string; uuid?: string; email?: string }> {
  try {
    const r = JSON.parse(readFileSync(join(memexBase(), "identities.local.json"), "utf8"));
    return r && typeof r === "object" ? r : {};
  } catch { return {}; }
}

/** The memex instance identity card (memex.json): { id, contract, apps }. null if not stamped. Breve
 *  pins to this id so a swapped/wrong memex is noticed, and checks the contract before relying on it. */
export function memexInfo(): { id?: string; contract?: string; selfHeal?: boolean; apps?: Record<string, unknown> } | null {
  try {
    const r = JSON.parse(readFileSync(join(memexBase(), "memex.json"), "utf8"));
    return r && typeof r.id === "string" ? r : null;
  } catch { return null; }
}

/** Resolve a memex partition's root. __default__/absent registry ⇒ the flat base (the memex root).
 *  Otherwise the registry's declared path (""=base) or the users/<name> convention. */
export function knowledgePathFor(user: string | undefined): string {
  const base = memexBase();
  if (!user || user === DEFAULT_USER) return base;
  const reg = readMemexRegistry();
  const entry = reg?.users?.find((u) => u.name === user);
  if (entry) return entry.path ? join(base, entry.path) : base;
  return join(base, "users", user); // convention fallback (registry not yet written)
}

// Per-partition path helpers (a connected app resolves the active user, then derives all roots from it).
export const inboxPathFor = (u?: string): string => join(knowledgePathFor(u), "inbox.md");
export const mapPathFor = (u?: string): string => join(knowledgePathFor(u), "MAP.md");
export const historyPathFor = (u?: string): string => join(knowledgePathFor(u), "history");
export const chatsPathFor = (u?: string): string => join(knowledgePathFor(u), "chats");

/** The capture buffer the briefs drain (lives in the knowledge base, not in Breve). */
export const inboxPath = (): string => join(knowledgePath(), "inbox.md");

/** The llmWiki index/spine — summaries + [[links]] (the memex MAP.md). */
export const mapPath = (): string => join(knowledgePath(), "MAP.md");

/** By-day conversation stream — message-platform shape (the memex history/<YYYY>/<YYYY-MM-DD>.md). */
export const historyPath = (): string => join(knowledgePath(), "history");

/** Named, attachable conversations — chat-system shape (the memex chats/<slug>.md). */
export const chatsPath = (): string => join(knowledgePath(), "chats");

/** Client layer — per-model rules. SHARED/install-level: always at the memex base (the repo root),
 *  not per-partition (matches memex v3.3, where clients/ stays at REPO_ROOT). */
export const clientsPath = (): string => join(memexBase(), "clients");

/** Binaries for knowledge notes — the `storage:` root. The memex spine itself stays text-only. */
export const assetsPath = (): string =>
  expand(process.env.BREVE_ASSETS ?? local.assetsPath ?? join(homedir(), "memex-storage", "assets"));

/** Breve's own output store (rendered briefs/audio/captures). Config-driven so binaries never land in
 *  Rotli's managed runtime. Default sits beside the memex; override via config or env BREVE_STORAGE. */
export const storagePath = (): string =>
  expand(process.env.BREVE_STORAGE ?? local.storagePath ?? join(homedir(), "memex-storage"));

/** Per-partition asset store. The primary / single-tenant default keeps the shared base (today); a
 *  persona gets an ISOLATED subdir so one persona's binaries never sit in another's store. Members'
 *  sandbox is scoped to this, so a member can store binaries without reaching the shared store. */
export function assetsPathFor(user: string | undefined): string {
  const base = assetsPath();
  if (!user || user === DEFAULT_USER) return base;
  const reg = readMemexRegistry();
  if (reg && user === reg.primary) return base;
  return join(base, "users", user);
}

/** External resources registry — `clients/resources.json` in the brain: the curated sources Breve may
 *  fetch from + the per-source fetch guards. The brain HOLDS the list; Breve does the fetching (via
 *  scripts/safe-fetch.ts), content stays on the LOCAL tier. Resolved from the brain root, never hardcoded. */
export const resourcesPath = (): string => join(clientsPath(), "resources.json");

export type Resource = {
  id: string; name?: string; url: string; host?: string; kind?: string; lens?: string;
  cadence?: string; tier?: string; trust?: string; favorite?: boolean; reference?: string; enabled?: boolean;
};

/** Registry-wide fallbacks a Resource entry may override, same field set as Resource. */
export type ResourceDefaults = Partial<Omit<Resource, "name" | "url">>;

/** Read the resources registry (defaults + entries). Returns empty if absent — Breve degrades gracefully. */
export function loadResources(): { defaults: ResourceDefaults; resources: Resource[] } {
  try {
    const r = JSON.parse(readFileSync(resourcesPath(), "utf8"));
    return { defaults: r.defaults ?? {}, resources: Array.isArray(r.resources) ? r.resources : [] };
  } catch {
    return { defaults: {}, resources: [] };
  }
}
