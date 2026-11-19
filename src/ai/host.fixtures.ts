// The fake vault and the mocked Tauri seam that host.test.ts drives the real
// host against (split out of it, fourth review of pull request 267, to keep
// the test file within its size ratchet). Importing this module installs the
// mock; afterAll puts the real module back. Test support only.

import { afterAll, mock } from "bun:test";

import type { AiBodyEdit } from "../lib/aiEditPolicy";
import * as realTauri from "../lib/tauri";
import type { ChatModelInfo, CorpusNoteMeta, FrontmatterView } from "../lib/tauri";
import { inSecureHome } from "../security/secureNotes";
import type { SearchHit } from "../types";
import type { WebSearchProvider } from "./searchProvider";

/** What the tests change between cases: the vault's rows, and whether the
 * batched permission probe should blow up. */
export const fake: { rows: Row[]; probeThrows: boolean } = { rows: [], probeThrows: false };

export const LOCAL: ChatModelInfo = {
  id: "gemma-3-12b-it-qat-4bit",
  label: "Gemma",
  provider: "mlx",
  endpoint: "http://localhost:11435",
  api: "generate",
  vision: false,
  isDefault: true,
  localDefault: true,
};
export const FRONTIER: ChatModelInfo = {
  ...LOCAL,
  id: "claude-sonnet",
  label: "Claude",
  provider: "claude",
  endpoint: "https://api.anthropic.com",
  api: "cli",
};
export const CODEX: ChatModelInfo = {
  ...FRONTIER,
  id: "gpt-5.6-sol",
  label: "GPT-5.6 Sol",
  provider: "codex",
};

/** The fake vault. `secure` notes are the ones a frontier model may never see;
 * `locked` ones are the ones no model may edit. */
export interface Row {
  id: string;
  title: string;
  body: string;
  folderId: string;
  secure?: boolean;
  locked?: boolean;
  reference?: boolean;
  aiBodyEdit?: AiBodyEdit;
  kind?: "note" | "file";
  /** Only Rust's gate knows it is secure (a secure keyword in its name, a
   * secret-shaped line): no flag, no secure folder. The gate passes it to an
   * on-device model alone, and says so (fourth review). */
  gateOnly?: boolean;
}

export const writes: { id: string; body: string; modelId: string; consented?: boolean }[] = [];
export const webRequests: Array<{
  provider: WebSearchProvider;
  query: string;
  limit: number;
}> = [];
export const cliRequests: Array<Parameters<typeof realTauri.cliComplete>[0]> = [];

const meta = (row: Row): CorpusNoteMeta => ({
  id: row.id,
  title: row.title,
  snippet: row.body.slice(0, 40),
  aliases: [],
  folderId: row.folderId,
  diskFolderId: row.folderId,
  createdAt: 0,
  updatedAt: 0,
  pinned: false,
  origin: null,
  kind: row.kind ?? "note",
});

/** Match Rust's secure-home location rule (parity.json secureHomeCases), as
 * well as the explicit flag. Rust's real gate is proved by
 * ai_note_read_gate_refuses_plain_text_in_secure_homes and
 * ai_file_gate_refuses_secure_home_and_honors_local_knob in cargo tests. */
export const readable = (row: Row, model: ChatModelInfo) =>
  !(row.secure || row.gateOnly || inSecureHome(row.id) || inSecureHome(row.folderId)) ||
  model.provider === "mlx";
/** The gate's mark: passed only because the reader is on-device. */
const onDeviceOnly = (row: Row, model: ChatModelInfo) =>
  model.provider === "mlx" && !readable(row, { ...model, provider: "claude" });
const marked = (row: Row, model: ChatModelInfo) => (onDeviceOnly(row, model) ? { onDeviceOnly: true } : {});

void mock.module("../lib/tauri", () => ({
  ...realTauri,
  corpusList: async () => ({
    folders: [],
    notes: fake.rows.filter((r) => !r.reference).map(meta),
  }),
  corpusNotePath: async (id: string) => {
    const row = fake.rows.find((r) => r.id === id);
    return row ? (id.includes("/") ? id : `${row.folderId}/${id}.md`) : id;
  },
  // The AI lanes are GATED IN RUST since 2026-08-01 (GAP 1): the command
  // itself applies `read_for_ai` per hit, so the fake enforces `readable`
  // here — a secure row never crosses the boundary for a frontier model, with
  // or without a probe call afterwards.
  corpusNotesAi: async (model: ChatModelInfo) =>
    fake.rows.filter((r) => readable(r, model)).map((r) => ({ ...meta(r), ...marked(r, model) })),
  corpusSearchAi: async (
    query: string,
    limit: number | undefined,
    includeReference: boolean,
    model: ChatModelInfo,
  ) => {
    const q = query.toLowerCase();
    return fake.rows
      .filter((r) => (includeReference ? true : !r.reference))
      .filter((r) => readable(r, model))
      .filter((r) => `${r.title} ${r.body}`.toLowerCase().includes(q))
      .slice(0, limit ?? 50)
      .map<SearchHit>((r) => ({
        id: r.id,
        title: r.title,
        folderId: r.folderId,
        kind: "note",
        rank: 1,
        snippet: r.body.slice(0, 40),
        matchStart: 0,
        matchLen: 1,
        spans: [],
        updatedAt: 0,
        ...marked(r, model),
      }));
  },
  corpusReadableIds: async (ids: string[], model: ChatModelInfo) => {
    if (fake.probeThrows) throw new Error("probe worker failed");
    return ids.filter((id) => {
      const row = fake.rows.find((r) => r.id === id);
      return !!row && readable(row, model);
    });
  },
  corpusReadAi: async (id: string, model: ChatModelInfo) => {
    const row = fake.rows.find((r) => r.id === id);
    if (!row) throw new Error(`unknown note: ${id}`);
    if (!readable(row, model)) {
      throw new Error("This note is secure and can never be sent to a remote model.");
    }
    return `---\nid: ${row.id}\n---\n\n${row.body}`;
  },
  corpusReadAiVersioned: async (id: string, model: ChatModelInfo) => {
    const row = fake.rows.find((r) => r.id === id);
    if (!row) throw new Error(`unknown note: ${id}`);
    if (!readable(row, model)) {
      throw new Error("This note is secure and can never be sent to a remote model.");
    }
    return {
      body: `---\nid: ${row.id}\n---\n\n${row.body}`,
      revision: `test:${row.id}:${row.body}`,
      ...marked(row, model),
    };
  },
  corpusFrontmatter: async (id: string): Promise<FrontmatterView | null> => {
    const row = fake.rows.find((r) => r.id === id);
    if (!row) return null;
    return {
      id,
      created: "",
      updated: "",
      locked: !!row.locked,
      secure: !!row.secure,
      localAiAllowed: true,
      pinned: false,
      // these fake.rows default to AI-made; a row names `aiBodyEdit` to say otherwise
      aiBodyEdit: row.locked ? "locked" : (row.aiBodyEdit ?? "allowed"),
      fields: [],
    };
  },
  corpusWriteAi: async (
    id: string,
    body: string,
    model: ChatModelInfo,
    _revision: string,
    consented = false,
  ) => {
    const row = fake.rows.find((r) => r.id === id);
    if (!row) throw new Error(`unknown note: ${id}`);
    // the Rust lane's own refusals, mirrored: read gate, then LOCKED
    if (!readable(row, model)) {
      throw new Error("This note is secure and can never be sent to a remote model.");
    }
    if (row.locked) {
      throw new Error("This note is locked — no AI may edit it. Unlock it from the note's menu first.");
    }
    writes.push({ id, body, modelId: model.id, ...(consented ? { consented } : {}) });
    row.body = body;
    return meta(row);
  },
  cliComplete: async (request: Parameters<typeof realTauri.cliComplete>[0]) => {
    cliRequests.push(request);
    return "frontier reply";
  },
  webSearch: async (provider: WebSearchProvider, query: string, limit: number) => {
    webRequests.push({ provider, query, limit });
    return [
      {
        provider,
        title: "Result",
        url: "https://example.com",
        snippet: "evidence",
      },
    ];
  },
}));

afterAll(() => {
  void mock.module("../lib/tauri", () => realTauri);
});
