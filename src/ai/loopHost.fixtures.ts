// The scripted fake Host the agent-loop tests drive (split out of
// loop.test.ts to keep it within its size ratchet): canned model replies, and
// every tool call recorded. Test support only (check:prompt-brands).

import type { Approved } from "../lib/promptText";
import { type LooseHost, approvedRow, brandHost } from "../lib/promptText.fixtures";
import type { CorpusNoteMeta } from "../lib/tauri";
import { runAgent } from "./loop";
import type { AgentEvent, CompleteReq, Host, RunInput, ToolName } from "./types";

export function note(p: Partial<CorpusNoteMeta> & { id: string; title: string }): Approved<CorpusNoteMeta> {
  return approvedRow({ snippet: "", folderId: "", createdAt: 0, updatedAt: 0, pinned: false, ...p });
}

export interface Calls {
  complete: CompleteReq[];
  searchMemory: string[];
  readMemory: string[];
  searchNotes: string[];
  readNote: string[];
  webSearch: string[];
  webFetch: string[];
  generateImage: string[];
}

export function fakeHost(replies: string[], over: Partial<LooseHost> = {}): { host: Host; calls: Calls } {
  let i = 0;
  const calls: Calls = {
    complete: [],
    searchMemory: [],
    readMemory: [],
    searchNotes: [],
    readNote: [],
    webSearch: [],
    webFetch: [],
    generateImage: [],
  };
  const host = brandHost({
    complete: async (req) => {
      calls.complete.push(req);
      return replies[i++] ?? '{"final":"(script exhausted)"}';
    },
    searchNotes: async (q) => {
      calls.searchNotes.push(q);
      return [{ id: "n1", title: "Pricing", snippet: "Northstar pricing", folder: "Projects" }];
    },
    readNote: async (id) => {
      calls.readNote.push(id);
      return `# Pricing\nNorthstar pricing is $99/mo (note ${id}).`;
    },
    searchMemory: async (q) => {
      calls.searchMemory.push(q);
      return [{ id: "chat:cedar", title: "Cedar launch", snippet: "July decision", source: "chat" }];
    },
    readMemory: async (id) => {
      calls.readMemory.push(id);
      return `# Cedar launch\nThe July decision came from ${id}.`;
    },
    createNote: async (title) => `created note n-new ("${title}") in the intake`,
    readFile: async (q) => `csv,for,${q}\n1,2,3`,
    webSearch: async (q) => {
      calls.webSearch.push(q);
      return [
        { provider: "duckduckgo", title: "Result", url: "https://example.com", snippet: "a web snippet" },
      ];
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
  });
  return { host, calls };
}

export async function run(
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

export const ALL: ReadonlySet<ToolName> = new Set<ToolName>([
  "search_notes",
  "read_note",
  "search_memory",
  "read_memory",
  "research_web",
  "web_search",
  "web_fetch",
]);
