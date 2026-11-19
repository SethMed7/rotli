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

import { beforeEach, describe, expect, test } from "bun:test";

import { promptOf } from "../lib/promptText.fixtures";
import { inSecureHome } from "../security/secureNotes";
import {
  CODEX,
  cliRequests,
  fake,
  FRONTIER,
  LOCAL,
  readable,
  type Row,
  webRequests,
  writes,
} from "./host.fixtures";
import { registeredToolSpecs } from "./toolSchemas";
import type { Host } from "./types";

const { makeTauriHost } = await import("./host");

test("the fake Rust read gate classifies secure homes without a flag", () => {
  const row: Row = {
    id: "wiki/_secure/plain.txt",
    title: "Plain",
    body: "ordinary prose",
    folderId: "wiki/_secure",
  };
  expect(readable(row, FRONTIER)).toBe(false);
  expect(readable(row, LOCAL)).toBe(true);
});

/** `updateNote` is optional on the Host port; the Tauri host always wires it,
 * and a missing one is itself a failure worth naming. */
function updateVia(host: Host, id: string, body: string): Promise<string> {
  if (!host.updateNote) throw new Error("the Tauri host must expose update_note");
  return host.updateNote(id, body);
}

beforeEach(() => {
  fake.probeThrows = false;
  writes.length = 0;
  webRequests.length = 0;
  cliRequests.length = 0;
  fake.rows = [
    {
      id: "n-open",
      title: "Kelpie plan",
      body: "an ordinary kelpie note",
      folderId: "Inbox",
    },
    {
      id: "n-secure",
      title: "Kelpie passphrase",
      body: "the kelpie vault passphrase is hunter2",
      folderId: "Secure notes",
      secure: true,
    },
    {
      id: "n-locked",
      title: "Kelpie charter",
      body: "a kelpie charter",
      folderId: "Inbox",
      locked: true,
    },
    {
      id: "n-mine",
      title: "Kelpie diary",
      body: "my own kelpie diary",
      folderId: "Inbox",
      aiBodyEdit: "person-written",
    },
    {
      id: "identity/00-identity.md",
      title: "Identity",
      body: "the maintainer is a kelpie-adjacent quokkanaut",
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

describe("web search provider composition", () => {
  test("uses DuckDuckGo by default and forwards an explicit Brave selection", async () => {
    await makeTauriHost(LOCAL).webSearch("default destination", 4);
    await makeTauriHost(LOCAL, { webSearchProvider: "brave" }).webSearch("chosen destination", 2);
    expect(webRequests).toEqual([
      { provider: "duckduckgo", query: "default destination", limit: 4 },
      { provider: "brave", query: "chosen destination", limit: 2 },
    ]);
  });
});

describe("frontier process controls", () => {
  test("forwards the per-chat effort and tier to the Rust-validated CLI command", async () => {
    await makeTauriHost(CODEX, {
      reasoningEffort: "high",
      serviceTier: "fast",
    }).complete({
      messages: [{ role: "user", content: promptOf("Explain the boundary") }],
    });
    expect(cliRequests).toHaveLength(1);
    expect(cliRequests[0]).toMatchObject({
      provider: "codex",
      reasoningEffort: "high",
      serviceTier: "fast",
    });
  });
});

describe("SECURE is a visibility control against remote", () => {
  test("a frontier run receives no secure hit from search — the open note only", async () => {
    const hits = await makeTauriHost(FRONTIER).searchNotes("kelpie", 10);
    const ids: string[] = hits.map((h) => h.id);
    expect(ids).not.toContain("n-secure");
    expect(ids).toContain("n-open");
    // and nothing in what it got quotes the secure body
    expect(JSON.stringify(hits)).not.toContain("hunter2");
  });

  test("an on-device run receives the same secure hit", async () => {
    const ids: string[] = (await makeTauriHost(LOCAL).searchNotes("kelpie", 10)).map((h) => h.id);
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
    fake.probeThrows = true;
    // SEARCH unions folder-name hits the listing gate never saw, so it probes
    // read_for_ai over the union — a downed probe fails that whole lane closed.
    expect(await makeTauriHost(LOCAL).searchNotes("kelpie", 10)).toEqual([]);
  });

  test("the knowledge map's gate is corpus_notes_ai ALONE — a downed probe cannot leak, nor over-hide", async () => {
    // knowledgeMap no longer runs the redundant corpus_readable_ids probe: its
    // sole gate is corpus_notes_ai, which drops every unreadable meta in Rust.
    // Prove independence by breaking the probe and asserting the map is unchanged:
    // the SECURE title stays out (gated by corpus_notes_ai) and the OPEN note is
    // still present (not fail-closed to empty the way the probe path would be).
    fake.probeThrows = true;
    const map = await makeTauriHost(FRONTIER).knowledgeMap(4000);
    expect(map).not.toContain("Kelpie passphrase"); // secure title — still gated
    expect(map).toContain("Kelpie plan"); // open note — probe state is irrelevant
  });
});

describe("the brain's memory lanes are retrievable by BOTH classes", () => {
  test("search reaches identity/ and personality/ for a frontier and an on-device model", async () => {
    for (const model of [LOCAL, FRONTIER]) {
      const ids: string[] = (await makeTauriHost(model).searchNotes("quokkanaut", 10)).map((h) => h.id);
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

test("read_note and read_memory refuse secret-free paths inside either secure home", async () => {
  for (const id of ["wiki/_secure/plan.csv", "Secure notes/plan.txt"]) {
    fake.rows.push({
      id,
      title: "Plan",
      body: "task,status\nDraft,ready",
      folderId: id.split("/").slice(0, -1).join("/"),
    });
    expect(inSecureHome(id)).toBe(true);
    await expect(makeTauriHost(FRONTIER).readNote(id)).rejects.toThrow(/secure|blocked/i);
    const host = makeTauriHost(FRONTIER);
    if (!host.readMemory) throw new Error("the host must register read_memory");
    await expect(host.readMemory(id)).rejects.toThrow(/secure|blocked/i);
  }
});

test("a local AI edit reading secure-home text taints its chat", async () => {
  const id = "Secure notes/plan.txt";
  fake.rows.push({ id, title: "Plan", body: "task,status\nDraft,ready", folderId: "Secure notes" });
  let tainted = false;
  const host = makeTauriHost(LOCAL, {
    onSecureNoteRead: () => {
      tainted = true;
    },
  });
  await updateVia(host, id, "updated plan");
  expect(tainted).toBe(true);
});

test("every registered vault-content tool refuses secure-home content for a remote model", async () => {
  const registered = registeredToolSpecs().map(({ name }) => name);
  const nonContentTools = [
    "create_note",
    "open_note",
    "web_search",
    "web_fetch",
    "generate_image",
    "create_document",
    "create_artifact",
    "draw_board",
    "ask_user", // a question for the person: reads nothing
  ];
  const contentTools = registered.filter((name) => !nonContentTools.includes(name));
  expect(contentTools).toEqual([
    "search_memory",
    "read_memory",
    "search_notes",
    "read_note",
    "update_note",
    "read_file",
    "edit_document",
  ]);
  fake.rows.push(
    {
      id: "wiki/_secure/plan.csv",
      title: "Plan CSV",
      body: "quokka project status",
      folderId: "wiki/_secure",
      kind: "file",
    },
    {
      id: "Secure notes/plan.txt",
      title: "Plan text",
      body: "quokka project status",
      folderId: "Secure notes",
    },
    {
      id: "wiki/_secure/plan.docx",
      title: "Plan Word",
      body: "quokka project status",
      folderId: "wiki/_secure",
      kind: "file",
    },
  );
  const host = makeTauriHost(FRONTIER);
  if (!host.searchMemory || !host.readMemory) throw new Error("the host must register memory tools");
  const checks: Record<(typeof contentTools)[number], () => Promise<void>> = {
    search_memory: async () => {
      expect(await host.searchMemory!("quokka", 20)).not.toContainEqual(
        expect.objectContaining({ id: "Secure notes/plan.txt" }),
      );
    },
    read_memory: async () => {
      await expect(host.readMemory!("Secure notes/plan.txt")).rejects.toThrow(/secure|blocked/i);
    },
    search_notes: async () => {
      expect(await host.searchNotes("quokka", 20)).not.toContainEqual(
        expect.objectContaining({ id: "Secure notes/plan.txt" }),
      );
    },
    read_note: async () => {
      await expect(host.readNote("Secure notes/plan.txt")).rejects.toThrow(/secure|blocked/i);
    },
    update_note: async () => {
      expect(await updateVia(host, "Secure notes/plan.txt", "changed")).toMatch(/^blocked:/);
      expect(writes).toEqual([]);
    },
    read_file: async () => {
      expect(await host.readFile("wiki/_secure/plan.csv")).toMatch(/^blocked:/);
    },
    edit_document: async () => {
      expect(await host.editDocument?.("wiki/_secure/plan.docx", [])).toMatch(/^blocked:/);
    },
  };
  for (const name of contentTools) await checks[name]!();
});

// 2026-09-29: a note a PERSON wrote is theirs — no class rewrites it without
// their grant, and the refusal says how to grant it
describe("a person's note is closed to AI edits until they grant it", () => {
  test("no class edits a person-written note, and nothing is written", async () => {
    for (const model of [LOCAL, FRONTIER]) {
      const out = await updateVia(makeTauriHost(model), "n-mine", "# Kelpie diary\n\nrewritten");
      expect(out).toMatch(/^blocked: the user wrote this note themselves/);
      expect(out).toContain("Let AI edit the text");
    }
    expect(fake.rows.find((r) => r.id === "n-mine")?.body).toBe("my own kelpie diary");
    expect(writes).toEqual([]);
  });

  test("the chat asks first: no keeps the note, Allow once writes this one edit", async () => {
    const via = (answer: "once" | "no") => makeTauriHost(LOCAL, { confirmEdit: async () => answer });
    expect(await updateVia(via("no"), "n-mine", "# Kelpie diary\n\nnew")).toMatch(/chose to keep this note/);
    expect(writes).toEqual([]);
    expect(await updateVia(via("once"), "n-mine", "# Kelpie diary\n\nnew")).toMatch(/updated/);
    expect(writes.map((w) => w.consented)).toEqual([true]);
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
    expect(fake.rows.find((r) => r.id === "n-locked")?.body).toBe("a kelpie charter");
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
  test("a tainted chat may not create an unprotected Word document", async () => {
    const host = makeTauriHost(LOCAL, { isSecureContext: () => true });
    if (!host.createDocument) throw new Error("the Tauri host must expose create_document");
    const out = await host.createDocument("Private plan", "protected prose");
    expect(out).toMatch(/blocked/);
    expect(out).toMatch(/not protected/i);
  });

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
    const host = makeTauriHost(LOCAL, {
      onSecureNoteRead: () => (tainted = true),
    });
    await host.readNote("n-open");
    expect(tainted).toBe(false);
    await host.readNote("n-secure");
    expect(tainted).toBe(true);
  });

  // Fourth review of pull request 267 (#1): the chat tainted itself only for
  // reads it recognised as secure (a flag, a secure folder). The gate's own
  // mark now taints it on every read path, so a note only the gate knows is
  // secure keeps the chat on-device too.
  test.each([
    ["read_note", (host: Host) => host.readNote("n-gate")],
    ["search_notes", (host: Host) => host.searchNotes("ledger", 5)],
    ["search_memory", (host: Host) => host.searchMemory!("ledger", 5)],
    ["read_memory", (host: Host) => host.readMemory!("n-gate")],
    ["the knowledge map", (host: Host) => host.knowledgeMap(4000)],
  ])("%s taints the chat when the gate passed a note only for an on-device model", async (_path, use) => {
    // only the open note and this one: nothing else could taint the chat
    fake.rows = fake.rows.filter((row) => row.id === "n-open");
    fake.rows.push({
      id: "n-gate",
      title: "Kelpie ledger",
      body: "harbor ledger totals",
      folderId: "Projects",
      gateOnly: true,
    });
    let tainted = false;
    const host = makeTauriHost(LOCAL, { onSecureNoteRead: () => (tainted = true) });
    await use(host);
    expect(tainted).toBe(true);
  });

  // fourth review (#2): a chat attached to a note reads it as its editor just
  // saved it; another version sends nothing of the note
  test("a note read that isn't the editor's saved version is not sent", async () => {
    const host = makeTauriHost(LOCAL, { savedVersion: () => "Still saving. Try again in a moment." });
    const answer = String(await host.readNote("n-open"));
    expect(answer).toBe("error: Still saving. Try again in a moment.");
  });

  test("once a secure read taints a run, even a paraphrased web query is refused", async () => {
    let tainted = false;
    const host = makeTauriHost(LOCAL, {
      onSecureNoteRead: () => (tainted = true),
      isSecureContext: () => tainted,
    });
    await host.readNote("n-secure");

    await expect(host.webSearch("moonriver launch", 3)).rejects.toThrow("secure-note content");
    expect(webRequests).toEqual([]);
  });
});
