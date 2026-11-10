// The rotli/Tauri-backed Host — the ONLY place the engine touches the app. It wires
// the abstract tools to real commands: the model bridge (chat_messages), corpus
// retrieval (the memex knowledge base), and the web primitives. Everything above this
// file is host-agnostic and liftable into the shared ~/.memex/ai client layer.

import { createEditableBoardFromMermaid } from "../boards/composition";
import { memoryKeywords, mergeKeywordHits } from "../chatMemory/retrieval";
import { documentImageFromBase64 } from "../documents/images";
import type { DocumentImage } from "../documents/model";
import { extOf, fileName } from "../lib/fileKind";
import { corpusSetAiEdit } from "../lib/noteProtection";
import { externalText, fixed, modelText, prompt } from "../lib/promptText";
import {
  type ChatModelInfo,
  chatMessages,
  chatMessagesStream,
  corpusFileBytesAi,
  corpusFrontmatter,
  corpusCreateManagedFile,
  corpusExportNotePdf,
  corpusWriteAi,
  webFetch as tauriWebFetch,
  webSearch as tauriWebSearch,
} from "../lib/tauri";
import { activeInstance } from "../memex/config";
import { loadConfig } from "../memex/service";
import { invalidateMemex } from "../memex/useMemex";
import {
  createManagedDocumentWithContent,
  createPopulatedManagedItem,
  registerPopulatedManagedItem,
} from "../newItems/composition";
import { inSecureHome } from "../security/secureNotes";
import { createRoutedNote } from "../services/createNote";
import { invalidateNotes } from "../services/hooks";
import { usePanesStore } from "../state/panes";
import {
  approvedChat,
  approvedChatMemories,
  approvedKnowledgeMap,
  approvedNote,
  approvedNoteRows,
  approvedSearch,
} from "./approvedRead";
import { artifactFileName } from "./artifacts";
import { contextWindowFor } from "./budget";
import { askToEdit, type EditAnswer, type EditRequest, UNREADABLE_PROTECTION } from "./editGate";
import { endpointIsLocal, modelIsOnDevice } from "./guard";
import { aiFileAccessById, makeFileTools } from "./hostFiles";
import { aiReadableHits, assertAiNoteLocation, noteLocationIsProtected } from "./hostReadGate";
import { completeOnCli } from "./hostRemote";
import { normalizeGeneratedImageLinks } from "./imageLinks";
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
import type { Host } from "./types";

/** An error's words for the model: Rotli's own refusal text, never a note. */
const errorText = (e: unknown) => externalText(e instanceof Error ? e.message : String(e));

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
    consent?: string[]; // the person's own messages sent anyway (ai/remoteBlock.ts)
    confirmEdit?: (request: EditRequest) => Promise<EditAnswer>; // ai/editGate.ts askToEdit
    reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
    serviceTier?: "standard" | "fast";
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
  const files = makeFileTools(model, opts ?? {});
  const markSecureIds = async (ids: readonly string[]): Promise<void> => {
    if (!opts?.onSecureNoteRead || !modelIsOnDevice(model) || ids.length === 0) return;
    for (const id of new Set(ids)) {
      try {
        if (await noteLocationIsProtected(id)) {
          opts.onSecureNoteRead();
          return;
        }
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
      // the connected lanes (ai/hostRemote.ts)
      if (model.api === "cli") return completeOnCli(model, messages, opts);
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
          approvedSearch(query, limit, true, model),
          wantsFolders ? approvedNoteRows(model) : Promise.resolve([]),
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
        const ranked = rankNotes(await approvedNoteRows(model), query, limit);
        const result = await aiReadableHits(ranked, model);
        await markSecureIds(result.map((hit) => hit.id));
        return result;
      }
    },
    async readNote(id) {
      // Rust verifies model id + provider registration + loopback endpoint.
      // A localhost proxy for a frontier provider therefore remains remote.
      const protectedLocation = await assertAiNoteLocation(id, model);
      const { text } = await approvedNote(id, model);
      if (protectedLocation) opts?.onSecureNoteRead?.();
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
        createdBy: "chat",
        ...(opts?.artifactRootId ? { rootId: opts.artifactRootId } : {}),
        ...(secure ? { secure: true } : {}),
      });
      await Promise.all([invalidateNotes(), invalidateMemex()]);
      // like every new note, it lands in Main too: under this chat's folder
      await opts?.onArtifactCreated?.({ kind: "note", id, label: title || "Note" });
      return prompt`created ${secure ? "SECURE " : ""}note ${externalText(id)}${title ? prompt` ("${modelText(title)}")` : prompt``} in the intake and in Main${
        secure ? " (marked secure because this chat carries secure-note content)" : ""
      } — tell the user it's there, and offer open_note to show it.`;
    },
    async createDocument(title, body) {
      // DOCX files do not carry note-level secure/locked metadata. Refuse a
      // tainted write instead of laundering protected prose into an open file.
      if (opts?.isSecureContext?.() === true) {
        return fixed(
          "blocked: this chat carries secure-note content, and Word documents are not protected note files. Create a secure Markdown note instead.",
        );
      }
      const documentTitle = title.trim() || "Document";
      let images: DocumentImage[] = [];
      try {
        images = await Promise.all(
          generatedImagePaths.map(async (path, index) => {
            const refusal = await aiFileAccessById(path, modelIsOnDevice(model));
            if (refusal) throw new Error(refusal);
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
            const base64 = await corpusFileBytesAi(path, model, 24 * 1024 * 1024);
            if (!base64) throw new Error(`generated image is unavailable: ${path}`);
            return documentImageFromBase64(`generated-image-${index + 1}`, fileName(path), mimeType, base64);
          }),
        );
      } catch (error) {
        return prompt`error: the generated image could not be embedded safely — ${errorText(error)}. The Word document was not created.`;
      }
      const item = await createManagedDocumentWithContent(documentTitle, body, {
        open: false,
        byAi: true,
        ...(images.length ? { images } : {}),
        ...(opts?.artifactRootId ? { rootId: opts.artifactRootId } : {}),
      });
      await opts?.onArtifactCreated?.({ kind: "file", id: item.id, label: documentTitle });
      return prompt`created editable Word document ${externalText(item.id)} ("${modelText(documentTitle)}")${images.length ? prompt` with ${images.length} embedded image${images.length === 1 ? "" : "s"}` : prompt``}. It is available in this chat's Artifacts and remains closed until the user clicks it. This is a real .docx file, not a Markdown note.`;
    },
    async updateNote(id, body) {
      // EDIT rides the AI write lane (corpus_write_ai: the read gate, then the
      // LOCKED refusal, then the ordinary write — frontmatter preserved, updated
      // bumped, aliases follow a retitle) — but ONLY after the same read gate
      // every AI read passes: Rust's corpus_read_ai refuses secure notes to
      // remote models and knob-denied local ones, and its refusal is final here
      // too. The read also marks the chat's secure taint exactly like read_note.
      let readRevision: string;
      let readTitle = "this note";
      let protectedLocation: boolean;
      try {
        protectedLocation = await assertAiNoteLocation(id, model);
        const read = await approvedNote(id, model);
        readRevision = read.revision;
        readTitle = read.title || readTitle;
      } catch (e) {
        return prompt`blocked: ${errorText(e)}`;
      }
      // ONE frontmatter read serves the taint marking, the LOCK check, and the
      // secure-context check below (Greptile PR #19: the second fetch doubled
      // the IPC hop on exactly the "edit a private note" path). Unknowable =
      // secure AND locked — fail closed on both axes.
      const frontmatter = await corpusFrontmatter(id).catch(() => null);
      // unreadable, LOCKED, or a person's note without a grant: a person's
      // note asks them first (editGate.ts askToEdit)
      const gate = await askToEdit(frontmatter, { id, title: readTitle }, opts?.confirmEdit, (note) =>
        corpusSetAiEdit(note, true),
      );
      if (gate.block || !frontmatter) return prompt`${externalText(gate.block ?? UNREADABLE_PROTECTION)}`;
      if (opts?.onSecureNoteRead && (frontmatter.secure === true || protectedLocation)) {
        opts.onSecureNoteRead();
      }
      // the create_note taint law's edit twin (PR #4 P1): a chat carrying
      // secure-note content must not launder prose into an OPEN note — it may
      // only edit notes that are THEMSELVES secure. (Re-evaluated AFTER the
      // taint call above, against the same one frontmatter read.)
      if (opts?.isSecureContext?.() === true && frontmatter.secure !== true && !protectedLocation) {
        return fixed(
          "blocked: this chat carries secure-note content, so it can only edit notes that are themselves secure. Use create_note instead — the new note will be marked secure.",
        );
      }
      // the model reads full file text (fences included) and often echoes the
      // CONTENT crosses (a passed-through fence would duplicate inside the body)
      const content = stripLeadingFrontmatter(body);
      if (!content.trim())
        return fixed("error: the new body was only metadata — send the note's full content.");
      try {
        await corpusWriteAi(id, `${content}\n`.replace(/\n+$/, "\n"), model, readRevision, gate.consented);
      } catch (e) {
        return prompt`blocked: ${errorText(e)}`;
      }
      await Promise.all([invalidateNotes(), invalidateMemex()]);
      return prompt`updated note ${modelText(id)} — its content is replaced with your new text. If the note changed after the model read it, Rotli refuses the stale write. Tell the user what you changed.`;
    },
    async openNote(id) {
      usePanesStore.getState().openNote(id);
      return prompt`opened note ${modelText(id)} in a tab. Tell the user it's on screen.`;
    },
    async searchMemory(query, limit) {
      const queries = [query, ...memoryKeywords(query)].slice(0, 7);
      const noteResults = await Promise.all(
        queries.map((part) => approvedSearch(part, limit, true, model).catch(() => [])),
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
      // A remote model never receives a secret-shaped chat, nor one whose
      // secureContext marker says a secure note fed its transcript
      // (approvedRead.ts). The provider's Rust egress detector is the final
      // backstop on send.
      const { hits: chatHits, protectedIds } = await approvedChatMemories(instance, model, query, limit);
      const chatQuota = Math.ceil(limit / 2);
      const selected = [...chatHits.slice(0, chatQuota), ...noteHits.slice(0, limit - chatQuota)];
      if (selected.length < limit) {
        selected.push(...chatHits.slice(chatQuota, chatQuota + limit - selected.length));
        selected.push(...noteHits.slice(limit - chatQuota, limit - chatQuota + limit - selected.length));
      }
      const result = selected.slice(0, limit);
      await markSecureIds(result.filter((hit) => hit.source === "note").map((hit) => hit.id));
      if (modelIsOnDevice(model) && result.some((hit) => protectedIds.has(hit.id))) {
        opts?.onSecureNoteRead?.();
      }
      return result;
    },
    async readMemory(id) {
      if (!id.startsWith("chat:")) {
        await assertAiNoteLocation(id, model);
        const { text } = await approvedNote(id, model);
        await markSecureIds([id]);
        return text;
      }
      const instance = activeInstance(await loadConfig());
      if (!instance) return fixed("error: no active memory is connected.");
      const chat = await approvedChat(instance, id.slice("chat:".length), model);
      if (!chat) {
        return fixed(
          "blocked: this prior chat contains secure-tainted content and cannot be sent to a remote model.",
        );
      }
      if (chat.secure) opts?.onSecureNoteRead?.();
      return chat.text;
    },
    readFile: files.readFile,
    editDocument: files.editDocument,
    webSearch(query, limit) {
      if (opts?.isSecureContext?.() === true) {
        return Promise.reject(
          new Error("This chat carries secure-note content, so web search is disabled for this run."),
        );
      }
      return tauriWebSearch(opts?.webSearchProvider ?? DEFAULT_WEB_SEARCH_PROVIDER, query, limit).then(
        (hits) =>
          hits.map((hit) => ({
            provider: hit.provider,
            title: externalText(hit.title),
            url: externalText(hit.url),
            snippet: externalText(hit.snippet),
          })),
      );
    },
    webFetch(url, maxChars) {
      if (opts?.isSecureContext?.() === true) {
        return Promise.reject(
          new Error("This chat carries secure-note content, so web fetch is disabled for this run."),
        );
      }
      return tauriWebFetch(url, maxChars).then(externalText);
    },
    async generateImage(_prompt) {
      return fixed("error: provider-backed image generation is unavailable; no provider account was used.");
    },
    async createArtifact(kind, title, content) {
      if (opts?.isSecureContext?.() === true) {
        return fixed(
          "blocked: this chat carries secure-note content, so it cannot create an unprotected document, sheet, or PDF. Create a secure Markdown note instead.",
        );
      }
      const rootId = opts?.artifactRootId;
      if (!rootId) return fixed("error: file creation isn't set up for this chat.");
      try {
        if (kind === "document") {
          const item = await createManagedDocumentWithContent(title, content, {
            open: false,
            rootId,
          });
          await opts.onArtifactCreated?.({ kind: "file", id: item.id, label: title });
          return prompt`created editable Word document ${externalText(item.id)}. It is available in this chat's Artifacts and remains closed until the user clicks it.`;
        }
        if (kind === "sheet") {
          const name = artifactFileName(title, "xlsx");
          const item = await createPopulatedManagedItem("sheet", async () => {
            const { createWorkbookFromCsvBase64 } = await import("../sheets/create");
            const base64 = await createWorkbookFromCsvBase64(content, title.slice(0, 31) || "Sheet1");
            return corpusCreateManagedFile(name, base64, rootId);
          });
          await opts.onArtifactCreated?.({ kind: "file", id: item.id, label: title });
          return prompt`created editable sheet ${externalText(item.id)}. It is available in this chat's Artifacts and remains closed until the user clicks it.`;
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
          createdBy: "chat",
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
        return prompt`created PDF copy ${externalText(pdfId)} and kept editable Markdown source ${externalText(sourceId)}. Both are available in this chat's Artifacts and remain closed until the user clicks them.`;
      } catch (error) {
        return prompt`error: the work file could not be created — ${errorText(error)}`;
      }
    },
    async drawBoard(title, mermaid) {
      // the create_note taint law's BOARD twin: boards are never secure-gated
      // files, so a secure-context chat may not launder its prose into one
      if (opts?.isSecureContext?.() === true) {
        return fixed(
          "blocked: this chat carries secure-note content, and boards are not protected files — put the diagram in a secure note (as a ```mermaid fence) instead.",
        );
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
        return prompt`created the board${title ? prompt` "${modelText(title)}"` : prompt``} from your diagram. It is available in this chat's Artifacts and remains closed until the user clicks it — a fully editable visual copy.`;
      } catch (e) {
        return prompt`error: the diagram didn't convert — ${errorText(e)}. Keep to a simple flowchart (named nodes, arrows, short labels) and try ONCE more; if it fails again, give the user the \`\`\`mermaid fence in your final answer instead.`;
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
      const { map, ids } = await approvedKnowledgeMap(
        model,
        contextWindowFor(model),
        maxChars,
        (note) =>
          modelIsOnDevice(model) ||
          ![note.id, note.folderId, note.diskFolderId].some((path) => path && inSecureHome(path)),
      );
      await markSecureIds(ids);
      return prompt`${map}`;
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
