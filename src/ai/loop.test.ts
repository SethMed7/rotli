// The agentic client, proven without a model or the network: a scripted fake Host
// returns canned model replies, so the loop's branching (tool dispatch, JSON
// tolerance, the web gate, the egress guard, force-final) is deterministic.

import { describe, expect, test } from "bun:test";
import type { CorpusNoteMeta } from "../lib/tauri";
import { budgetFor, contextWindowFor } from "./budget";
import { looksSecret } from "./guard";
import { runAgent } from "./loop";
import { extractJsonObject, parseAction } from "./parse";
import { buildIndex, pruneScratch, rankNotes } from "./tools";
import type { AgentEvent, Host, RunInput, ToolName } from "./types";

// ── fixtures ──────────────────────────────────────────────────────────────────

function note(p: Partial<CorpusNoteMeta> & { id: string; title: string }): CorpusNoteMeta {
  return { snippet: "", folderId: "", createdAt: 0, updatedAt: 0, pinned: false, ...p };
}

interface Calls {
  searchNotes: string[];
  readNote: string[];
  webSearch: string[];
  webFetch: string[];
}

function fakeHost(replies: string[], over: Partial<Host> = {}): { host: Host; calls: Calls } {
  let i = 0;
  const calls: Calls = { searchNotes: [], readNote: [], webSearch: [], webFetch: [] };
  const host: Host = {
    complete: async () => replies[i++] ?? '{"final":"(script exhausted)"}',
    searchNotes: async (q) => {
      calls.searchNotes.push(q);
      return [{ id: "n1", title: "Pricing", snippet: "Myela pricing", folder: "Projects" }];
    },
    readNote: async (id) => {
      calls.readNote.push(id);
      return `# Pricing\nMyela pricing is $99/mo (note ${id}).`;
    },
    webSearch: async (q) => {
      calls.webSearch.push(q);
      return [{ title: "Result", url: "https://example.com", snippet: "a web snippet" }];
    },
    webFetch: async (url) => {
      calls.webFetch.push(url);
      return "fetched web page text";
    },
    knowledgeMap: async () => "## Projects\n- Pricing  {id: n1}",
    ...over,
  };
  return { host, calls };
}

async function run(
  host: Host,
  input: Omit<RunInput, "model">,
): Promise<{ final: string; events: AgentEvent[] }> {
  const events: AgentEvent[] = [];
  let final = "";
  for await (const ev of runAgent(host, { ...input, model: { id: "gemma-3-12b-it-qat-4bit" } })) {
    events.push(ev);
    if (ev.type === "final") final = ev.text;
  }
  return { final, events };
}

const ALL: ReadonlySet<ToolName> = new Set<ToolName>([
  "search_notes",
  "read_note",
  "web_search",
  "web_fetch",
]);

// ── parser ────────────────────────────────────────────────────────────────────

describe("parse", () => {
  test("extracts a balanced object from prose + fences", () => {
    expect(extractJsonObject('```json\n{"final":"hi"}\n```')).toBe('{"final":"hi"}');
    expect(extractJsonObject('sure: {"tool":"x","args":{"a":1}} ok')).toBe(
      '{"tool":"x","args":{"a":1}}',
    );
    expect(extractJsonObject("no json here")).toBeNull();
    // braces inside strings don't confuse the scanner
    expect(extractJsonObject('{"final":"a } b"}')).toBe('{"final":"a } b"}');
  });

  test("classifies tool / final / invalid / unparseable", () => {
    expect(parseAction('{"final":"done"}', ALL)).toEqual({ kind: "final", text: "done" });
    expect(parseAction('{"tool":"read_note","args":{"id":"n1"}}', ALL)).toEqual({
      kind: "call",
      tool: "read_note",
      args: { id: "n1" },
    });
    expect(parseAction('{"tool":"rm_rf","args":{}}', ALL).kind).toBe("invalid");
    expect(parseAction("hello", ALL).kind).toBe("unparseable");
  });

  test("a tool not in the allowed set is invalid (web off)", () => {
    const notesOnly = new Set<ToolName>(["search_notes", "read_note"]);
    expect(parseAction('{"tool":"web_search","args":{"query":"x"}}', notesOnly).kind).toBe("invalid");
  });
});

// ── retrieval ─────────────────────────────────────────────────────────────────

describe("retrieval", () => {
  test("rankNotes scores title > folder > snippet and skips boards/files", () => {
    const notes = [
      note({ id: "a", title: "Myela Pricing", folderId: "Projects", snippet: "tiers" }),
      note({ id: "b", title: "Groceries", folderId: "Home", snippet: "milk" }),
      note({ id: "c", title: "board", folderId: "Projects", snippet: "pricing", kind: "board" }),
    ];
    const hits = rankNotes(notes, "pricing", 5);
    expect(hits.map((h) => h.id)).toEqual(["a"]);
  });

  test("buildIndex groups by folder/area with ids when it fits", () => {
    const idx = buildIndex([
      note({ id: "a", title: "Pricing", folderId: "Projects" }),
      note({ id: "b", title: "Ada", folderId: "People" }),
    ]);
    expect(idx).toContain("## People");
    expect(idx).toContain("## Projects");
    expect(idx).toContain("{id: a}");
  });

  test("buildIndex degrades to an areas map when the full list overflows the budget", () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      note({ id: `01IDENTIFIER${i}`, title: `Note number ${i} with a long title`, folderId: "Projects", updatedAt: i }),
    );
    const idx = buildIndex(many, 300); // tiny budget → must collapse
    expect(idx).toContain("## Projects (50)"); // area + count
    expect(idx).not.toContain("{id:"); // no per-note ids in the areas map
    expect(idx.length).toBeLessThan(600);
  });
});

describe("budget", () => {
  test("sizes the prompt to the model's context window", () => {
    const big = budgetFor({ id: "gemma-3-12b-it-qat-4bit" });
    const small = budgetFor({ id: "qwen2.5-1.5b-instruct-4bit" });
    expect(big.maxIndexChars).toBeGreaterThan(small.maxIndexChars);
    expect(big.readNoteChars).toBeGreaterThan(small.readNoteChars);
    expect(contextWindowFor({ id: "gemma-3-12b" })).toBeGreaterThan(contextWindowFor({ id: "mystery" }));
    expect(contextWindowFor({ id: "x", contextWindow: 4096 })).toBe(4096); // explicit override wins
  });

  test("pruneScratch keeps the scratchpad within budget", () => {
    const scratch = [
      { action: "a1", result: "X".repeat(2000) },
      { action: "a2", result: "Y".repeat(2000) },
    ];
    const pruned = pruneScratch(scratch, 1500);
    const total = pruned.reduce((s, e) => s + e.result.length, 0);
    expect(total).toBeLessThan(1700); // within budget (+ trim markers)
    // under budget → returned unchanged
    expect(pruneScratch([{ action: "a", result: "short" }], 1000)).toHaveLength(1);
  });
});

// ── guard ─────────────────────────────────────────────────────────────────────

describe("guard", () => {
  test("flags secrets, ignores ordinary text", () => {
    expect(looksSecret("my key sk-ant-api03-EXAMPLE0EXAMPLE0EXAM")).toBe(true);
    expect(looksSecret("SSN 078-05-1120")).toBe(true);
    expect(looksSecret("just a normal question about pricing")).toBe(false);
  });
});

// ── the loop ──────────────────────────────────────────────────────────────────

describe("runAgent", () => {
  test("answers from notes: search → read → final", async () => {
    const { host, calls } = fakeHost([
      '{"tool":"search_notes","args":{"query":"pricing"}}',
      '{"tool":"read_note","args":{"id":"n1"}}',
      '{"final":"Your Myela pricing is $99/mo."}',
    ]);
    const { final, events } = await run(host, { history: [], userText: "what's my pricing?", web: false });
    expect(final).toContain("$99");
    expect(calls.searchNotes).toEqual(["pricing"]);
    expect(calls.readNote).toEqual(["n1"]);
    const tools = events.filter((e) => e.type === "tool").map((e) => (e as { tool: string }).tool);
    expect(tools).toEqual(["search_notes", "read_note"]);
  });

  test("web tools are not callable when the globe is off", async () => {
    const { host, calls } = fakeHost([
      '{"tool":"web_search","args":{"query":"weather"}}', // invalid (web off) → observation
      '{"final":"answered from notes"}',
    ]);
    const { final } = await run(host, { history: [], userText: "hi", web: false });
    expect(final).toBe("answered from notes");
    expect(calls.webSearch).toEqual([]); // never reached the host
  });

  test("the egress guard blocks a secret web query", async () => {
    const { host, calls } = fakeHost([
      '{"tool":"web_search","args":{"query":"look up sk-ant-api03-EXAMPLE0EXAMPLE0EXAM"}}',
      '{"final":"won\'t leak that"}',
    ]);
    const { final } = await run(host, { history: [], userText: "search my key", web: true });
    expect(final).toContain("won't leak");
    expect(calls.webSearch).toEqual([]); // guard fired before the host
  });

  test("uses the web when the globe is on", async () => {
    const { host, calls } = fakeHost([
      '{"tool":"web_search","args":{"query":"rust 2024 release"}}',
      '{"final":"Rust shipped."}',
    ]);
    await run(host, { history: [], userText: "latest rust?", web: true });
    expect(calls.webSearch).toEqual(["rust 2024 release"]);
  });

  test("forces a final answer when the step budget runs out", async () => {
    const { host } = fakeHost([
      '{"tool":"search_notes","args":{"query":"x"}}', // consumes the only step
      "Here is my best final answer.", // the forced-final prose reply
    ]);
    const { final } = await run(host, { history: [], userText: "q", web: false, maxSteps: 1 });
    expect(final).toBe("Here is my best final answer.");
  });

  test("recovers via force-final after two unparseable replies", async () => {
    const { host } = fakeHost(["not json at all", "still not json", '{"final":"recovered"}']);
    const { final } = await run(host, { history: [], userText: "q", web: false });
    expect(final).toBe("recovered");
  });
});
