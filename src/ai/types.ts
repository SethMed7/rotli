// The agentic memex client — shared shapes.
//
// "The memex IS the knowledge base." This engine drives a small on-device model
// through a JSON tool-use loop so it can navigate the user's notes (their memex —
// organized into areas with titles/summaries/metadata) and, when a chat opts in,
// the public web. It is host-agnostic: the ONLY rotli/Tauri coupling is the `Host`,
// so the whole module lifts into the shared ~/.memex/ai client layer later.

import type { ChatArtifactKind } from "./artifacts";
import type { ModelMeta } from "./budget";
import type { WebSearchProvider } from "./searchProvider";

export type ToolName =
  | "search_notes"
  | "read_note"
  | "create_note"
  | "create_document"
  | "update_note"
  | "open_note"
  | "search_memory"
  | "read_memory"
  | "read_file"
  | "research_web"
  | "web_search"
  | "web_fetch"
  | "create_artifact"
  | "generate_image"
  | "draw_board";

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
  /** "area-index" — the Filer's generated `_index` note for an area, whose body
   * is the one complete roster of what's filed there. Nothing else in a hit
   * distinguishes it from the area's hand-written README (2026-08-01). */
  role?: "area-index";
}

/** A web result surfaced by web_search. */
export interface WebHit {
  provider: WebSearchProvider;
  title: string;
  url: string;
  snippet: string;
}

export interface WebEvidenceSource {
  sourceId: string;
  provider: WebSearchProvider;
  title: string;
  url: string;
  searchExcerpt: string;
  evidence: string;
}

/** A prior conversation turn (the user-visible thread, not the scratchpad). */
export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

/** A bounded choice the model cannot safely infer. The application renders
 * this consistently for every local, connected, and hybrid provider. */
export interface AgentQuestion {
  prompt: string;
  options: string[];
}

export interface CompleteReq {
  messages: { role: "system" | "user" | "assistant"; content: string; images?: string[] }[];
  /** Ask the model server to coerce a single JSON object (MLX generate shape). */
  formatJson?: boolean;
}

/** The one seam that touches rotli/Tauri. Swap it to run the engine elsewhere. */
export interface Host {
  complete(req: CompleteReq): Promise<string>;
  /** Stream a completion token-by-token (on-device models only). Yields each raw
   * token segment and returns the full reply — the loop feeds tokens through the
   * final-answer extractor so the surface renders the answer as it's written.
   * Optional: hosts that can't stream (remote/CLI lanes, portable hosts) omit it
   * and the loop falls back to `complete`. */
  stream?(req: CompleteReq): AsyncGenerator<string, string, void>;
  /** Rank the user's notes for a query (their memex is the knowledge base). */
  searchNotes(query: string, limit: number): Promise<NoteHit[]>;
  /** Read one note by id. Secure notes require explicit local-AI permission;
   * remote models can never read them. */
  readNote(id: string): Promise<string>;
  /** CREATE a note — the same intake lane as the workspace CLI (staging/Inbox;
   * the organizer files it later). Returns the observation the model reports. */
  createNote(title: string, body: string): Promise<string>;
  /** Create a conventional editable Word document through the desktop's
   * managed-document workflow. Optional so browser/headless hosts do not
   * pretend to provide native file creation. */
  createDocument?(title: string, body: string): Promise<string>;
  /** REWRITE an existing note's editor body (frontmatter preserved). Gated
   * like a read — the model may only edit what it could read — and a
   * secure-context chat may only edit notes that are themselves secure.
   * Optional so headless/portable hosts can stay read-only. */
  updateNote?(id: string, body: string): Promise<string>;
  /** Open a note on screen (a tab in the app). Optional — headless hosts skip it. */
  openNote?(id: string): Promise<string>;
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
  /** Create a conventional editable work product through Rotli's existing
   * document/sheet/PDF-source workflows. */
  createArtifact?(kind: ChatArtifactKind, title: string, content: string): Promise<string>;
  /** Turn Mermaid flowchart source into an editable Excalidraw board in the
   * user's boards and show it (generative UI, 2026-08-03). Mermaid is the wire
   * format on purpose: every model — especially local ones — writes it far
   * more reliably than raw Excalidraw JSON; the conversion is local. Optional
   * — headless/portable hosts skip it. */
  drawBoard?(title: string, mermaid: string): Promise<string>;
  /** A compact index of the knowledge base so the model sees what exists up front.
   * Bounded by `maxChars`: a full per-note index if it fits, else an areas map. */
  knowledgeMap(maxChars: number): Promise<string>;
}

/** The classified result of a model step. */
export type Parsed =
  | { kind: "call"; tool: ToolName; args: Record<string, unknown>; thought?: string }
  | ({ kind: "question"; thought?: string } & AgentQuestion)
  | { kind: "final"; text: string; thought?: string }
  | { kind: "invalid"; reason: string }
  | { kind: "unparseable"; raw: string };

/** One entry in the agent's working memory (its tool calls + their observations). */
export interface ScratchStep {
  /** A stable signature of the action (drives the duplicate guard) or the raw reply. */
  action: string;
  /** Bounded, model-authored reasoning checkpoint. It is private working
   * memory: defused before re-entry and never emitted as an AgentEvent. */
  thought?: string;
  result: string;
  /** Snapshot written when the step completes; never recomputed later. */
  remainingSteps?: number;
}

/** What the loop yields as it runs. A `delta` carries the next slice of the
 * final answer as the on-device model writes it — the surface appends it to the
 * live row; the terminating `final` is the authoritative, complete answer. */
export type AgentEvent =
  | { type: "status"; text: string }
  | { type: "tool"; tool: ToolName; args: Record<string, unknown> }
  | { type: "delta"; text: string }
  | ({ type: "question" } & AgentQuestion)
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
  /** A note explicitly attached to this chat. The host's independent read gate
   * still decides whether the picked model may receive its contents. */
  noteId?: string;
  /** Base64 images attached to this turn (vision models only). */
  images?: string[];
  /** Tool-use step cap (default: the model's budget). */
  maxSteps?: number;
  /** Offer the generate_image tool (a connected engine is set up + the chat is
   * saved, so its assets dir is well-defined). Independent of the web globe. */
  imageTool?: boolean;
  /** Offer native editable Word-document creation (desktop app only). */
  documentTool?: boolean;
  /** Offer the draw_board tool (the desktop app; conversion is fully local). */
  boardTool?: boolean;
  /** Offer conventional document, sheet, and PDF-copy creation. */
  artifactTool?: boolean;
  /** The user's name for prompt personalization — omit when unset. */
  userName?: string;
  /** Stream the final answer token-by-token when the host supports it (default
   * true). The hybrid layer sets this false — its legs run to completion and
   * only the outer final is surfaced, so an inner leg mustn't stream deltas. */
  stream?: boolean;
}
