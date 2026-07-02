// The rotli/Tauri-backed Host — the ONLY place the engine touches the app. It wires
// the abstract tools to real commands: the model bridge (chat_messages), corpus
// retrieval (the memex knowledge base), and the web primitives. Everything above this
// file is host-agnostic and liftable into the shared ~/.memex/ai client layer.

import {
  type ChatModelInfo,
  chatMessages,
  corpusFileBytes,
  corpusFileText,
  corpusList,
  corpusReadAi,
  corpusSearch,
  webFetch as tauriWebFetch,
  webSearch as tauriWebSearch,
} from "../lib/tauri";
import { workbookToCsv } from "../lib/sheets";
import { buildIndex, rankNotes } from "./tools";
import type { Host } from "./types";

const SHEET_BIN = new Set(["xlsx", "xls", "xlsm", "ods"]);
const SHEET_TEXT = new Set(["csv", "tsv"]);

export function makeTauriHost(model: ChatModelInfo): Host {
  return {
    complete({ messages, formatJson }) {
      const opts: { model: string; endpoint: string; api: string; formatJson?: boolean } = {
        model: model.id,
        endpoint: model.endpoint,
        api: model.api,
      };
      if (formatJson !== undefined) opts.formatJson = formatJson;
      return chatMessages(messages, opts);
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
      if (SHEET_BIN.has(ext)) return workbookToCsv({ base64: await corpusFileBytes(file.id) });
      if (SHEET_TEXT.has(ext)) return workbookToCsv({ csv: await corpusFileText(file.id) });
      return corpusFileText(file.id);
    },
    webSearch(query, limit) {
      return tauriWebSearch(query, limit);
    },
    webFetch(url, maxChars) {
      return tauriWebFetch(url, maxChars);
    },
    async knowledgeMap(maxChars) {
      const { notes } = await corpusList();
      return buildIndex(notes, maxChars);
    },
  };
}
