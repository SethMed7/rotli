// The AI visibility matrix, asserted on the TypeScript layer (2026-08-01 —
// docs/design/ai-visibility-matrix.md). Rust is the authority; this layer must
// produce the SAME verdicts on its own, so these tests drive the real host with
// the corpus bridge mocked and check what the model is actually handed:
//
//   • a frontier-context run never receives a secure title, snippet, or body —
//     not from search, not from the knowledge map, not from a direct read;
//   • the readability probe failing means NOTHING is readable (fail closed);
//   • the brain's memory lanes (identity/, personality/, …) ARE retrievable,
//     for both model classes;
//   • no model of any class edits a LOCKED note;
//   • a secure-tainted chat cannot launder secure prose into an open note.
//
// `mock.module` is process-wide and outlives this file, so every mock spreads
// the REAL module and afterAll puts the real ones back.

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import * as realTauri from "../lib/tauri";
import type { ChatModelInfo, CorpusNoteMeta, FrontmatterView } from "../lib/tauri";
import type { SearchHit } from "../types";
import type { Host } from "./types";

const LOCAL: ChatModelInfo = {
  id: "gemma-3-12b-it-qat-4bit",
  label: "Gemma",
  provider: "mlx",
  endpoint: "http://localhost:11435",
  api: "generate",
  vision: false,
  isDefault: true,
  localDefault: true,
};
const FRONTIER: ChatModelInfo = {
  ...LOCAL,
  id: "claude-sonnet",
  label: "Claude",
  provider: "claude",
  endpoint: "https://api.anthropic.com",
  api: "cli",
};

/** The fake vault. `secure` notes are the ones a frontier model may never see;
 * `locked` ones are the ones no model may edit. */
interface Row {
  id: string;
  title: string;
  body: string;
  folderId: string;
  secure?: boolean;
  locked?: boolean;
  reference?: boolean;
}

let rows: Row[] = [];
/** Set by the test when the batched permission probe should blow up. */
let probeThrows = false;
const writes: { id: string; body: string; modelId: string }[] = [];

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
  kind: "note",
});

/** The ONE policy the fake Rust side enforces — the real `read_for_ai`: a
 * secure note is refused to a remote model, allowed to an on-device one. */
const readable = (row: Row, model: ChatModelInfo) => !row.secure || model.provider === "mlx";

void mock.module("../lib/tauri", () => ({
  ...realTauri,
  corpusList: async () => ({
    folders: [],
    notes: rows.filter((r) => !r.reference).map(meta),
  }),
  corpusReferenceNotes: async () => rows.filter((r) => r.reference).map(meta),
  corpusSearch: async (query: string, limit?: number, includeReference = false) => {
    const q = query.toLowerCase();
    return rows
      .filter((r) => (includeReference ? true : !r.reference))
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
        updatedAt: 0,
      }));
  },
  corpusReadableIds: async (ids: string[], model: ChatModelInfo) => {
    if (probeThrows) throw new Error("probe worker failed");
    return ids.filter((id) => {
      const row = rows.find((r) => r.id === id);
      return !!row && readable(row, model);
    });
  },
  corpusReadAi: async (id: string, model: ChatModelInfo) => {
    const row = rows.find((r) => r.id === id);
    if (!row) throw new Error(`unknown note: ${id}`);
    if (!readable(row, model)) {
      throw new Error("This note is secure and can never be sent to a remote model.");
    }
    return `---\nid: ${row.id}\n---\n\n${row.body}`;
  },
  corpusFrontmatter: async (id: string): Promise<FrontmatterView | null> => {
    const row = rows.find((r) => r.id === id);
    if (!row) return null;
    return {
      id,
      created: "",
      updated: "",
      locked: !!row.locked,
      secure: !!row.secure,
      localAiAllowed: true,
      pinned: false,
      fields: [],
    };
  },
  corpusWriteAi: async (id: string, body: string, model: ChatModelInfo) => {
    const row = rows.find((r) => r.id === id);
    if (!row) throw new Error(`unknown note: ${id}`);
    // the Rust lane's own refusals, mirrored: read gate, then LOCKED
    if (!readable(row, model)) {
      throw new Error("This note is secure and can never be sent to a remote model.");
    }
    if (row.locked) {
      throw new Error("This note is locked — no AI may edit it. Unlock it from the note's menu first.");
    }
    writes.push({ id, body, modelId: model.id });
    row.body = body;
    return meta(row);
  },
}));

afterAll(() => {
  void mock.module("../lib/tauri", () => realTauri);
});

const { makeTauriHost } = await import("./host");

/** `updateNote` is optional on the Host port; the Tauri host always wires it,
 * and a missing one is itself a failure worth naming. */
function updateVia(host: Host, id: string, body: string): Promise<string> {
  if (!host.updateNote) throw new Error("the Tauri host must expose update_note");
  return host.updateNote(id, body);
}

beforeEach(() => {
  probeThrows = false;
  writes.length = 0;
  rows = [
    { id: "n-open", title: "Kelpie plan", body: "an ordinary kelpie note", folderId: "Inbox" },
    {
      id: "n-secure",
      title: "Kelpie passphrase",
      body: "the kelpie vault passphrase is hunter2",
      folderId: "Secure notes",
      secure: true,
    },
    { id: "n-locked", title: "Kelpie charter", body: "a kelpie charter", folderId: "Inbox", locked: true },
    {
      id: "identity/00-identity.md",
      title: "Identity",
      body: "Seth is a kelpie-adjacent quokkanaut",
      folderId: "identity",
      reference: true,
    },
    {
      id: "personality/04-principles.md",
      title: "Principles",
      body: "kelpie principles",
      folderId: "personality",
      reference: true,
    },
  ];
});

describe("SECURE is a visibility control against remote", () => {
  test("a frontier run receives no secure hit from search — the open note only", async () => {
    const hits = await makeTauriHost(FRONTIER).searchNotes("kelpie", 10);
    const ids = hits.map((h) => h.id);
    expect(ids).not.toContain("n-secure");
    expect(ids).toContain("n-open");
    // and nothing in what it got quotes the secure body
    expect(JSON.stringify(hits)).not.toContain("hunter2");
  });

  test("an on-device run receives the same secure hit", async () => {
    const ids = (await makeTauriHost(LOCAL).searchNotes("kelpie", 10)).map((h) => h.id);
    expect(ids).toContain("n-secure");
  });

  test("a frontier run naming the secure note directly is refused, and the refusal quotes nothing", async () => {
    const read = makeTauriHost(FRONTIER).readNote("n-secure");
    await expect(read).rejects.toThrow(/secure/i);
    await expect(read).rejects.not.toThrow(/hunter2/);
    // the SAME id reads on-device — the refusal is about the model class
    expect(await makeTauriHost(LOCAL).readNote("n-secure")).toContain("hunter2");
  });

  test("the knowledge map hides secure titles from a frontier run and keeps them on-device", async () => {
    expect(await makeTauriHost(FRONTIER).knowledgeMap(4000)).not.toContain("Kelpie passphrase");
    expect(await makeTauriHost(LOCAL).knowledgeMap(4000)).toContain("Kelpie passphrase");
  });

  test("a failed permission probe means NOTHING is readable — fail closed, never open", async () => {
    probeThrows = true;
    expect(await makeTauriHost(LOCAL).searchNotes("kelpie", 10)).toEqual([]);
    expect(await makeTauriHost(FRONTIER).knowledgeMap(4000)).not.toContain("Kelpie");
  });
});

describe("the brain's memory lanes are retrievable by BOTH classes", () => {
  test("search reaches identity/ and personality/ for a frontier and an on-device model", async () => {
    for (const model of [LOCAL, FRONTIER]) {
      const ids = (await makeTauriHost(model).searchNotes("quokkanaut", 10)).map((h) => h.id);
      expect(ids).toContain("identity/00-identity.md");
    }
  });

  test("the knowledge map lists them for both classes", async () => {
    for (const model of [LOCAL, FRONTIER]) {
      const map = await makeTauriHost(model).knowledgeMap(4000);
      expect(map).toContain("Identity");
      expect(map).toContain("Principles");
    }
  });

  test("read_note opens a reference note by its path id", async () => {
    expect(await makeTauriHost(FRONTIER).readNote("identity/00-identity.md")).toContain("quokkanaut");
  });
});

describe("LOCKED is an edit control that binds every class", () => {
  test("every class READS a locked note", async () => {
    for (const model of [LOCAL, FRONTIER]) {
      expect(await makeTauriHost(model).readNote("n-locked")).toContain("charter");
    }
  });

  test("no class EDITS a locked note, and the body is untouched", async () => {
    for (const model of [LOCAL, FRONTIER]) {
      const out = await updateVia(makeTauriHost(model), "n-locked", "# Kelpie charter\n\nrewritten");
      expect(out).toMatch(/blocked/);
      expect(out).toMatch(/locked/);
    }
    expect(rows.find((r) => r.id === "n-locked")?.body).toBe("a kelpie charter");
    expect(writes).toEqual([]);
  });

  test("an unlocked note edits through the AI write lane, carrying the model identity", async () => {
    const out = await updateVia(makeTauriHost(LOCAL), "n-open", "# Kelpie plan\n\nnew body");
    expect(out).toMatch(/updated/);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.modelId).toBe(LOCAL.id);
    expect(writes[0]?.body).not.toContain("---");
  });

  test("an unreadable protection state refuses the edit rather than guessing", async () => {
    const out = await updateVia(makeTauriHost(LOCAL), "n-missing", "# x\n\nbody");
    expect(out).toMatch(/blocked/);
    expect(writes).toEqual([]);
  });
});

describe("secure content flows only into secure containers", () => {
  test("a tainted chat may not edit an OPEN note", async () => {
    const host = makeTauriHost(LOCAL, { isSecureContext: () => true });
    const out = await updateVia(host, "n-open", "# Kelpie plan\n\nthe passphrase is hunter2");
    expect(out).toMatch(/blocked/);
    expect(out).toMatch(/secure/);
    expect(writes).toEqual([]);
  });

  test("a tainted chat MAY edit a note that is itself secure", async () => {
    const host = makeTauriHost(LOCAL, { isSecureContext: () => true });
    expect(await updateVia(host, "n-secure", "# Kelpie passphrase\n\nrotated")).toMatch(/updated/);
    expect(writes).toHaveLength(1);
  });

  test("reading a secure note taints the chat", async () => {
    let tainted = false;
    const host = makeTauriHost(LOCAL, { onSecureNoteRead: () => (tainted = true) });
    await host.readNote("n-open");
    expect(tainted).toBe(false);
    await host.readNote("n-secure");
    expect(tainted).toBe(true);
  });
});
