// The agentic client, proven without a model or the network: a scripted fake Host
// returns canned model replies, so the loop's branching (tool dispatch, JSON
// tolerance, the web gate, the egress guard, force-final) is deterministic.

import { describe, expect, test } from "bun:test";
import type { CorpusNoteMeta } from "../lib/tauri";
import { budgetFor, contextWindowFor } from "./budget";
import { containsPrivateDataOverlap, endpointIsLocal, looksSecret, modelIsOnDevice } from "./guard";
import { runAgent } from "./loop";
import { extractJsonObject, parseAction } from "./parse";
import { trimHistory } from "./prompt";
import { buildIndex, pruneScratch, rankNotes } from "./tools";
import type { AgentEvent, ChatTurn, Host, RunInput, ToolName } from "./types";

// ── fixtures ──────────────────────────────────────────────────────────────────

function note(p: Partial<CorpusNoteMeta> & { id: string; title: string }): CorpusNoteMeta {
  return { snippet: "", folderId: "", createdAt: 0, updatedAt: 0, pinned: false, ...p };
}

interface Calls {
  searchMemory: string[];
  readMemory: string[];
  searchNotes: string[];
  readNote: string[];
  webSearch: string[];
  webFetch: string[];
  generateImage: string[];
}

function fakeHost(replies: string[], over: Partial<Host> = {}): { host: Host; calls: Calls } {
  let i = 0;
  const calls: Calls = {
    searchMemory: [],
    readMemory: [],
    searchNotes: [],
    readNote: [],
    webSearch: [],
    webFetch: [],
    generateImage: [],
  };
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
    searchMemory: async (q) => {
      calls.searchMemory.push(q);
      return [{ id: "chat:cedar", title: "Cedar launch", snippet: "July decision", source: "chat" }];
    },
    readMemory: async (id) => {
      calls.readMemory.push(id);
      return `# Cedar launch\nThe July decision came from ${id}.`;
    },
    readFile: async (q) => `csv,for,${q}\n1,2,3`,
    webSearch: async (q) => {
      calls.webSearch.push(q);
      return [{ title: "Result", url: "https://example.com", snippet: "a web snippet" }];
    },
    webFetch: async (url) => {
      calls.webFetch.push(url);
      return "fetched web page text";
    },
    generateImage: async (prompt) => {
      calls.generateImage.push(prompt);
      return "storage/chats/test/img-01x.png";
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
  "search_memory",
  "read_memory",
  "web_search",
  "web_fetch",
]);

// ── parser ────────────────────────────────────────────────────────────────────

describe("parse", () => {
  test("extracts a balanced object from prose + fences", () => {
    expect(extractJsonObject('```json\n{"final":"hi"}\n```')).toBe('{"final":"hi"}');
    expect(extractJsonObject('sure: {"tool":"x","args":{"a":1}} ok')).toBe('{"tool":"x","args":{"a":1}}');
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
    const map = JSON.parse(idx) as { areas: { name: string; notes: { id: string }[] }[] };
    expect(map.areas.map((area) => area.name)).toEqual(["People", "Projects"]);
    expect(map.areas[1]?.notes[0]?.id).toBe("a");
  });

  test("buildIndex degrades to an areas map when the full list overflows the budget", () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      note({
        id: `01IDENTIFIER${i}`,
        title: `Note number ${i} with a long title`,
        folderId: "Projects",
        updatedAt: i,
      }),
    );
    const idx = buildIndex(many, 300); // tiny budget → must collapse
    const map = JSON.parse(idx) as {
      truncated: boolean;
      areas: { name: string; count: number; notes: unknown[] }[];
    };
    expect(map).toMatchObject({ truncated: true });
    expect(map.areas[0]).toEqual({ name: "Projects", count: 50, notes: [] });
    expect(idx.length).toBeLessThanOrEqual(300);
  });
});

describe("budget", () => {
  test("sizes the prompt to the model's context window", () => {
    const big = budgetFor({ id: "gemma-3-12b-it-qat-4bit" });
    const small = budgetFor({ id: "qwen2.5-1.5b-instruct-4bit" });
    expect(big.maxIndexChars).toBeGreaterThan(small.maxIndexChars);
    expect(big.readNoteChars).toBeGreaterThan(small.readNoteChars);
    expect(contextWindowFor({ id: "gemma-3-12b" })).toBeGreaterThan(contextWindowFor({ id: "mystery" }));
  });

  test("trimHistory keeps the newest turns within the cap (#65)", () => {
    const history: ChatTurn[] = [
      { role: "user", text: "A".repeat(1000) },
      { role: "assistant", text: "B".repeat(1000) },
      { role: "user", text: "C".repeat(1000) },
    ];
    const trimmed = trimHistory(history, 2100);
    // the two newest turns fit; the oldest is folded into the trim marker
    expect(trimmed.map((t) => t.text[0])).toEqual(["(", "B", "C"]);
    expect(trimmed[0]?.text).toContain("trimmed");
    // the latest turn ALWAYS survives, even oversized
    const tiny = trimHistory(history, 10);
    expect(tiny[tiny.length - 1]?.text[0]).toBe("C");
    // under the cap → untouched, no marker
    expect(trimHistory(history, 50_000)).toEqual(history);
    expect(trimHistory([], 1000)).toEqual([]);
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

  test("unseparated card numbers trip only when Luhn-valid (#23)", () => {
    // mirrors secret.rs — keep the two suites' cases in lockstep by hand
    expect(looksSecret("card 4242424242424242 exp 12/28")).toBe(true);
    expect(looksSecret("amex 371449635398431")).toBe(true); // 15-digit
    expect(looksSecret("card: 4242 4242 4242 4242")).toBe(true); // separated, as before
    expect(looksSecret("order 1234567890123456")).toBe(false); // 16 digits, Luhn-fail
    expect(looksSecret("id a4242424242424242z")).toBe(false); // glued to word chars
    expect(looksSecret("n 42424242424242")).toBe(false); // too short
  });

  test("endpointIsLocal accepts loopback hosts only (#2)", () => {
    // mirrors chat.rs endpoint_is_local — keep the cases in lockstep by hand
    expect(endpointIsLocal("http://localhost:11435")).toBe(true);
    expect(endpointIsLocal("http://127.0.0.1:11436/v1")).toBe(true);
    expect(endpointIsLocal("http://[::1]:11435")).toBe(true);
    expect(endpointIsLocal("https://api.openai.com/v1")).toBe(false);
    expect(endpointIsLocal("http://localhost.evil.com:11435")).toBe(false);
    expect(endpointIsLocal("http://127.0.0.1.evil.com")).toBe(false);
    expect(endpointIsLocal("http://10.0.0.5:11435")).toBe(false);
    expect(endpointIsLocal("")).toBe(false); // unparseable ⇒ fail closed
    expect(endpointIsLocal("not a url")).toBe(false);
    // http(s) only — chat.rs accepts exactly those schemes (F2)
    expect(endpointIsLocal("file://localhost/etc/hosts")).toBe(false);
    expect(endpointIsLocal("ftp://127.0.0.1/x")).toBe(false);
  });

  test("a localhost frontier proxy is not an on-device model", () => {
    expect(modelIsOnDevice({ provider: "mlx", endpoint: "http://127.0.0.1:11435" })).toBe(true);
    expect(modelIsOnDevice({ provider: "llamacpp", endpoint: "http://localhost:8080" })).toBe(true);
    expect(modelIsOnDevice({ provider: "claude", endpoint: "http://127.0.0.1:9000" })).toBe(false);
    expect(modelIsOnDevice({ provider: "mlx", endpoint: "https://models.example.com" })).toBe(false);
  });

  test("detects copied private prose without flagging short generic overlap", () => {
    const source = "The unannounced acquisition plan moves the research team to Montreal next spring.";
    expect(
      containsPrivateDataOverlap("search: acquisition plan moves the research team to Montreal", [source]),
    ).toBe(true);
    expect(containsPrivateDataOverlap("research team", [source])).toBe(false);
  });
});

// ── the loop ──────────────────────────────────────────────────────────────────

describe("runAgent", () => {
  test("recalls prior chats through the master memory protocol", async () => {
    const { host, calls } = fakeHost([
      '{"tool":"search_memory","args":{"query":"cedar launch decision"}}',
      '{"tool":"read_memory","args":{"id":"chat:cedar"}}',
      '{"final":"The Cedar launch decision was set for July."}',
    ]);
    const { final } = await run(host, { history: [], userText: "What did we decide before?", web: false });
    expect(final).toContain("July");
    expect(calls.searchMemory).toEqual(["cedar launch decision"]);
    expect(calls.readMemory).toEqual(["chat:cedar"]);
  });

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

  test("preloads an explicitly attached note through the host access gate", async () => {
    const { host, calls } = fakeHost(['{"final":"I used the attached note."}']);
    const { events } = await run(host, {
      history: [],
      userText: "What should I change?",
      web: false,
      noteId: "secure-or-local-note-id",
    });

    expect(calls.readNote).toEqual(["secure-or-local-note-id"]);
    expect(events).toContainEqual({ type: "status", text: "reading the attached note…" });
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

  test("blocks attempted non-secret private-prose exfiltration after a note read", async () => {
    const privateBody = "The unannounced acquisition plan moves the research team to Montreal next spring.";
    const { host, calls } = fakeHost(
      [
        '{"tool":"read_note","args":{"id":"n1"}}',
        '{"tool":"web_search","args":{"query":"acquisition plan moves the research team to Montreal"}}',
        '{"final":"I did not send the private text."}',
      ],
      { readNote: async () => privateBody },
    );
    const { final } = await run(host, { history: [], userText: "research this", web: true });
    expect(final).toContain("did not send");
    expect(calls.webSearch).toEqual([]);
  });

  test("blocks private prose copied from the untrusted knowledge map", async () => {
    const privateTitle = "Confidential Montreal acquisition planning milestones";
    const { host, calls } = fakeHost(
      [
        '{"tool":"web_search","args":{"query":"Confidential Montreal acquisition planning milestones"}}',
        '{"final":"I kept the private title local."}',
      ],
      {
        knowledgeMap: async () =>
          JSON.stringify({ areas: [{ name: "Projects", notes: [{ title: privateTitle }] }] }),
      },
    );
    await run(host, { history: [], userText: "research this", web: true });
    expect(calls.webSearch).toEqual([]);
  });

  test("generate_image dispatches only when imageTool is on", async () => {
    const { host, calls } = fakeHost([
      '{"tool":"generate_image","args":{"prompt":"a warm quokka sticker"}}',
      '{"final":"your image is ready"}',
    ]);
    const { final } = await run(host, {
      history: [],
      userText: "draw me a quokka",
      web: false,
      imageTool: true,
    });
    expect(final).toBe("your image is ready");
    expect(calls.generateImage).toEqual(["a warm quokka sticker"]);
  });

  test("generate_image is refused when imageTool is off (never reaches the host)", async () => {
    const { host, calls } = fakeHost([
      '{"tool":"generate_image","args":{"prompt":"anything"}}', // invalid → observation
      '{"final":"no images here"}',
    ]);
    const { final } = await run(host, { history: [], userText: "draw", web: false });
    expect(final).toBe("no images here");
    expect(calls.generateImage).toEqual([]);
  });

  test("the egress guard blocks a secret-shaped image prompt", async () => {
    const { host, calls } = fakeHost([
      '{"tool":"generate_image","args":{"prompt":"render sk-ant-api03-EXAMPLE0EXAMPLE0EXAM"}}',
      '{"final":"not sending that"}',
    ]);
    const { final } = await run(host, { history: [], userText: "draw my key", web: false, imageTool: true });
    expect(final).toBe("not sending that");
    expect(calls.generateImage).toEqual([]); // guard fired before the host
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

  test("repeated duplicate calls strike out instead of burning every step (#93)", async () => {
    const same = '{"tool":"search_notes","args":{"query":"pricing"}}';
    // step 1 executes; steps 2+3 are duplicates → two strikes → force-final
    const { host, calls } = fakeHost([same, same, same, "forced final answer"]);
    const { final } = await run(host, { history: [], userText: "q", web: false });
    expect(final).toBe("forced final answer");
    expect(calls.searchNotes).toEqual(["pricing"]); // executed exactly once
  });

  test("insisting on a guard-blocked web call strikes out too (#93)", async () => {
    const leak = '{"tool":"web_search","args":{"query":"sk-ant-api03-EXAMPLE0EXAMPLE0EXAM"}}';
    // blocked (strike 1) → re-issued, now also a duplicate (strike 2) → final
    const { host, calls } = fakeHost([leak, leak, "best effort without the web"]);
    const { final } = await run(host, { history: [], userText: "q", web: true });
    expect(final).toBe("best effort without the web");
    expect(calls.webSearch).toEqual([]); // never reached the host
  });

  test("a fresh valid call resets the strike counter", async () => {
    const dup = '{"tool":"search_notes","args":{"query":"pricing"}}';
    const other = '{"tool":"read_note","args":{"id":"n1"}}';
    // duplicate (strike 1) → NEW call (reset) → duplicate (strike 1) → final
    const { host } = fakeHost([dup, dup, other, dup, '{"final":"done"}']);
    const { final } = await run(host, { history: [], userText: "q", web: false, maxSteps: 5 });
    expect(final).toBe("done");
  });
});
