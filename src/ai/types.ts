// The agentic memex client — shared shapes.
//
// "The memex IS the knowledge base." This engine drives a small on-device model
// through a JSON tool-use loop so it can navigate the user's notes (their memex —
// organized into areas with titles/summaries/metadata) and, when a chat opts in,
// the public web. It is host-agnostic: the ONLY rotli/Tauri coupling is the `Host`,
// so the whole module lifts into the shared ~/.memex/ai client layer later.

import type { ModelMeta } from "./budget";

export type ToolName =
  | "search_notes"
  | "read_note"
  | "search_memory"
  | "read_memory"
  | "read_file"
  | "web_search"
  | "web_fetch"
  | "generate_image";

/** A note the model can read, surfaced by search_notes / the index. */
export interface NoteHit {
  id: string;
  title: string;
  snippet: string;
  folder: string;
}

export interface MemoryHit {
  /** Note id, or a `chat:<slug>` reference. */
  id: string;
  title: string;
  snippet: string;
  source: "note" | "chat";
}

/** A web result surfaced by web_search. */
export interface WebHit {
  title: string;
  url: string;
  snippet: string;
}

/** A prior conversation turn (the user-visible thread, not the scratchpad). */
export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export interface CompleteReq {
  messages: { role: "system" | "user" | "assistant"; content: string; images?: string[] }[];
  /** Ask the model server to coerce a single JSON object (MLX generate shape). */
  formatJson?: boolean;
}

/** The one seam that touches rotli/Tauri. Swap it to run the engine elsewhere. */
export interface Host {
  complete(req: CompleteReq): Promise<string>;
  /** Rank the user's notes for a query (their memex is the knowledge base). */
  searchNotes(query: string, limit: number): Promise<NoteHit[]>;
  /** Read one note by id. Secure notes require explicit local-AI permission;
   * remote models can never read them. */
  readNote(id: string): Promise<string>;
  /** Master retrieval across organized notes and prior chats. Optional so a
   * portable host can degrade to note search without implementing chat IO. */
  searchMemory?(query: string, limit: number): Promise<MemoryHit[]>;
  readMemory?(id: string): Promise<string>;
  /** Read a surfaced FILE by name (text, or a spreadsheet as CSV) so the model can
   * answer questions about it. Returns a not-found message if no file matches. */
  readFile(query: string): Promise<string>;
  webSearch(query: string, limit: number): Promise<WebHit[]>;
  webFetch(url: string, maxChars: number): Promise<string>;
  /** Generate an image into this chat's assets via a connected engine. Returns
   * the saved corpus-relative path (the observation the model reports). */
  generateImage(prompt: string): Promise<string>;
  /** A compact index of the knowledge base so the model sees what exists up front.
   * Bounded by `maxChars`: a full per-note index if it fits, else an areas map. */
  knowledgeMap(maxChars: number): Promise<string>;
}

/** The classified result of a model step. */
export type Parsed =
  | { kind: "call"; tool: ToolName; args: Record<string, unknown> }
  | { kind: "final"; text: string }
  | { kind: "invalid"; reason: string }
  | { kind: "unparseable"; raw: string };

/** One entry in the agent's working memory (its tool calls + their observations). */
export interface ScratchStep {
  /** A stable signature of the action (drives the duplicate guard) or the raw reply. */
  action: string;
  result: string;
}

/** What the loop yields as it runs (no token streaming → status IS the feedback). */
export type AgentEvent =
  | { type: "status"; text: string }
  | { type: "tool"; tool: ToolName; args: Record<string, unknown> }
  | { type: "final"; text: string };

export interface RunInput {
  /** Prior user-visible turns. */
  history: ChatTurn[];
  /** The new user message. */
  userText: string;
  /** Per-chat web toggle (the composer globe). */
  web: boolean;
  /** The picked model — drives the context budget (index size, caps, steps). */
  model: ModelMeta;
  /** Base64 images attached to this turn (vision models only). */
  images?: string[];
  /** Tool-use step cap (default: the model's budget). */
  maxSteps?: number;
  /** Offer the generate_image tool (a connected engine is set up + the chat is
   * saved, so its assets dir is well-defined). Independent of the web globe. */
  imageTool?: boolean;
}
