// The hybrid layer, proven without models: scripted fake Hosts per model id,
// so routing, refined prompts, degraded routing, and the one-shot fallback are
// deterministic. runHybrid drives the REAL runAgent under each route.

import { describe, expect, test } from "bun:test";
import type { ChatModelInfo } from "../lib/tauri";
import { parseRouteChoice, parseSuggestions, presetFor, runHybrid, suggestPresets } from "./hybrid";
import type { HybridPreset } from "./models";
import type { AgentEvent, Host, RunInput } from "./types";

const gemma: ChatModelInfo = {
  id: "gemma-3",
  label: "gemma-3 · MLX",
  provider: "mlx",
  endpoint: "http://localhost:11435",
  api: "generate",
  vision: true,
  isDefault: true,
};
const sonnet: ChatModelInfo = {
  id: "sonnet",
  label: "Claude Sonnet",
  provider: "claude",
  endpoint: "",
  api: "cli",
  vision: false,
  isDefault: false,
};
const gpt: ChatModelInfo = {
  id: "gpt-5.5",
  label: "GPT-5.5",
  provider: "codex",
  endpoint: "",
  api: "cli",
  vision: false,
  isDefault: false,
};
const MODELS = [gemma, sonnet, gpt];

const PRESET: HybridPreset = {
  id: "p1",
  name: "My hybrid",
  organizer: "gemma-3",
  routes: [
    { when: "quick lookups", model: "sonnet" },
    { when: "hard reasoning", model: "gpt-5.5" },
  ],
  fallback: "sonnet",
};

/** Scripted host per model id: each complete() call shifts the next reply;
 * a function reply may throw to simulate a dead lane. */
function makeHosts(scripts: Record<string, (string | (() => string))[]>) {
  const prompts: Record<string, string[]> = {};
  const makeHost = (m: ChatModelInfo): Host => ({
    complete: async ({ messages }) => {
      (prompts[m.id] ??= []).push(messages[0]?.content ?? "");
      const next = scripts[m.id]?.shift();
      if (next === undefined) return '{"final":"(script exhausted)"}';
      return typeof next === "function" ? next() : next;
    },
    searchNotes: async () => [],
    readNote: async () => "",
    readFile: async () => "",
    webSearch: async () => [],
    webFetch: async () => "",
    generateImage: async () => "storage/chats/x/img.png",
    knowledgeMap: async () => "(index)",
  });
  return { makeHost, prompts };
}

const INPUT: RunInput = {
  history: [],
  userText: "help me",
  web: false,
  model: { id: "preset:p1", api: "preset" },
};

async function collect(gen: AsyncGenerator<AgentEvent, void, void>) {
  const events: AgentEvent[] = [];
  let final = "";
  for await (const ev of gen) {
    events.push(ev);
    if (ev.type === "final") final = ev.text;
  }
  const statuses = events.filter((e) => e.type === "status").map((e) => e.text);
  return { events, final, statuses };
}

describe("presetFor", () => {
  test("resolves only preset: ids that exist", () => {
    expect(presetFor("preset:p1", [PRESET])).toBe(PRESET);
    expect(presetFor("preset:nope", [PRESET])).toBeNull();
    expect(presetFor("gemma-3", [PRESET])).toBeNull();
  });
});

describe("parseRouteChoice", () => {
  test("accepts a valid choice, with or without refinedPrompt", () => {
    expect(parseRouteChoice('{"route":2}', 2)).toEqual({ route: 2 });
    expect(parseRouteChoice('{"route":1,"refinedPrompt":"cleaner"}', 2)).toEqual({
      route: 1,
      refinedPrompt: "cleaner",
    });
  });
  test("rejects out-of-range, non-numeric, and garbage", () => {
    expect(parseRouteChoice('{"route":3}', 2)).toBeNull();
    expect(parseRouteChoice('{"route":0}', 2)).toBeNull();
    expect(parseRouteChoice('{"route":"two"}', 2)).toBeNull();
    expect(parseRouteChoice("no json here", 2)).toBeNull();
  });
});

describe("runHybrid", () => {
  test("organizer routes to route 2 and the refined prompt reaches the executor", async () => {
    const { makeHost, prompts } = makeHosts({
      "gemma-3": ['{"route":2,"refinedPrompt":"solve X precisely"}'],
      "gpt-5.5": ['{"final":"solved"}'],
    });
    const { final, statuses } = await collect(runHybrid(PRESET, MODELS, INPUT, makeHost));
    expect(final).toBe("solved");
    expect(statuses[0]).toBe("routing via gemma-3 · MLX…");
    expect(statuses).toContain("→ GPT-5.5");
    expect(prompts["sonnet"]).toBeUndefined(); // route 1 never ran
    expect(prompts["gpt-5.5"]?.[0]).toContain("solve X precisely");
    expect(prompts["gpt-5.5"]?.[0]).not.toContain("help me");
  });

  test("garbage routing degrades to route 1 — the turn never fails on routing", async () => {
    const { makeHost } = makeHosts({
      "gemma-3": ["I think route two would be nice"],
      sonnet: ['{"final":"answered by route 1"}'],
    });
    const { final } = await collect(runHybrid(PRESET, MODELS, INPUT, makeHost));
    expect(final).toBe("answered by route 1");
  });

  test("a dead organizer also degrades to route 1", async () => {
    const { makeHost } = makeHosts({
      "gemma-3": [
        () => {
          throw new Error("mlx down");
        },
      ],
      sonnet: ['{"final":"still answered"}'],
    });
    const { final } = await collect(runHybrid(PRESET, MODELS, INPUT, makeHost));
    expect(final).toBe("still answered");
  });

  test("a failed executor falls back ONCE to the fallback model", async () => {
    const boom = () => {
      throw new Error("quota exhausted");
    };
    const { makeHost } = makeHosts({
      "gemma-3": ['{"route":2}'],
      "gpt-5.5": [boom],
      sonnet: ['{"final":"fallback carried it"}'],
    });
    const { final, statuses } = await collect(runHybrid(PRESET, MODELS, INPUT, makeHost));
    expect(final).toBe("fallback carried it");
    expect(statuses).toContain("falling back to Claude Sonnet…");
  });

  test("a failing fallback surfaces the error as the final", async () => {
    const boom = () => {
      throw new Error("everything down");
    };
    const { makeHost } = makeHosts({
      "gemma-3": ['{"route":2}'],
      "gpt-5.5": [boom],
      sonnet: [boom],
    });
    const { final } = await collect(runHybrid(PRESET, MODELS, INPUT, makeHost));
    expect(final.startsWith("⚠")).toBe(true);
  });

  test("no resolvable route models → a clear final, no crash", async () => {
    const { makeHost } = makeHosts({});
    const lonely: HybridPreset = { ...PRESET, routes: [{ when: "x", model: "not-enabled" }] };
    const { final } = await collect(runHybrid(lonely, MODELS, INPUT, makeHost));
    expect(final).toContain("route models aren't available");
  });
});

describe("suggestPresets / parseSuggestions", () => {
  const allowed = new Set(MODELS.map((m) => m.id));

  test("parses a clean array, drops unknown models, caps at 3", () => {
    const raw = JSON.stringify([
      { name: "A", organizer: "gemma-3", routes: [{ when: "w", model: "sonnet" }] },
      { name: "B", organizer: "gemma-3", routes: [{ when: "w", model: "gpt-5.5" }], fallback: "sonnet" },
      { name: "bad-org", organizer: "gpt-9", routes: [{ when: "w", model: "sonnet" }] },
      { name: "bad-routes", organizer: "gemma-3", routes: [{ when: "w", model: "gpt-9" }] },
      { name: "D", organizer: "gemma-3", routes: [{ when: "w", model: "sonnet" }] },
    ]);
    const out = parseSuggestions(raw, allowed);
    expect(out.map((p) => p.name)).toEqual(["A", "B", "D"]);
    expect(out[1]?.fallback).toBe("sonnet");
    expect(out.every((p) => p.id.length > 0)).toBe(true);
  });

  test("prose around the array is tolerated; garbage returns []", () => {
    const wrapped = `Here you go:\n[{"name":"A","organizer":"gemma-3","routes":[{"when":"w","model":"sonnet"}]}]\nEnjoy!`;
    expect(parseSuggestions(wrapped, allowed)).toHaveLength(1);
    expect(parseSuggestions("total garbage", allowed)).toEqual([]);
    expect(parseSuggestions("[not json]", allowed)).toEqual([]);
  });

  test("suggestPresets feeds the allowed ids and parses the reply", async () => {
    const { makeHost, prompts } = makeHosts({
      "gemma-3": ['[{"name":"Everyday","organizer":"gemma-3","routes":[{"when":"quick","model":"sonnet"}]}]'],
    });
    const out = await suggestPresets(makeHost(gemma), MODELS, "mostly note-taking + research");
    expect(out).toHaveLength(1);
    expect(out[0]?.name).toBe("Everyday");
    expect(prompts["gemma-3"]?.[0]).toContain('"gpt-5.5"');
    expect(prompts["gemma-3"]?.[0]).toContain("mostly note-taking + research");
  });
});
