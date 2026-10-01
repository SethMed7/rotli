// The main webview's half of the agent bridge, through the REAL handler and
// edit path with the document composition mocked: what an agent reads, the
// revision its edit must name, and every refusal the app keeps.
//
// `mock.module` is process-wide and outlives this file, so each mock spreads
// the real module and afterAll puts the real ones back.

import { afterAll, beforeEach, expect, mock, test } from "bun:test";

import * as realDocuments from "../documents/composition";
import type { EditableDocument } from "../documents/model";
import { registerLiveDocument, unregisterLiveDocument } from "../documents/session";
import * as realNewItems from "../newItems/composition";
import { answerAgentRequest } from "./agentRequests";

const FILE = "storage/rotli/launch.docx";
const plan = (text: string): EditableDocument => ({
  id: FILE,
  title: "launch",
  content: [{ kind: "paragraph", paragraph: { runs: [{ text }] } }],
});

let disk = plan("Ship it");
let revision = "r1";
const created: { title: string; agent?: string | undefined }[] = [];

const session = async () => ({
  kind: "ready" as const,
  document: disk,
  warnings: [],
  revision,
  save: async (next: EditableDocument) => {
    disk = next;
    revision = `r${Number(revision.slice(1)) + 1}`;
    return revision;
  },
});

void mock.module("../documents/composition", () => ({
  ...realDocuments,
  editManagedDocument: session,
  editAiDocument: session,
}));
void mock.module("../newItems/composition", () => ({
  ...realNewItems,
  createManagedDocumentWithContent: async (title: string, _body: string, options: { agent?: string }) => {
    created.push({ title, agent: options.agent });
    disk = plan(title);
    return { id: FILE, kind: "document" };
  },
}));

afterAll(() => {
  void mock.module("../documents/composition", () => realDocuments);
  void mock.module("../newItems/composition", () => realNewItems);
});

beforeEach(() => {
  disk = plan("Ship it");
  revision = "r1";
  created.length = 0;
});

const ask = (tool: string, args: Record<string, unknown>) =>
  answerAgentRequest({ requestId: 1, tool, args, agent: "Claude Code" });

test("an agent reads numbered blocks and the revision its edit must name", async () => {
  expect(await ask("read_document", { file: FILE })).toEqual({
    ok: true,
    result: { file: FILE, title: "launch", revision: "r1", blocks: "[1] paragraph: Ship it", warnings: [] },
  });
});

test("an edit applies over the revision read, and a newer file refuses it", async () => {
  const actions = [{ op: "replace", block: 1, text: "Ship it [today](https://rotli.co)" }];
  const saved = await ask("apply_document", { file: FILE, expectedRevision: "r1", actions });
  expect(saved).toMatchObject({
    ok: true,
    result: { revision: "r2", blocks: "[1] paragraph: Ship it [today](https://rotli.co)" },
  });
  // the same edit again names a revision the file has moved past
  expect(await ask("apply_document", { file: FILE, expectedRevision: "r1", actions })).toEqual({
    ok: false,
    error: "error: the document changed since it was read. Read it again, then edit.",
  });
});

test("the app's refusals reach the agent, and nothing is changed", async () => {
  const replace = [{ op: "replace", block: 1, text: "x" }];
  expect(await ask("apply_document", { file: FILE, actions: replace })).toMatchObject({ ok: false });
  expect(
    await ask("apply_document", {
      file: FILE,
      expectedRevision: "r1",
      actions: [{ op: "explode", block: 1 }],
    }),
  ).toMatchObject({ ok: false, error: expect.stringContaining("action 1") });
  expect(
    await ask("apply_document", {
      file: FILE,
      expectedRevision: "r1",
      actions: [{ op: "delete", block: 9 }],
    }),
  ).toMatchObject({ ok: false, error: expect.stringContaining("no block 9") });
  expect(await ask("read_document", { file: "storage/rotli/notes.md" })).toMatchObject({ ok: false });
  expect(await ask("delete_vault", {})).toMatchObject({ ok: false });
  // a document open in a pane saves on its own: the edit waits
  registerLiveDocument({ fileId: FILE } as Parameters<typeof registerLiveDocument>[0]);
  try {
    expect(
      await ask("apply_document", { file: FILE, expectedRevision: "r1", actions: replace }),
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("open in a pane"),
    });
  } finally {
    unregisterLiveDocument(FILE);
  }
  expect(disk).toEqual(plan("Ship it"));
});

test("an agent's new document is recorded as its own, and never carries a secret", async () => {
  expect(await ask("create_document", { title: "Launch", body: "Ship it" })).toMatchObject({
    ok: true,
    result: { file: FILE, revision: "r1" },
  });
  expect(created).toEqual([{ title: "Launch", agent: "Claude Code" }]);
  expect(await ask("create_document", { title: "  " })).toMatchObject({ ok: false });
  expect(
    await ask("create_document", {
      title: "Keys",
      body: "-----BEGIN RSA PRIVATE KEY-----",
    }),
  ).toMatchObject({ ok: false, error: expect.stringContaining("blocked") });
  expect(created).toHaveLength(1);
});
