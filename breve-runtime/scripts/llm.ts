/**
 * BREVE local-model wiring — the ONE place the on-device model tier is configured + called.
 * Provider-selectable, and API-shape-aware:
 *   • mlx (DEFAULT on Mac) — Apple MLX via the memex server (~/.memex/ai/mlx-server.py); Ollama wire
 *     shape (POST /api/generate). Weights in the shared store ~/.memex/ai.
 *   • llamacpp (BACKUP) — raw llama.cpp `llama-server` serving a GGUF (e.g. Gemma 4); OpenAI wire shape
 *     (POST /v1/chat/completions). No Ollama daemon — same engine Ollama wrapped, ours to control.
 * A caller targets a backend for one request with { provider: "llamacpp" }; everything else uses the
 * default. Switching the default is a config edit (config.local.json "llm.provider"/"llm.providers"),
 * not a code change. `cfg.api` ("generate" | "openai") selects the wire shape; callers are identical.
 */
import { llmConfig } from "./config";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

let _apiKey: string | null = null;
/** The 0600 local API key the llama.cpp backup is started with — loopback isn't a trust boundary on a
 *  machine with a browser, so the OpenAI-shape calls authenticate. (/health stays exempt.) */
function apiKey(): string {
  if (_apiKey === null) {
    try { _apiKey = readFileSync(process.env.MEMEX_API_KEY_FILE ?? `${homedir()}/.memex/ai/.api-key`, "utf8").trim(); }
    catch { _apiKey = ""; }
  }
  return _apiKey;
}

/** The DEFAULT provider's resolved wiring (provider · endpoint · model · launchd label · api). */
export const LLM = llmConfig();

type GenReq = {
  prompt: string;
  options?: Record<string, unknown>;
  format?: unknown;
  model?: string;
  think?: boolean;
  provider?: string; // override the backend for THIS call (e.g. "llamacpp" for Gemma 4)
};

const cfgFor = (provider?: string) => (provider ? llmConfig(provider) : LLM);

/** Append a JSON-only instruction (used for structured-output requests on every backend). */
function jsonGuide(format: unknown): string {
  const schema = format && typeof format === "object" ? JSON.stringify(format) : "";
  return `\n\nReturn ONLY a single valid JSON object${schema ? ` matching this JSON schema: ${schema}` : ""}. No prose, no markdown, no code fences.`;
}
/** Pull the first {...} object out of a reply (defensive — models occasionally wrap JSON in prose). */
function extractJson(s: string): string {
  const i = s.indexOf("{"), j = s.lastIndexOf("}");
  return i !== -1 && j > i ? s.slice(i, j + 1) : s;
}

/** Ollama wire shape (POST /api/generate) — the memex MLX server + Ollama. */
async function genGenerate(cfg: ReturnType<typeof llmConfig>, req: GenReq): Promise<string> {
  const res = await fetch(`${cfg.endpoint}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: req.model ?? cfg.model,
      stream: false,
      think: req.think ?? false,
      ...(req.options ? { options: req.options } : {}),
      ...(req.format !== undefined ? { format: req.format } : {}),
      prompt: req.prompt,
    }),
  });
  return (((await res.json()) as { response?: string }).response ?? "").toString();
}

/** Health of an OpenAI-shape (llama.cpp) server: /health is {"status":"ok"} once the model has loaded. */
async function llamaHealthy(endpoint: string): Promise<boolean> {
  try {
    const r = await fetch(`${endpoint}/health`, { signal: AbortSignal.timeout(2000) });
    if (!r.ok) return false; // 503 while the model loads
    return ((await r.json().catch(() => ({}))) as { status?: string }).status === "ok";
  } catch { return false; }
}

/** Lazy-start an on-demand backup (llama.cpp) via its launchd job, then wait out the model load. Keeps
 *  the backup at 0 RAM until something needs it — memory-friendly vs an always-resident server. */
async function ensureUp(cfg: ReturnType<typeof llmConfig>, maxWaitS = 45): Promise<boolean> {
  if (await llamaHealthy(cfg.endpoint)) return true;
  if (cfg.launchdLabel) {
    try { Bun.spawnSync(["launchctl", "kickstart", `gui/${process.getuid!()}/${cfg.launchdLabel}`]); } catch {}
  }
  for (let i = 0; i < maxWaitS; i++) { if (await llamaHealthy(cfg.endpoint)) return true; await Bun.sleep(1000); }
  return false; // bounded — the caller surfaces a "warming up" message instead of hanging forever
}

/** OpenAI wire shape (POST /v1/chat/completions) — llama.cpp `llama-server`. */
async function genOpenAI(cfg: ReturnType<typeof llmConfig>, req: GenReq): Promise<string> {
  const opts = req.options ?? {};
  // Backup is on-demand: bring it up (lazy). If it can't warm in time, fail loud-but-graceful rather
  // than hang — the caller turns this into a "warming up, try again" reply.
  if (!(await ensureUp(cfg))) throw new Error(`local model (${cfg.provider}) is warming up — try again in a moment`);
  const content = req.format !== undefined ? req.prompt + jsonGuide(req.format) : req.prompt;
  const key = apiKey();
  const res = await fetch(`${cfg.endpoint}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({
      model: req.model ?? cfg.model,
      messages: [{ role: "user", content }],
      temperature: typeof opts.temperature === "number" ? opts.temperature : 0.7,
      max_tokens: typeof opts.num_predict === "number" && opts.num_predict > 0 ? opts.num_predict : 4096,
      stream: false,
    }),
  });
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const out = (j.choices?.[0]?.message?.content ?? "").toString();
  return req.format !== undefined ? extractJson(out) : out;
}

/** Generate a completion from the local model (routes by the active provider's wire shape). */
export async function localGenerate(req: GenReq): Promise<string> {
  const cfg = cfgFor(req.provider);
  return (cfg.api === "openai" ? genOpenAI(cfg, req) : genGenerate(cfg, req));
}

/** Generate + JSON.parse — for structured-output callers that pass a `format` schema. */
export async function localGenerateJSON<T = any>(req: GenReq): Promise<T> {
  return JSON.parse(await localGenerate(req)) as T;
}

/** Best-effort pre-touch: start loading the default (or given) provider's model NOW, so the next real
 *  request is warm. Fire-and-forget — do NOT await on the hot path (e.g. call on an inbound message).
 *  MLX loads via GET /warmup; the llama.cpp backup is lazy-started via its launchd job. */
export async function warmup(provider?: string): Promise<void> {
  const cfg = cfgFor(provider);
  try {
    if (cfg.api === "openai") { await ensureUp(cfg); return; }
    await fetch(`${cfg.endpoint}/warmup`, { signal: AbortSignal.timeout(30000) });
  } catch { /* warming is best-effort; a cold real request still works, just slower */ }
}

/** Is the local model server reachable? (health endpoint depends on the provider's API shape.) */
export async function localUp(provider?: string, timeoutMs = 3000): Promise<boolean> {
  const cfg = cfgFor(provider);
  const path = cfg.api === "openai" ? "/health" : "/api/version";
  try {
    return (await fetch(`${cfg.endpoint}${path}`, { signal: AbortSignal.timeout(timeoutMs) })).ok;
  } catch {
    return false;
  }
}

/** launchctl argv to (re)start the local model service for the given/default provider, or null. */
export function localRestartArgv(uid: number, provider?: string): string[] | null {
  const label = cfgFor(provider).launchdLabel;
  return label ? ["launchctl", "kickstart", "-k", `gui/${uid}/${label}`] : null;
}
