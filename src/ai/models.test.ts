// The model-catalog merge + the frontier/local split. The split is load-bearing
// twice over: budget tiers (a local id must never inherit the frontier budget)
// and adapter choice (the local flow must stay byte-identical to before the
// connected lanes existed).

import { describe, expect, test } from "bun:test";
import { budgetFor, contextWindowFor } from "./budget";
import {
  CLI_CATALOG,
  GEMINI_OPENAI_BASE,
  type HybridPreset,
  LOCAL_CATALOG,
  flattenModels,
  installableCatalog,
  isValidRepo,
  mergedModels,
  nameFromRepo,
  presetModel,
} from "./models";
import { adapterFor, frontierAdapter, gemmaAdapter } from "./prompt";
import type { ChatModelInfo } from "../lib/tauri";

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

const noneEnabled = { claude: false, codex: false, agy: false, gemini: false };

describe("mergedModels", () => {
  test("disabled lanes contribute nothing; the local list passes through", () => {
    const g = mergedModels(local, noneEnabled, []);
    expect(g.local).toEqual(local);
    expect(g.connected).toEqual([]);
    expect(g.presets).toEqual([]);
  });

  test("an enabled lane surfaces its catalog", () => {
    const g = mergedModels(local, { ...noneEnabled, claude: true }, []);
    expect(g.connected).toEqual(CLI_CATALOG.claude);
    expect(g.connected.every((m) => m.api === "cli" && m.endpoint === "")).toBe(true);
  });

  test("gemini rides the openai wire with its remote base (never local)", () => {
    const g = mergedModels(local, { ...noneEnabled, gemini: true }, []);
    expect(g.connected.every((m) => m.api === "openai" && m.endpoint === GEMINI_OPENAI_BASE)).toBe(
      true,
    );
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
