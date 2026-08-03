// Hybrid presets — "use whatever I want, when it fits": an ORGANIZER model
// reads the prompt and picks one of the preset's ROUTES; the routed model runs
// the normal agent loop; a FALLBACK catches a failed executor. A thin layer
// ABOVE runAgent that yields the same AgentEvent union, so ChatSurface renders
// it with zero changes. Routing must never fail a turn: an unusable organizer
// or an unparseable choice degrades to the first route.

import type { ChatModelInfo } from "../lib/tauri";
import { runAgent } from "./loop";
import { type HybridPreset, PRESET_PREFIX } from "./models";
import { extractJsonObject } from "./parse";
import type { AgentEvent, Host, RunInput } from "./types";

/** The preset behind a dropdown pick (`preset:<id>`), or null. */
export function presetFor(pickedId: string, presets: HybridPreset[]): HybridPreset | null {
  if (!pickedId.startsWith(PRESET_PREFIX)) return null;
  const id = pickedId.slice(PRESET_PREFIX.length);
  return presets.find((p) => p.id === id) ?? null;
}

/** The organizer's one-shot routing prompt — numbered routes, one JSON out. */
export function routingPrompt(routes: { when: string; model: string }[], userText: string): string {
  const listed = routes.map((r, i) => `${i + 1}. ${r.when || r.model}`).join("\n");
  return `You route a user's message to the best-suited model. The routes:
${listed}

Reply with EXACTLY ONE JSON object and nothing else:
{"route": <route number>, "refinedPrompt": "<optional: the message, cleaned up for the chosen model>"}
Omit refinedPrompt unless rewriting genuinely helps.

The user's message:
${userText}`;
}

export interface RouteChoice {
  /** 1-based route number, validated against the route count. */
  route: number;
  refinedPrompt?: string;
}

/** Parse the organizer's reply defensively — anything off returns null (the
 * caller falls back to route 1; routing never fails the turn). */
export function parseRouteChoice(raw: string, routeCount: number): RouteChoice | null {
  const obj = extractJsonObject(raw);
  if (obj === null) return null;
  try {
    const d = JSON.parse(obj) as { route?: unknown; refinedPrompt?: unknown };
    const route = typeof d.route === "number" ? Math.trunc(d.route) : NaN;
    if (!Number.isFinite(route) || route < 1 || route > routeCount) return null;
    const refined =
      typeof d.refinedPrompt === "string" && d.refinedPrompt.trim() ? d.refinedPrompt.trim() : undefined;
    return refined ? { route, refinedPrompt: refined } : { route };
  } catch {
    return null;
  }
}

type MakeHost = (model: ChatModelInfo, opts?: { requestId?: string }) => Host;

/** Drive one turn through a preset: route → execute → (on ⚠/throw) fall back
 * once. Yields the standard AgentEvent stream, final included. */
export async function* runHybrid(
  preset: HybridPreset,
  models: ChatModelInfo[],
  input: RunInput,
  makeHost: MakeHost,
  requestId?: string,
): AsyncGenerator<AgentEvent, void, void> {
  const byId = new Map(models.map((m) => [m.id, m]));
  const routes = preset.routes
    .map((r) => ({ when: r.when, model: byId.get(r.model) }))
    .filter((r): r is { when: string; model: ChatModelInfo } => !!r.model);
  if (routes.length === 0) {
    yield {
      type: "final",
      text: "⚠ This preset's route models aren't available — enable their lanes in Settings → AI Models.",
    };
    return;
  }

  // 1) route — only worth a model call when there's a real choice to make
  let chosen = routes[0] as { when: string; model: ChatModelInfo };
  let refined: string | undefined;
  const organizer = byId.get(preset.organizer);
  if (organizer && routes.length > 1) {
    yield { type: "status", text: `routing via ${organizer.label}…` };
    try {
      const raw = await makeHost(organizer, requestId ? { requestId } : undefined).complete({
        messages: [{ role: "user", content: routingPrompt(preset.routes, input.userText) }],
        // local generate models get the server-side JSON coercion; the rest
        // follow the instruction
        formatJson: organizer.api === "generate",
      });
      const choice = parseRouteChoice(raw, routes.length);
      if (choice) {
        chosen = routes[choice.route - 1] ?? chosen;
        refined = choice.refinedPrompt;
      }
    } catch {
      // organizer down ≠ turn down — first route carries it
    }
  }

  // 2) execute — the routed model runs the NORMAL agent loop
  yield { type: "status", text: `→ ${chosen.model.label}` };
  const runOn = async function* (
    model: ChatModelInfo,
    userText: string,
  ): AsyncGenerator<AgentEvent, string, void> {
    let final = "";
    try {
      const host = makeHost(model, requestId ? { requestId } : undefined);
      const events = runAgent(host, {
        ...input,
        userText,
        model: { id: model.id, api: model.api },
        // a preset runs one or more inner legs (route + maybe a fallback); only
        // the OUTER final is the turn's answer, so inner legs stay buffered —
        // their tokens must not stream into the surface as if they were it.
        stream: false,
      });
      for await (const ev of events) {
        if (ev.type === "final") final = ev.text;
        else yield ev;
      }
    } catch (e) {
      final = `⚠ ${e instanceof Error ? e.message : String(e)}`;
    }
    return final;
  };

  let final = yield* runOn(chosen.model, refined ?? input.userText);

  // 3) a failed executor gets ONE fallback; a second failure surfaces as-is
  const fallback = preset.fallback ? byId.get(preset.fallback) : undefined;
  if (final.startsWith("⚠") && fallback && fallback.id !== chosen.model.id) {
    yield { type: "status", text: `falling back to ${fallback.label}…` };
    final = yield* runOn(fallback, input.userText);
  }

  yield { type: "final", text: final || "(the model returned nothing)" };
}

// ── "Generate templates" (Settings → AI Models) ───────────────────────────────

/** Ask a model to design 3 presets for the user's described usage, restricted
 * to the models actually available. Defensive parse — garbage returns []. */
export async function suggestPresets(
  host: Host,
  candidates: ChatModelInfo[],
  usage: string,
): Promise<HybridPreset[]> {
  const listed = candidates.map((m) => `- "${m.id}" — ${m.label}`).join("\n");
  const prompt = `Design exactly 3 hybrid model presets for this user. A preset sends every message to an ORGANIZER model that routes it to one of 2-3 ROUTES (each a "when …" description + a model); an optional FALLBACK model catches failures. Prefer a small/fast organizer and match stronger models to harder routes.

Allowed model ids (use these EXACTLY, nothing else):
${listed}

What the user mostly does: ${usage}

Reply with ONLY a JSON array of 3 presets, shaped:
[{"name":"…","organizer":"<model id>","routes":[{"when":"…","model":"<model id>"}],"fallback":"<model id, optional>"}]`;
  const raw = await host.complete({ messages: [{ role: "user", content: prompt }] });
  return parseSuggestions(raw, new Set(candidates.map((m) => m.id)));
}

/** Shape-validate the suggestions (exported for tests): unknown model ids kill
 * a route (and an entry with no surviving routes); at most 3 come back. */
export function parseSuggestions(raw: string, allowed: ReadonlySet<string>): HybridPreset[] {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const out: HybridPreset[] = [];
  for (const item of arr) {
    if (out.length >= 3) break;
    if (typeof item !== "object" || item === null) continue;
    const p = item as Record<string, unknown>;
    if (typeof p.name !== "string" || !p.name.trim()) continue;
    if (typeof p.organizer !== "string" || !allowed.has(p.organizer)) continue;
    if (!Array.isArray(p.routes)) continue;
    const routes: { when: string; model: string }[] = [];
    for (const r of p.routes) {
      if (typeof r !== "object" || r === null) continue;
      const route = r as Record<string, unknown>;
      if (typeof route.model !== "string" || !allowed.has(route.model)) continue;
      routes.push({ when: typeof route.when === "string" ? route.when : "", model: route.model });
    }
    if (routes.length === 0) continue;
    const fallback = typeof p.fallback === "string" && allowed.has(p.fallback) ? p.fallback : undefined;
    out.push({
      id: crypto.randomUUID(),
      name: p.name.trim(),
      organizer: p.organizer,
      routes,
      ...(fallback ? { fallback } : {}),
    });
  }
  return out;
}
