// The model-catalog merge + the frontier/local split. The split is load-bearing
// twice over: budget tiers (a local id must never inherit the frontier budget)
// and adapter choice (the local flow must stay byte-identical to before the
// connected lanes existed).

import { describe, expect, test } from "bun:test";

import type { DiscoveredModel } from "../lib/cliModelTypes";
import type { ChatModelInfo } from "../lib/tauri";
import type { DiscoveryLanes } from "../state/connectedModels";
import { parseHybridPresets } from "../state/persist";
import { budgetFor, contextWindowFor } from "./budget";
import {
  CLI_CATALOG,
  DEFAULT_PROVIDER_MODELS,
  type HybridPreset,
  LOCAL_CATALOG,
  PROVIDER_IDS,
  type ProviderId,
  STARTER_PRESETS,
  comfortFor,
  findModel,
  fitLabel,
  flattenModels,
  installableCatalog,
  isModelIdShape,
  isValidRepo,
  mergedModels,
  modelLabel,
  modelProvider,
  nameFromRepo,
  presetModel,
  providerCatalog,
  providerDefaultModel,
  resolveLaneModel,
} from "./models";
import { adapterFor, frontierAdapter, gemmaAdapter } from "./prompt";

const local: ChatModelInfo[] = [
  {
    id: "gemma-3-12b-it-qat-4bit",
    label: "gemma-3 · MLX",
    provider: "mlx",
    endpoint: "http://localhost:11435",
    api: "generate",
    vision: true,
    isDefault: true,
  },
];

const noneEnabled = { claude: false, codex: false, cursor: false, antigravity: false };

describe("mergedModels", () => {
  test("disabled lanes contribute nothing; the local list passes through", () => {
    const g = mergedModels(local, noneEnabled, []);
    expect(g.local).toEqual(local);
    expect(g.connected).toEqual([]);
    expect(g.presets).toEqual([]);
  });

  test("only enabled and ready official connected clients can surface models", () => {
    const g = mergedModels(local, { claude: true, codex: true, cursor: true, antigravity: true }, [], [], {
      claude: true,
      codex: true,
      cursor: true,
      antigravity: true,
    });
    expect(PROVIDER_IDS).toEqual(["claude", "codex", "cursor", "antigravity"]);
    expect(g.connected).toEqual([
      ...CLI_CATALOG.claude,
      ...CLI_CATALOG.codex,
      ...CLI_CATALOG.cursor,
      ...CLI_CATALOG.antigravity,
    ]);
    expect(g.connected.every((model) => PROVIDER_IDS.includes(model.provider as ProviderId))).toBe(true);
  });

  test("presets become pseudo-models the transports can never receive", () => {
    const p: HybridPreset = {
      id: "p1",
      name: "My hybrid",
      organizer: "gemma-3-12b-it-qat-4bit",
      routes: [{ when: "anything", model: "sonnet" }],
    };
    const m = presetModel(p);
    expect(m.id).toBe("preset:p1");
    expect(m.api).toBe("preset");
    expect(m.endpoint).toBe("");
    expect(mergedModels(local, noneEnabled, [p]).presets).toEqual([m]);
  });

  test("flattenModels keeps local first so stale picks fall back on-device", () => {
    const g = mergedModels(local, { ...noneEnabled, codex: true }, []);
    const flat = flattenModels(g);
    expect(flat[0]?.id).toBe("gemma-3-12b-it-qat-4bit");
    expect(flat.some((m) => m.id === "gpt-5.5")).toBe(true);
  });

  test("EVERY installed local model is offered — server 0.3 swaps per request", () => {
    const two: ChatModelInfo[] = [
      { ...local[0]!, id: "gemma-3", localDefault: true },
      { ...local[0]!, id: "qwen2.5-7b", localDefault: false },
    ];
    const g = mergedModels(two, noneEnabled, []);
    expect(g.local.map((m) => m.id)).toEqual(["gemma-3", "qwen2.5-7b"]);
  });
});

describe("local model catalog", () => {
  test("nameFromRepo derives a safe lowercase install name from a repo id", () => {
    expect(nameFromRepo("mlx-community/Qwen2.5-7B-Instruct-4bit")).toBe("qwen2.5-7b-instruct-4bit");
    expect(nameFromRepo("owner/Weird Name!!")).toBe("weird-name");
  });

  test("nameFromRepo output always satisfies the Rust valid_name law", () => {
    for (const repo of ["a/B_C", "x/..dots..", "Org/Model@v2"]) {
      const n = nameFromRepo(repo);
      expect(n).toMatch(/^[a-z0-9.-]+$/);
      expect(n.startsWith("-")).toBe(false);
    }
  });

  test("isValidRepo accepts owner/name, rejects the rest", () => {
    expect(isValidRepo("mlx-community/Qwen2.5-7B")).toBe(true);
    expect(isValidRepo("no-slash")).toBe(false);
    expect(isValidRepo("a/b/c")).toBe(false);
    expect(isValidRepo("../etc")).toBe(false);
    expect(isValidRepo("owner/..")).toBe(false);
  });

  test("every catalog entry has a valid repo + a matching derived name", () => {
    for (const e of LOCAL_CATALOG) {
      expect(isValidRepo(e.repo)).toBe(true);
      expect(e.name).toMatch(/^[a-z0-9.-]+$/);
      expect(e.approxMb).toBeGreaterThan(0);
    }
  });

  test("installableCatalog hides what's already installed", () => {
    const installed = new Set(["qwen2.5-3b-instruct-4bit"]);
    const out = installableCatalog(installed);
    expect(out.some((e) => e.name === "qwen2.5-3b-instruct-4bit")).toBe(false);
    expect(out.length).toBe(LOCAL_CATALOG.length - 1);
  });
});

describe("blocked models (per-lane model control)", () => {
  test("blocking Codex models hides only those models", () => {
    const g = mergedModels(local, { ...noneEnabled, codex: true }, [], ["gpt-5.5"]);
    expect(g.connected.some((model) => model.id === "gpt-5.5")).toBe(false);
    expect(g.connected.some((model) => model.id === "gpt-5.6-sol")).toBe(true);
  });

  test("blocking never touches local models or presets", () => {
    const p: HybridPreset = { id: "p", name: "P", organizer: "x", routes: [{ when: "", model: "sonnet" }] };
    const g = mergedModels(local, noneEnabled, [p], ["gemma-3-12b-it-qat-4bit", "preset:p"]);
    expect(g.local).toHaveLength(1);
    expect(g.presets).toHaveLength(1);
  });
});

describe("connected catalog policy", () => {
  test("only Claude, Codex, Cursor, and Antigravity have executable catalogs", () => {
    expect(PROVIDER_IDS).toEqual(["claude", "codex", "cursor", "antigravity"]);
    // Antigravity is last on purpose: off by default, newest, account caveat
    expect(PROVIDER_IDS.at(-1)).toBe("antigravity");
    expect(CLI_CATALOG.antigravity.map((model) => model.id)).toEqual([
      "gemini-3.8-flash-high",
      "gemini-3.8-flash-medium",
      "gemini-3.8-flash-low",
      "gemini-3.7-flash-high",
      "gemini-3.7-flash-medium",
      "gemini-3.7-flash-low",
    ]);
    expect(CLI_CATALOG.antigravity.every((model) => model.vision === true && model.api === "cli")).toBe(true);
    expect(CLI_CATALOG.claude.length).toBeGreaterThan(0);
    expect(CLI_CATALOG.codex.length).toBeGreaterThan(0);
    expect(CLI_CATALOG.cursor).toContainEqual(
      expect.objectContaining({ id: "grok-4.6", provider: "cursor", vision: false }),
    );
  });

  test("reviewed provider defaults are current and stale persisted ids heal", () => {
    expect(DEFAULT_PROVIDER_MODELS).toEqual({
      claude: "default",
      codex: "gpt-6-sol",
      cursor: "grok-4.6",
      antigravity: "gemini-3.8-flash-high",
    });
    // every built-in default is in its own built-in list, marked as the default
    for (const id of PROVIDER_IDS) {
      expect(CLI_CATALOG[id].filter((m) => m.isDefault).map((m) => m.id)).toEqual([
        DEFAULT_PROVIDER_MODELS[id],
      ]);
    }
    expect(providerDefaultModel("antigravity", { antigravity: "gemini-3.7-flash-low" })).toBe(
      "gemini-3.7-flash-low",
    );
    // the client could not list (older helper, signed out): the built-in list decides
    const failed = {
      antigravity: { status: "error" as const, models: [], at: 0 },
      cursor: { status: "error" as const, models: [], at: 0 },
    };
    expect(providerDefaultModel("antigravity", { antigravity: "gemini-2.5-pro" }, failed)).toBe(
      "gemini-3.8-flash-high",
    );
    expect(providerDefaultModel("cursor", { cursor: "cursor-auto" }, failed)).toBe("cursor-auto");
    expect(providerDefaultModel("cursor", { cursor: "removed-model" }, failed)).toBe("grok-4.6");
    expect(providerDefaultModel("cursor", { cursor: "--help" }, {})).toBe("grok-4.6");
  });
});

const reported = (id: string, label: string, extra: Partial<DiscoveredModel> = {}): DiscoveredModel => ({
  id,
  label,
  efforts: [],
  fastTier: false,
  vision: true,
  isDefault: false,
  ...extra,
});

/** What Claude Code, Codex, and Cursor listed on 2026-09-23 (trimmed). */
const answered: DiscoveryLanes = {
  claude: {
    status: "ready",
    at: 0,
    models: [
      reported("default", "Claude Default · Opus 5.5 (1M context)", {
        isDefault: true,
        efforts: ["low", "max"],
      }),
      reported("opus[1m]", "Claude Opus 5.5 (1M context)", { efforts: ["low", "max"] }),
      reported("claude-fable-5-1[1m]", "Claude Fable 5.1", { efforts: ["low", "max"] }),
      reported("sonnet", "Claude Sonnet 5", { efforts: ["low", "max"] }),
      reported("haiku", "Claude Haiku 4.5"),
    ],
  },
  codex: {
    status: "ready",
    at: 0,
    models: [
      reported("gpt-6-astra", "GPT-6 Astra", { efforts: ["low", "ultra"], fastTier: true }),
      reported("gpt-5.5", "GPT-5.5", { efforts: ["low", "xhigh"], fastTier: true }),
    ],
  },
  cursor: {
    status: "ready",
    at: 0,
    models: [
      reported("cursor-auto", "Auto (default)", { isDefault: true, vision: false }),
      reported("cursor-grok-4.6-high", "Grok 4.6", { vision: false }),
      reported("composer-2.5", "Composer 2.5", { vision: false }),
    ],
  },
};
const allOn = { claude: true, codex: true, cursor: true, antigravity: true };

describe("discovered models (each client's own list)", () => {
  test("the picker lists exactly what each client reported, one default per lane", () => {
    const g = mergedModels([], allOn, [], [], allOn, answered);
    const ids = (p: string) => g.connected.filter((m) => m.provider === p).map((m) => m.id);
    expect(ids("claude")).toEqual(["default", "opus[1m]", "claude-fable-5-1[1m]", "sonnet", "haiku"]);
    expect(ids("codex")).toEqual(["gpt-6-astra", "gpt-5.5"]);
    expect(ids("cursor")).toEqual(["cursor-auto", "cursor-grok-4.6-high", "composer-2.5"]);
    // antigravity has not answered: the built-in list stands in
    expect(ids("antigravity")).toEqual(CLI_CATALOG.antigravity.map((m) => m.id));
    for (const p of PROVIDER_IDS) {
      expect(g.connected.filter((m) => m.provider === p && m.isDefault)).toHaveLength(1);
    }
    expect(g.connected.every((m) => m.endpoint === "" && m.api === "cli")).toBe(true);
    // Codex flagged no default: the reviewed default when listed, else the first
    expect(providerCatalog("codex", answered).find((m) => m.isDefault)?.id).toBe("gpt-6-astra");
  });

  test("labels and lanes resolve for discovered ids and for the ids older lists saved", () => {
    expect(modelLabel("composer-2.5", [], [], answered)).toBe("Composer 2.5");
    expect(modelProvider("composer-2.5", [], [], answered)).toBe("cursor");
    expect(modelLabel("opus", [], [], answered)).toBe("Claude Opus 5.5 (1M context)");
    const list = providerCatalog("cursor", answered);
    expect(findModel(list, "grok-4.6")?.id).toBe("cursor-grok-4.6-high"); // retired id, same label
    expect(findModel(providerCatalog("claude", answered), "fable")?.id).toBe("claude-fable-5-1[1m]");
    expect(findModel(list, "gone")).toBeUndefined();
  });

  test("a saved default is kept while its lane loads and heals only after the client answers", () => {
    const loading = { codex: { status: "loading" as const, models: [], at: 0 } };
    expect(providerDefaultModel("codex", { codex: "gpt-7-nova" }, loading)).toBe("gpt-7-nova");
    expect(providerDefaultModel("codex", { codex: "gpt-6-astra" }, answered)).toBe("gpt-6-astra");
    expect(providerDefaultModel("codex", { codex: "gpt-7-nova" }, answered)).toBe("gpt-6-astra");
    expect(providerDefaultModel("claude", {}, answered)).toBe("default");
    expect(providerDefaultModel("cursor", { cursor: "grok-4.6" }, answered)).toBe("cursor-grok-4.6-high");
    expect(resolveLaneModel("claude", "gpt-6-astra", {})).toBeNull(); // never crosses lanes
    expect(resolveLaneModel("codex", "opus", {})).toBeNull();
  });

  test("the id shape mirrors the Rust argv gate", () => {
    for (const ok of ["sonnet", "opus[1m]", "claude-fable-5-1[1m]", "gpt-5.6-sol", "cursor_auto"]) {
      expect(isModelIdShape(ok)).toBe(true);
    }
    for (const bad of ["", "--help", "-m", "a b", "opus[2m]", 'x"y', "a".repeat(97)]) {
      expect(isModelIdShape(bad)).toBe(false);
    }
  });
});

describe("comfort tiers (Scan my Mac)", () => {
  test("a 64GB M4 Max: 32B-4bit is comfortable, everything smaller too", () => {
    expect(fitLabel(18500, 64)).toBe("great fit"); // Qwen 32B
    expect(fitLabel(7500, 64)).toBe("great fit"); // gemma 12B
  });
  test("16GB: 7B is comfortable, 12B workable, 32B too big", () => {
    expect(fitLabel(4300, 16)).toBe("great fit");
    expect(fitLabel(7500, 16)).toBe("workable");
    expect(fitLabel(18500, 16)).toBe("too big");
  });
  test("8GB: 3B fits, 7B workable, 12B too big", () => {
    expect(fitLabel(1800, 8)).toBe("great fit");
    expect(fitLabel(4300, 8)).toBe("workable");
    expect(fitLabel(7500, 8)).toBe("too big");
  });
  test("tiers are monotonic in RAM", () => {
    expect(comfortFor(64).comfortableMb).toBeGreaterThan(comfortFor(16).comfortableMb);
  });
});

describe("starter presets", () => {
  test("every starter preset survives the persistence shape-validator byte-for-byte", () => {
    expect(parseHybridPresets(STARTER_PRESETS)).toEqual(STARTER_PRESETS);
  });
  test("starter ids are stable + prefixed (re-adding never duplicates)", () => {
    for (const p of STARTER_PRESETS) expect(p.id.startsWith("starter-")).toBe(true);
    expect(new Set(STARTER_PRESETS.map((p) => p.id)).size).toBe(STARTER_PRESETS.length);
  });
  test("starter presets reference only on-device ids or official connected models", () => {
    const connected = new Set(
      [...CLI_CATALOG.claude, ...CLI_CATALOG.codex, ...CLI_CATALOG.cursor].map((model) => model.id),
    );
    for (const preset of STARTER_PRESETS) {
      expect(preset.organizer.startsWith("gemma") || preset.organizer.startsWith("qwen")).toBe(true);
      for (const route of preset.routes) {
        expect(
          route.model.startsWith("gemma") || route.model.startsWith("qwen") || connected.has(route.model),
        ).toBe(true);
      }
    }
  });
});

describe("the frontier/local split (budget + adapter)", () => {
  test("connected ids land in the 200k frontier tier", () => {
    expect(contextWindowFor({ id: "sonnet", api: "cli" })).toBe(200_000);
    expect(contextWindowFor({ id: "gpt-5.4-mini", api: "cli" })).toBe(200_000);
    expect(contextWindowFor({ id: "Claude Opus 4.6 (Thinking)", api: "cli" })).toBe(200_000);
    expect(contextWindowFor({ id: "gemini-3-flash", api: "openai" })).toBe(200_000);
    expect(budgetFor({ id: "sonnet", api: "cli" }).maxSteps).toBe(8);
  });

  test("local ids KEEP their tiers — no drift into the frontier budget", () => {
    expect(contextWindowFor({ id: "gemma-3-12b-it-qat-4bit" })).toBe(128_000);
    expect(budgetFor({ id: "gemma-3-12b-it-qat-4bit" }).maxSteps).toBe(5);
    expect(contextWindowFor({ id: "qwen2.5-1.5b-instruct-4bit" })).toBe(32_000);
  });

  test("adapterFor: gemma scaffold for local, frontier scaffold for connected", () => {
    expect(adapterFor({ id: "gemma-3-12b-it-qat-4bit" })).toBe(gemmaAdapter);
    expect(adapterFor({ id: "unknown-model" })).toBe(gemmaAdapter);
    expect(adapterFor({ id: "sonnet", api: "cli" })).toBe(frontierAdapter);
    expect(adapterFor({ id: "gemini-3-pro", api: "openai" })).toBe(frontierAdapter);
  });

  test("the frontier scaffold keeps the one-JSON protocol and never asks for coercion", () => {
    expect(frontierAdapter.wantsFormatJson).toBe(false);
    const prompt = frontierAdapter.renderPrompt({
      web: false,
      knowledge: "AREAS: projects",
      history: [],
      userText: "what's in my notes?",
      scratch: [],
      maxSteps: 8,
    });
    expect(prompt).toContain('{"thought":"…","tool":"search_notes"');
    expect(prompt).toContain("EXACTLY ONE JSON object");
    expect(prompt).toContain("The web is OFF");
    expect(prompt).not.toContain("web_search"); // web off ⇒ the tools aren't offered
  });
});

describe("connected-lane vision", () => {
  test("the vision lanes are Claude, Codex, and Antigravity (ACP image blocks, 2026-09-17); Cursor is not", () => {
    const groups = mergedModels([], { claude: true, codex: true, cursor: true, antigravity: true }, [], [], {
      claude: true,
      codex: true,
      antigravity: true,
      cursor: true,
    });
    const visionIds = flattenModels(groups)
      .filter((m) => m.vision)
      .map((m) => m.id);
    expect(visionIds).toEqual(
      [...CLI_CATALOG.claude, ...CLI_CATALOG.codex, ...CLI_CATALOG.antigravity].map((model) => model.id),
    );
  });
});
