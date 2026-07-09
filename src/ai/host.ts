// The rotli/Tauri-backed Host — the ONLY place the engine touches the app. It wires
// the abstract tools to real commands: the model bridge (chat_messages), corpus
// retrieval (the memex knowledge base), and the web primitives. Everything above this
// file is host-agnostic and liftable into the shared ~/.memex/ai client layer.

import {
  type ChatModelInfo,
  chatMessages,
  cliComplete,
  corpusFileBytes,
  corpusFileText,
  corpusList,
  corpusReadAi,
  corpusSearch,
  generateImage as tauriGenerateImage,
  webFetch as tauriWebFetch,
  webSearch as tauriWebSearch,
} from "../lib/tauri";
import {
  SHEET_BIN,
  SHEET_TEXT,
} from "../sheets/kinds";
import { workbookToCsv } from "../sheets/view";
import { buildIndex, rankNotes } from "./tools";
import type { CompleteReq, Host } from "./types";

/** Mirror of Rust `flatten_messages`: the loop sends ONE user message (the
 * whole rendered prompt) which passes verbatim; anything else gets labeled
 * turns + a trailing Assistant: cue. */
function flattenWire(messages: CompleteReq["messages"]): string {
  const [only] = messages;
  if (messages.length === 1 && only && only.role === "user") return only.content;
  const labeled = messages.map((m) => {
    const label = m.role === "system" ? "System" : m.role === "assistant" ? "Assistant" : "User";
    return `${label}: ${m.content}`;
  });
  return `${labeled.join("\n\n")}\n\nAssistant:`;
}

export interface HostImageCtx {
  /** The active memex root path (Rust re-validates against registered roots). */
  root: string;
  /** The chat's slug — pins the assets dir storage/chats/<slug>/. */
  slug: string;
  engine: "codex" | "agy";
}

export function makeTauriHost(
  model: ChatModelInfo,
  opts?: { requestId?: string; image?: HostImageCtx },
): Host {
  return {
    complete({ messages, formatJson }) {
      // the connected lanes: one tool-less subprocess per step (Rust owns the
      // allowlist + sandbox flags). Stateless — the prompt carries everything.
      if (model.api === "cli") {
        return cliComplete({
          requestId: opts?.requestId ?? crypto.randomUUID(),
          provider: model.provider,
          model: model.id,
          prompt: flattenWire(messages),
        });
      }
      const wireOpts: { model: string; endpoint: string; api: string; formatJson?: boolean } = {
        model: model.id,
        endpoint: model.endpoint,
        api: model.api,
      };
      if (formatJson !== undefined) wireOpts.formatJson = formatJson;
      return chatMessages(messages, wireOpts);
    },
    async searchNotes(query, limit) {
      // FULL-TEXT search in Rust (corpus_search: title > body rank, framed match
      // snippets) — the same engine the ⌘K palette uses, instead of keyword-
      // ranking 140-char list snippets (#9, audit 2026-07). Boards/files are
      // dropped for parity with rankNotes: read_note can't open them (files go
      // through read_file). rankNotes stays as the fallback so the browser twin
      // (and a search error) still answer from the listing.
      try {
        const hits = await corpusSearch(query, limit);
        return hits
          .filter((h) => h.kind === "note")
          .map((h) => ({ id: h.id, title: h.title, snippet: h.snippet, folder: h.folderId }));
      } catch {
        const { notes } = await corpusList();
        return rankNotes(notes, query, limit);
      }
    },
    readNote(id) {
      // Locality is DERIVED from the picked model's endpoint (loopback check) —
      // never asserted (#2, audit 2026-07). Rust re-derives it from the same
      // endpoint inside corpus_read_ai, so the webview never sends a trust bit.
      return corpusReadAi(id, model.endpoint);
    },
    async readFile(query) {
      const { notes } = await corpusList();
      const q = query.toLowerCase().trim().replace(/^["']|["']$/g, "");
      const files = notes.filter((n) => n.kind === "file");
      const file =
        files.find((n) => n.title.toLowerCase() === q) ??
        files.find((n) => n.title.toLowerCase().includes(q));
      if (!file) return `no file matching "${query}". Use the exact filename (e.g. report.csv).`;
      const ext = (file.title.split(".").pop() ?? "").toLowerCase();
      if (SHEET_BIN.has(ext)) return await workbookToCsv({ base64: await corpusFileBytes(file.id) });
      if (SHEET_TEXT.has(ext)) return await workbookToCsv({ csv: await corpusFileText(file.id) });
      return corpusFileText(file.id);
    },
    webSearch(query, limit) {
      return tauriWebSearch(query, limit);
    },
    webFetch(url, maxChars) {
      return tauriWebFetch(url, maxChars);
    },
    async generateImage(prompt) {
      // only offered to the loop when the caller wired the chat's assets ctx
      // (imageTool gate) — this branch is the belt-and-suspenders message
      if (!opts?.image) return "error: image generation isn't set up for this chat.";
      const { root, slug, engine } = opts.image;
      return tauriGenerateImage({
        requestId: opts?.requestId ?? crypto.randomUUID(),
        root,
        slug,
        prompt,
        engine,
      });
    },
    async knowledgeMap(maxChars) {
      const { notes } = await corpusList();
      return buildIndex(notes, maxChars);
    },
  };
}
