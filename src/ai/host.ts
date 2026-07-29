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
  corpusFrontmatter,
  corpusList,
  corpusReadAi,
  corpusSearch,
  generateImage as tauriGenerateImage,
  webFetch as tauriWebFetch,
  webSearch as tauriWebSearch,
} from "../lib/tauri";
import { SHEET_BIN, SHEET_TEXT } from "../sheets/kinds";
import { extOf } from "../lib/fileKind";
import { workbookToCsv } from "../sheets/view";
import { rankNotes } from "./tools";
import { contextWindowFor } from "./budget";
import { buildModelMap } from "../memex/modelMap";
import { activeInstance } from "../memex/config";
import { listChats, loadConfig, readChat as readMemexChat } from "../memex/service";
import { hasSecureContext } from "../memex/contract";
import { invalidateMemex } from "../memex/useMemex";
import { createRoutedNote } from "../services/createNote";
import { invalidateNotes } from "../services/hooks";
import { usePanesStore } from "../state/panes";
import { memoryKeywords, mergeKeywordHits, rankChatMemories } from "../chatMemory/retrieval";
import { looksSecret, modelIsOnDevice } from "./guard";
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

const chatBodyCache = new Map<string, { modifiedMs: number; body: string }>();

async function cachedChatBody(
  root: string,
  slug: string,
  modifiedMs: number,
  read: () => Promise<string>,
): Promise<string> {
  const key = `${root}\0${slug}`;
  const cached = chatBodyCache.get(key);
  if (cached?.modifiedMs === modifiedMs) return cached.body;
  const body = await read();
  chatBodyCache.set(key, { modifiedMs, body });
  if (chatBodyCache.size > 500) chatBodyCache.delete(chatBodyCache.keys().next().value ?? "");
  return body;
}

async function aiReadableHits<T extends { id: string }>(hits: T[], model: ChatModelInfo): Promise<T[]> {
  const allowed = await Promise.all(
    hits.map(async (hit) => {
      try {
        await corpusReadAi(hit.id, model);
        return true;
      } catch {
        return false;
      }
    }),
  );
  return hits.filter((_hit, index) => allowed[index] === true);
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
  opts?: {
    requestId?: string;
    image?: HostImageCtx;
    /** Fired when this run reads a SECURE note (a local model with per-note
     * permission may) — the chat surface taints the chat so its history can
     * never later ride to a remote model (audit 2026-07-29 #7). */
    onSecureNoteRead?: () => void;
    /** Whether this chat already carries secure-note content — a note the
     * model creates in that state is stamped `secure: true`, so a same-run
     * create_note can't launder secure prose into an open note (PR #4 P1). */
    isSecureContext?: () => boolean;
  },
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
        const readable = await aiReadableHits(
          hits.filter((hit) => hit.kind === "note"),
          model,
        );
        return readable.map((h) => ({ id: h.id, title: h.title, snippet: h.snippet, folder: h.folderId }));
      } catch {
        const { notes } = await corpusList();
        const ranked = rankNotes(notes, query, limit);
        return aiReadableHits(ranked, model);
      }
    },
    async readNote(id) {
      // Rust verifies model id + provider registration + loopback endpoint.
      // A localhost proxy for a frontier provider therefore remains remote.
      const text = await corpusReadAi(id, model);
      if (opts?.onSecureNoteRead) {
        try {
          const frontmatter = await corpusFrontmatter(id);
          // unknowable security state counts as secure — fail closed
          if (!frontmatter || frontmatter.secure === true) opts.onSecureNoteRead();
        } catch {
          opts.onSecureNoteRead();
        }
      }
      return text;
    },
    async createNote(title, body) {
      // the same intake lane as the workspace CLI and ⌘N with a smart row
      // selected: memex staging when a writable memex is active, else the
      // local Inbox. The model's text is CONTENT, never a path or a folder.
      const heading = title && !/^#\s/.test(body) ? `# ${title}\n\n` : "";
      const markdown = `${heading}${body}\n`.replace(/\n+$/, "\n");
      // a chat that carries secure-note content writes SECURE notes — the
      // model cannot launder secure prose into an open note (PR #4 P1)
      const secure = opts?.isSecureContext?.() === true;
      const id = await createRoutedNote({
        selectedFolderId: "",
        isSmart: true,
        localFallback: "Inbox",
        body: markdown,
        ...(secure ? { secure: true } : {}),
      });
      await Promise.all([invalidateNotes(), invalidateMemex()]);
      return `created ${secure ? "SECURE " : ""}note ${id}${title ? ` ("${title}")` : ""} in the intake${
        secure ? " (marked secure because this chat carries secure-note content)" : ""
      } — tell the user it's there, and offer open_note to show it.`;
    },
    async openNote(id) {
      usePanesStore.getState().openNote(id);
      return `opened note ${id} in a tab. Tell the user it's on screen.`;
    },
    async searchMemory(query, limit) {
      const queries = [query, ...memoryKeywords(query)].slice(0, 7);
      const noteResults = await Promise.all(queries.map((part) => corpusSearch(part, limit).catch(() => [])));
      const readableNoteHits = await aiReadableHits(
        mergeKeywordHits(noteResults).filter((hit) => hit.kind === "note"),
        model,
      );
      const noteHits = readableNoteHits.map((hit) => ({
        id: hit.id,
        title: hit.title,
        snippet: hit.snippet,
        source: "note" as const,
      }));
      const instance = activeInstance(await loadConfig());
      if (!instance) return noteHits.slice(0, limit);
      const summaries = (await listChats(instance)).slice(0, 100);
      const documents = await Promise.all(
        summaries.map(async (summary) => ({
          slug: summary.slug,
          title: summary.title,
          body: await cachedChatBody(instance.root, summary.slug, summary.modifiedMs, () =>
            readMemexChat(instance, summary.slug),
          ),
          modifiedMs: summary.modifiedMs,
        })),
      );
      // A remote model never receives a secret-shaped chat, nor one whose
      // secureContext marker says a secure note fed its transcript. The
      // provider's Rust egress detector is the final backstop on send.
      const safeDocuments = modelIsOnDevice(model)
        ? documents
        : documents.filter((document) => !looksSecret(document.body) && !hasSecureContext(document.body));
      const chatHits = rankChatMemories(safeDocuments, query, limit).map(({ score: _score, ...hit }) => hit);
      const chatQuota = Math.ceil(limit / 2);
      const selected = [...chatHits.slice(0, chatQuota), ...noteHits.slice(0, limit - chatQuota)];
      if (selected.length < limit) {
        selected.push(...chatHits.slice(chatQuota, chatQuota + limit - selected.length));
        selected.push(...noteHits.slice(limit - chatQuota, limit - chatQuota + limit - selected.length));
      }
      return selected.slice(0, limit);
    },
    async readMemory(id) {
      if (!id.startsWith("chat:")) return corpusReadAi(id, model);
      const instance = activeInstance(await loadConfig());
      if (!instance) return "error: no active memory is connected.";
      const body = await readMemexChat(instance, id.slice("chat:".length));
      if (!modelIsOnDevice(model) && looksSecret(body)) {
        return "blocked: this prior chat contains secret-shaped content and cannot be sent to a remote model.";
      }
      return body;
    },
    async readFile(query) {
      const { notes } = await corpusList();
      const q = query
        .toLowerCase()
        .trim()
        .replace(/^["']|["']$/g, "");
      const files = notes.filter((n) => n.kind === "file");
      const file =
        files.find((n) => n.title.toLowerCase() === q) ??
        files.find((n) => n.title.toLowerCase().includes(q));
      if (!file) return `no file matching "${query}". Use the exact filename (e.g. report.csv).`;
      const ext = extOf(file.title);
      const text = SHEET_BIN.has(ext)
        ? await workbookToCsv({ base64: await corpusFileBytes(file.id) })
        : SHEET_TEXT.has(ext)
          ? await workbookToCsv({
              csv: await corpusFileText(file.id),
              delimiter: ext === "tsv" ? "\t" : ",",
            })
          : await corpusFileText(file.id);
      // Storage files carry no frontmatter, so they skip corpus_read_ai's
      // secure gate — apply the same policy prior chats get (audit 2026-07):
      // a remote model never receives secret-shaped file contents.
      if (!modelIsOnDevice(model) && looksSecret(text)) {
        return "blocked: this file contains secret-shaped content and cannot be sent to a remote model.";
      }
      return text;
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
      // Titles are knowledge too. Apply the same secure-note gate before the
      // model sees the master map: remote models never see secure entries, and
      // a local model sees them only after explicit per-note permission.
      const readable = await aiReadableHits(notes, model);
      return buildModelMap(readable, contextWindowFor(model), maxChars);
    },
  };
}
