// The rotli/Tauri-backed Host — the ONLY place the engine touches the app. It wires
// the abstract tools to real commands: the model bridge (chat_messages), corpus
// retrieval (the memex knowledge base), and the web primitives. Everything above this
// file is host-agnostic and liftable into the shared ~/.memex/ai client layer.

import { createEditableBoardFromMermaid } from "../boards/composition";
import { memoryKeywords, mergeKeywordHits, rankChatMemories } from "../chatMemory/retrieval";
import { documentImageFromBase64 } from "../documents/images";
import { DOCX_EDITABLE } from "../documents/kinds";
import type { DocumentImage } from "../documents/model";
import { extOf, fileName } from "../lib/fileKind";
import {
  type ChatModelInfo,
  chatMessages,
  chatMessagesStream,
  cliComplete,
  corpusFileBytes,
  corpusFileText,
  corpusFrontmatter,
  corpusCreateManagedFile,
  corpusExportNotePdf,
  corpusList,
  corpusNotesAi,
  corpusReadAi,
  corpusReadAiVersioned,
  corpusReadableIds,
  corpusSearchAi,
  corpusWriteAi,
  generateImage as tauriGenerateImage,
  webFetch as tauriWebFetch,
  webSearch as tauriWebSearch,
} from "../lib/tauri";
import { activeInstance } from "../memex/config";
import { hasSecureContext } from "../memex/contract";
import { buildModelMap } from "../memex/modelMap";
import { listChats, loadConfig, readChat as readMemexChat } from "../memex/service";
import { invalidateMemex } from "../memex/useMemex";
import {
  createManagedDocumentWithContent,
  createPopulatedManagedItem,
  registerPopulatedManagedItem,
} from "../newItems/composition";
import { createRoutedNote } from "../services/createNote";
import { invalidateNotes } from "../services/hooks";
import { SHEET_BIN, SHEET_TEXT } from "../sheets/kinds";
import { workbookToCsv } from "../sheets/view";
import { usePanesStore } from "../state/panes";
import { artifactFileName, editableDocumentText } from "./artifacts";
import { contextWindowFor } from "./budget";
import { endpointIsLocal, looksSecret, modelIsOnDevice } from "./guard";
import { normalizeGeneratedImageLinks, qualifiedArtifactId } from "./imageLinks";
import { DEFAULT_WEB_SEARCH_PROVIDER, type WebSearchProvider } from "./searchProvider";
import { channelStream } from "./stream";
import {
  folderHits,
  folderQuery,
  isAreaIndex,
  mergeFolderHits,
  rankNotes,
  stripLeadingFrontmatter,
} from "./tools";
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
  if (hits.length === 0) return hits;
  // ONE batched probe (perf audit 2026-07-30, #4) — the per-note corpusReadAi
  // loop was ~350 serial IPC reads holding a chat's first token. Rust remains
  // the enforcement point (read_for_ai per id, secure detector included);
  // this side only filters with the answer. A failed probe reads as "none
  // readable" — fail closed, never open.
  try {
    const readable = new Set(
      await corpusReadableIds(
        hits.map((hit) => hit.id),
        model,
      ),
    );
    return hits.filter((hit) => readable.has(hit.id));
  } catch {
    return [];
  }
}

export interface HostImageCtx {
  /** The active memex root path (Rust re-validates against registered roots). */
  root: string;
  /** Corpus router id used to keep presentation in the same vault. */
  rootId: string;
  /** The chat's slug — pins the assets dir storage/chats/<slug>/. */
  slug: string;
  engine: "codex" | "agy";
}

export type HostArtifactKind = "note" | "file" | "canvas";

export interface CreatedChatArtifact {
  kind: HostArtifactKind;
  id: string;
  label?: string;
}

export function makeTauriHost(
  model: ChatModelInfo,
  opts?: {
    requestId?: string;
    reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
    serviceTier?: "standard" | "fast";
    image?: HostImageCtx;
    /** Registered root that owns conventional files created by this chat. */
    artifactRootId?: string;
    /** Fired when this run reads a SECURE note (a local model with per-note
     * permission may) — the chat surface taints the chat so its history can
     * never later ride to a remote model (audit 2026-07-29 #7). */
    onSecureNoteRead?: () => void;
    /** Whether this chat already carries secure-note content — a note the
     * model creates in that state is stamped `secure: true`, so a same-run
     * create_note can't launder secure prose into an open note (PR #4 P1). */
    isSecureContext?: () => boolean;
    /** Register a newly created conventional artifact with its originating
     * chat. Presentation remains click-to-open so the final reply stays put. */
    onArtifactCreated?: (artifact: CreatedChatArtifact) => void | Promise<void>;
    /** One vault-level destination. The per-chat globe decides whether this
     * capability is offered at all; it never selects the provider. */
    webSearchProvider?: WebSearchProvider;
  },
): Host {
  const generatedImagePaths: string[] = [];
  const markSecureIds = async (ids: readonly string[]): Promise<void> => {
    if (!opts?.onSecureNoteRead || !modelIsOnDevice(model) || ids.length === 0) return;
    for (const id of new Set(ids)) {
      try {
        const frontmatter = await corpusFrontmatter(id);
        if (!frontmatter || frontmatter.secure) {
          opts.onSecureNoteRead();
          return;
        }
      } catch {
        // A local result with an unknowable protection state is tainted. This
        // can only narrow later egress; it never reveals additional content.
        opts.onSecureNoteRead();
        return;
      }
    }
  };

  const host: Host = {
    complete({ messages, formatJson }) {
      if (!modelIsOnDevice(model) && opts?.isSecureContext?.() === true) {
        return Promise.reject(
          new Error("This chat carries secure-note content and cannot be sent to a remote model."),
        );
      }
      // the connected lanes: one tool-less subprocess per step (Rust owns the
      // allowlist + sandbox flags). Stateless — the prompt carries everything.
      if (model.api === "cli") {
        // attachments ride the FIRST message, exactly like the openai lane
        const attached = messages.flatMap((m) => m.images ?? []);
        return cliComplete({
          requestId: opts?.requestId ?? crypto.randomUUID(),
          provider: model.provider,
          model: model.id,
          prompt: flattenWire(messages),
          ...(opts?.reasoningEffort ? { reasoningEffort: opts.reasoningEffort } : {}),
          ...(opts?.serviceTier ? { serviceTier: opts.serviceTier } : {}),
          ...(attached.length > 0 ? { images: attached } : {}),
        });
      }
      const wireOpts: {
        model: string;
        endpoint: string;
        api: string;
        formatJson?: boolean;
        requestId?: string;
      } = {
        model: model.id,
        endpoint: model.endpoint,
        api: model.api,
      };
      if (formatJson !== undefined) wireOpts.formatJson = formatJson;
      // the LOCAL lane keys its compute queue by this same turn id, so a
      // queued message can be prioritized or taken back from the composer
      // (docs/design/local-compute-guardrails.md). Remote lanes ignore it.
      if (opts?.requestId) wireOpts.requestId = opts.requestId;
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
        // corpus_search reads titles and bodies; the user's FOLDERS are a
        // signal it can't see, so a one-word query also collects the notes
        // filed under a matching area (2026-08-01 — "people" never reached
        // wiki/people/**, and the model answered from an index note's
        // metadata). corpusList rides the same cached walk search does.
        // includeReference: the brain's memory lanes (identity/, personality/,
        // history/, MAP.md, inbox.md) are RETRIEVABLE by both model classes
        // since 2026-08-01 — reachable, not preloaded. Ranking and the budget
        // still decide what actually enters the context
        // (docs/design/ai-visibility-matrix.md).
        const wantsFolders = folderQuery(query);
        const [hits, listed] = await Promise.all([
          corpusSearchAi(query, limit, true, model),
          wantsFolders ? corpusNotesAi(model) : Promise.resolve([]),
        ]);
        const found = hits.filter((hit) => hit.kind === "note");
        const byFolder = wantsFolders ? folderHits(listed, query, limit) : [];
        // ONE batched readability probe over BOTH lanes (perf audit #4) — a
        // second probe would double the IPC on every one-word search
        const permitted = new Set(
          (await aiReadableHits([...found.map((h) => ({ id: h.id })), ...byFolder], model)).map(
            (hit) => hit.id,
          ),
        );
        const ranked = found
          .filter((h) => permitted.has(h.id))
          .map((h) => ({
            hit: {
              id: h.id,
              title: h.title,
              snippet: h.snippet,
              folder: h.folderId,
            },
            rank: h.rank,
          }));
        const result = !wantsFolders
          ? ranked.map((r) => r.hit)
          : mergeFolderHits(
              ranked,
              byFolder.filter((h) => permitted.has(h.id)),
              limit,
            );
        await markSecureIds(result.map((hit) => hit.id));
        return result;
      } catch {
        // the browser twin and a search error still answer from the listing —
        // through the GATED listing, so the fallback is not a way around it
        const ranked = rankNotes(await corpusNotesAi(model), query, limit);
        const result = await aiReadableHits(ranked, model);
        await markSecureIds(result.map((hit) => hit.id));
        return result;
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
      const normalizedBody = normalizeGeneratedImageLinks(body, generatedImagePaths);
      const markdown = `${heading}${normalizedBody}\n`.replace(/\n+$/, "\n");
      // a chat that carries secure-note content writes SECURE notes — the
      // model cannot launder secure prose into an open note (PR #4 P1)
      const secure = opts?.isSecureContext?.() === true;
      const id = await createRoutedNote({
        selectedFolderId: "",
        isSmart: true,
        localFallback: "Inbox",
        body: markdown,
        ...(opts?.artifactRootId ? { rootId: opts.artifactRootId } : {}),
        ...(secure ? { secure: true } : {}),
      });
      await Promise.all([invalidateNotes(), invalidateMemex()]);
      return `created ${secure ? "SECURE " : ""}note ${id}${title ? ` ("${title}")` : ""} in the intake${
        secure ? " (marked secure because this chat carries secure-note content)" : ""
      } — tell the user it's there, and offer open_note to show it.`;
    },
    async createDocument(title, body) {
      // DOCX files do not carry note-level secure/locked metadata. Refuse a
      // tainted write instead of laundering protected prose into an open file.
      if (opts?.isSecureContext?.() === true) {
        return "blocked: this chat carries secure-note content, and Word documents are not protected note files. Create a secure Markdown note instead.";
      }
      const documentTitle = title.trim() || "Document";
      let images: DocumentImage[] = [];
      try {
        images = await Promise.all(
          generatedImagePaths.map(async (path, index) => {
            const extension = extOf(path);
            const mimeType: DocumentImage["mimeType"] | null =
              extension === "png"
                ? "image/png"
                : extension === "jpg" || extension === "jpeg"
                  ? "image/jpeg"
                  : extension === "gif"
                    ? "image/gif"
                    : extension === "bmp"
                      ? "image/bmp"
                      : null;
            if (!mimeType) throw new Error(`unsupported generated image format: .${extension || "unknown"}`);
            const base64 = await corpusFileBytes(path, 24 * 1024 * 1024);
            if (!base64) throw new Error(`generated image is unavailable: ${path}`);
            return documentImageFromBase64(`generated-image-${index + 1}`, fileName(path), mimeType, base64);
          }),
        );
      } catch (error) {
        return `error: the generated image could not be embedded safely — ${error instanceof Error ? error.message : String(error)}. The Word document was not created.`;
      }
      const item = await createManagedDocumentWithContent(documentTitle, body, {
        open: false,
        ...(images.length ? { images } : {}),
        ...(opts?.artifactRootId ? { rootId: opts.artifactRootId } : {}),
      });
      await opts?.onArtifactCreated?.({ kind: "file", id: item.id, label: documentTitle });
      return `created editable Word document ${item.id} ("${documentTitle}")${images.length ? ` with ${images.length} embedded image${images.length === 1 ? "" : "s"}` : ""}. It is available in this chat's Artifacts and remains closed until the user clicks it. This is a real .docx file, not a Markdown note.`;
    },
    async updateNote(id, body) {
      // EDIT rides the AI write lane (corpus_write_ai: the read gate, then the
      // LOCKED refusal, then the ordinary write — frontmatter preserved, updated
      // bumped, aliases follow a retitle) — but ONLY after the same read gate
      // every AI read passes: Rust's corpus_read_ai refuses secure notes to
      // remote models and knob-denied local ones, and its refusal is final here
      // too. The read also marks the chat's secure taint exactly like read_note.
      let readRevision: string;
      try {
        const read = await corpusReadAiVersioned(id, model);
        readRevision = read.revision;
      } catch (e) {
        return `blocked: ${e instanceof Error ? e.message : String(e)}`;
      }
      // ONE frontmatter read serves the taint marking, the LOCK check, and the
      // secure-context check below (Greptile PR #19: the second fetch doubled
      // the IPC hop on exactly the "edit a private note" path). Unknowable =
      // secure AND locked — fail closed on both axes.
      let frontmatter: Awaited<ReturnType<typeof corpusFrontmatter>> | null = null;
      let frontmatterUnknown = false;
      try {
        frontmatter = await corpusFrontmatter(id);
      } catch {
        frontmatterUnknown = true;
      }
      // LOCKED is an EDIT control that binds EVERY model class — "local" buys
      // visibility, never edit authority (Seth, 2026-08-01). Rust refuses this
      // again inside corpus_write_ai; neither layer trusts the other.
      if (frontmatterUnknown || !frontmatter || frontmatter.locked === true) {
        return frontmatterUnknown || !frontmatter
          ? "blocked: this note's protection state couldn't be read, so it can't be edited."
          : "blocked: this note is locked — no AI may edit it. The user can unlock it from the note's menu.";
      }
      if (opts?.onSecureNoteRead && frontmatter.secure === true) {
        opts.onSecureNoteRead();
      }
      // the create_note taint law's edit twin (PR #4 P1): a chat carrying
      // secure-note content must not launder prose into an OPEN note — it may
      // only edit notes that are THEMSELVES secure. (Re-evaluated AFTER the
      // taint call above, against the same one frontmatter read.)
      if (opts?.isSecureContext?.() === true && frontmatter.secure !== true) {
        return "blocked: this chat carries secure-note content, so it can only edit notes that are themselves secure. Use create_note instead — the new note will be marked secure.";
      }
      // the model reads full file text (fences included) and often echoes the
      // CONTENT crosses (a passed-through fence would duplicate inside the body)
      const content = stripLeadingFrontmatter(body);
      if (!content.trim()) return "error: the new body was only metadata — send the note's full content.";
      try {
        await corpusWriteAi(id, `${content}\n`.replace(/\n+$/, "\n"), model, readRevision);
      } catch (e) {
        return `blocked: ${e instanceof Error ? e.message : String(e)}`;
      }
      await Promise.all([invalidateNotes(), invalidateMemex()]);
      return `updated note ${id} — its content is replaced with your new text. If the note changed after the model read it, Rotli refuses the stale write. Tell the user what you changed.`;
    },
    async openNote(id) {
      usePanesStore.getState().openNote(id);
      return `opened note ${id} in a tab. Tell the user it's on screen.`;
    },
    async searchMemory(query, limit) {
      const queries = [query, ...memoryKeywords(query)].slice(0, 7);
      const noteResults = await Promise.all(
        queries.map((part) => corpusSearchAi(part, limit, true, model).catch(() => [])),
      );
      const readableNoteHits = await aiReadableHits(
        mergeKeywordHits(noteResults).filter((hit) => hit.kind === "note"),
        model,
      );
      const noteHits = readableNoteHits.map((hit) => ({
        id: hit.id,
        title: hit.title,
        snippet: hit.snippet,
        source: "note" as const,
        // the roster marker rides this lane too (2026-08-01) — corpus hits
        // carry the folder, so the area index is identifiable here as well
        ...(isAreaIndex(hit.title, hit.folderId) ? { role: "area-index" as const } : {}),
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
      const result = selected.slice(0, limit);
      await markSecureIds(result.filter((hit) => hit.source === "note").map((hit) => hit.id));
      const protectedChats = new Set(
        documents
          .filter((document) => looksSecret(document.body) || hasSecureContext(document.body))
          .map((document) => `chat:${document.slug}`),
      );
      if (modelIsOnDevice(model) && result.some((hit) => protectedChats.has(hit.id))) {
        opts?.onSecureNoteRead?.();
      }
      return result;
    },
    async readMemory(id) {
      if (!id.startsWith("chat:")) {
        const body = await corpusReadAi(id, model);
        await markSecureIds([id]);
        return body;
      }
      const instance = activeInstance(await loadConfig());
      if (!instance) return "error: no active memory is connected.";
      const body = await readMemexChat(instance, id.slice("chat:".length));
      const protectedContent = looksSecret(body) || hasSecureContext(body);
      if (!modelIsOnDevice(model) && protectedContent) {
        return "blocked: this prior chat contains secure-tainted content and cannot be sent to a remote model.";
      }
      if (protectedContent) opts?.onSecureNoteRead?.();
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
      let text: string;
      if (SHEET_BIN.has(ext)) {
        text = await workbookToCsv({ base64: await corpusFileBytes(file.id) });
      } else if (SHEET_TEXT.has(ext)) {
        text = await workbookToCsv({
          csv: await corpusFileText(file.id),
          delimiter: ext === "tsv" ? "\t" : ",",
        });
      } else if (DOCX_EDITABLE.has(ext)) {
        const { editManagedDocument } = await import("../documents/composition");
        const editable = await editManagedDocument(file.id);
        text = editable.kind === "ready" ? editableDocumentText(editable.document) : "";
        if (!text) return "This document is too large or has no editable text Rotli can give the model.";
      } else {
        text = await corpusFileText(file.id);
      }
      // Storage files carry no frontmatter, so they skip corpus_read_ai's
      // secure gate — apply the same policy prior chats get (audit 2026-07):
      // a remote model never receives secret-shaped file contents.
      if (!modelIsOnDevice(model) && looksSecret(text)) {
        return "blocked: this file contains secret-shaped content and cannot be sent to a remote model.";
      }
      if (modelIsOnDevice(model) && looksSecret(text)) opts?.onSecureNoteRead?.();
      return text;
    },
    webSearch(query, limit) {
      if (opts?.isSecureContext?.() === true) {
        return Promise.reject(
          new Error("This chat carries secure-note content, so web search is disabled for this run."),
        );
      }
      return tauriWebSearch(opts?.webSearchProvider ?? DEFAULT_WEB_SEARCH_PROVIDER, query, limit);
    },
    webFetch(url, maxChars) {
      if (opts?.isSecureContext?.() === true) {
        return Promise.reject(
          new Error("This chat carries secure-note content, so web fetch is disabled for this run."),
        );
      }
      return tauriWebFetch(url, maxChars);
    },
    async generateImage(prompt) {
      // only offered to the loop when the caller wired the chat's assets ctx
      // (imageTool gate) — this branch is the belt-and-suspenders message
      if (!opts?.image) return "error: image generation isn't set up for this chat.";
      if (opts?.isSecureContext?.() === true) {
        return "blocked: this chat carries secure-note content, so remote image generation is disabled for this run.";
      }
      const { root, rootId, slug, engine } = opts.image;
      const rel = await tauriGenerateImage({
        requestId: opts?.requestId ?? crypto.randomUUID(),
        root,
        slug,
        prompt,
        engine,
      });
      generatedImagePaths.push(rel);
      await Promise.all([invalidateNotes(), invalidateMemex()]);
      await opts?.onArtifactCreated?.({
        kind: "file",
        id: qualifiedArtifactId(rootId, rel),
        label: fileName(rel),
      });
      return rel;
    },
    async createArtifact(kind, title, content) {
      if (opts?.isSecureContext?.() === true) {
        return "blocked: this chat carries secure-note content, so it cannot create an unprotected document, sheet, or PDF. Create a secure Markdown note instead.";
      }
      const rootId = opts?.artifactRootId;
      if (!rootId) return "error: file creation isn't set up for this chat.";
      try {
        if (kind === "document") {
          const item = await createManagedDocumentWithContent(title, content, {
            open: false,
            rootId,
          });
          await opts.onArtifactCreated?.({ kind: "file", id: item.id, label: title });
          return `created editable Word document ${item.id}. It is available in this chat's Artifacts and remains closed until the user clicks it.`;
        }
        if (kind === "sheet") {
          const name = artifactFileName(title, "xlsx");
          const item = await createPopulatedManagedItem("sheet", async () => {
            const { createWorkbookFromCsvBase64 } = await import("../sheets/create");
            const base64 = await createWorkbookFromCsvBase64(content, title.slice(0, 31) || "Sheet1");
            return corpusCreateManagedFile(name, base64, rootId);
          });
          await opts.onArtifactCreated?.({ kind: "file", id: item.id, label: title });
          return `created editable sheet ${item.id}. It is available in this chat's Artifacts and remains closed until the user clicks it.`;
        }

        // A PDF is always derived from an editable Markdown source. The source
        // is registered first, so an export failure cannot discard authored text.
        const heading = /^#\s/.test(content) ? "" : `# ${title}\n\n`;
        const sourceId = await createRoutedNote({
          selectedFolderId: "",
          isSmart: true,
          localFallback: "Inbox",
          body: `${heading}${content}\n`.replace(/\n+$/, "\n"),
          rootId,
        });
        await registerPopulatedManagedItem({ id: sourceId, kind: "markdown" });
        await opts.onArtifactCreated?.({
          kind: "note",
          id: sourceId,
          label: `${title} — editable source`,
        });
        const pdfId = await corpusExportNotePdf(sourceId, artifactFileName(title, "pdf"), title);
        await registerPopulatedManagedItem({ id: pdfId, kind: "document" });
        await opts.onArtifactCreated?.({ kind: "file", id: pdfId, label: title });
        return `created PDF copy ${pdfId} and kept editable Markdown source ${sourceId}. Both are available in this chat's Artifacts and remain closed until the user clicks them.`;
      } catch (error) {
        return `error: the work file could not be created — ${error instanceof Error ? error.message : String(error)}`;
      }
    },
    async drawBoard(title, mermaid) {
      // the create_note taint law's BOARD twin: boards are never secure-gated
      // files, so a secure-context chat may not launder its prose into one
      if (opts?.isSecureContext?.() === true) {
        return "blocked: this chat carries secure-note content, and boards are not protected files — put the diagram in a secure note (as a ```mermaid fence) instead.";
      }
      try {
        // mermaid is the wire format on purpose (local models write it far more
        // reliably than raw Excalidraw JSON); the conversion runs entirely local
        const boardId = await createEditableBoardFromMermaid(mermaid, {
          open: false,
          name: title || "Diagram",
          ...(opts?.artifactRootId ? { rootId: opts.artifactRootId } : {}),
        });
        await opts?.onArtifactCreated?.({ kind: "canvas", id: boardId, label: title || "Diagram" });
        await Promise.all([invalidateNotes(), invalidateMemex()]);
        return `created the board${title ? ` "${title}"` : ""} from your diagram. It is available in this chat's Artifacts and remains closed until the user clicks it — a fully editable visual copy.`;
      } catch (e) {
        return `error: the diagram didn't convert — ${e instanceof Error ? e.message : String(e)}. Keep to a simple flowchart (named nodes, arrows, short labels) and try ONCE more; if it fails again, give the user the \`\`\`mermaid fence in your final answer instead.`;
      }
    },
    async knowledgeMap(maxChars) {
      // the map spans the Notes tree AND the brain's memory lanes — a model that
      // can't see identity/ in the map never learns to ask for it (2026-08-01)
      // Titles are knowledge too, so the map rides the GATED listing: `corpus_notes_ai`
      // IS the gate — Rust runs `read_for_ai` per meta (corpus.rs corpus_notes_ai)
      // and drops every entry this model class may not read BEFORE the metas cross
      // the IPC boundary, so a secure note never reaches this list for a frontier
      // model. The old aiReadableHits pass here re-ran `read_for_ai` over the very
      // same ids through `corpus_readable_ids` — pure duplication on THIS path.
      // (The SEARCH lane still probes: it unions folder-name hits the listing gate
      // never saw, so those need their own read check.) (perf audit, 2026-08)
      const readable = await corpusNotesAi(model);
      await markSecureIds(readable.map((note) => note.id));
      return buildModelMap(readable, contextWindowFor(model), maxChars);
    },
  };

  // Token streaming is on-device ONLY: the local generate wire (MLX) speaks
  // Ollama NDJSON. The CLI/OpenAI lanes have their own transports and stay
  // buffered here, so `stream` is present only for a local model — the loop
  // falls back to `complete` for everything else.
  if (model.api === "generate" && endpointIsLocal(model.endpoint)) {
    host.stream = ({ messages, formatJson }) =>
      channelStream((onToken) =>
        chatMessagesStream(messages, onToken, {
          model: model.id,
          endpoint: model.endpoint,
          ...(formatJson !== undefined ? { formatJson } : {}),
          ...(opts?.requestId ? { requestId: opts.requestId } : {}),
        }),
      );
  }

  return host;
}
