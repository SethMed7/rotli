// Chat audit 2026-11-24, D1 and D4, over a fake chats/ folder that keeps the
// Rust write_chat_at rule: a create (no revision) refuses a name that exists,
// an update must present the revision it read.
//
// `mock.module` is process-wide, so the mock spreads the REAL module and
// afterAll puts it back.

import { afterAll, beforeEach, expect, mock, test } from "bun:test";

import * as realTauri from "../lib/tauri";
import type { MemexInstance } from "./config";

const INSTANCE: MemexInstance = {
  id: "vault",
  label: "vault",
  root: "/tmp/vault",
  role: "chat-system",
  memexId: "mx_test",
  mode: "secure",
  perms: "chats+inbox",
  brainEnabled: true,
  layout: "memex",
  inPlace: false,
};

const files = new Map<string, { contents: string; revision: number }>();
let refuseWith: string | null = null;
let writes = 0;

void mock.module("../lib/tauri", () => ({
  ...realTauri,
  memexReadChat: async (_root: string, slug: string) => {
    const file = files.get(slug);
    if (!file) throw new Error(`chat not found: ${slug}`);
    return { contents: file.contents, revision: `r${file.revision}` };
  },
  memexWriteChat: async (_root: string, slug: string, contents: string, expected: string | null) => {
    writes += 1;
    if (refuseWith) throw new Error(refuseWith);
    const file = files.get(slug);
    if (expected === null && file) {
      throw new Error(`chat already exists: ${slug}; choose another title instead of replacing it`);
    }
    if (expected !== null && expected !== `r${file?.revision}`) {
      throw new Error(`revision conflict: expected ${expected}, found r${file?.revision}`);
    }
    files.set(slug, { contents, revision: (file?.revision ?? 0) + 1 });
    return `/tmp/vault/chats/${slug}.md`;
  },
}));

afterAll(() => {
  void mock.module("../lib/tauri", () => realTauri);
});

const { dropStoppedTurn, settleStoppedTurn, withoutTrailingBlockedExchange, writeChat } =
  await import("./service");

beforeEach(() => {
  files.clear();
  refuseWith = null;
  writes = 0;
});

test("D1: a second chat whose title makes the same name is saved under the next free name", async () => {
  const first = await writeChat({
    instance: INSTANCE,
    title: "hi",
    messages: [{ speaker: "you", text: "hi" }],
  });
  const firstBytes = files.get("hi")!.contents;
  const second = await writeChat({
    instance: INSTANCE,
    title: "Hi!",
    messages: [{ speaker: "you", text: "Hi!" }],
  });
  const third = await writeChat({
    instance: INSTANCE,
    title: "hi",
    messages: [{ speaker: "you", text: "again" }],
  });

  expect([first.slug, second.slug, third.slug]).toEqual(["hi", "hi-2", "hi-3"]);
  expect(second.path).toBe("/tmp/vault/chats/hi-2.md");
  expect(files.get("hi")!.contents).toBe(firstBytes);
  const born = files.get("hi-2")!.contents;
  expect(born).toMatch(/^id: \d{4}-\d{2}-\d{2}-hi-2$/m);
  expect(born).toContain("title: Hi!");
  expect(born).toContain("— Hi!");
});

test("D1: a caller-chosen name that is taken moves on too, and stays a valid chat name", async () => {
  const long = "a".repeat(79);
  await writeChat({ instance: INSTANCE, slug: long, title: "A", messages: [] });
  const next = await writeChat({ instance: INSTANCE, slug: long, title: "A", messages: [] });
  expect(next.slug).toBe(`${"a".repeat(78)}-2`.slice(-80));
  expect(next.slug.length).toBeLessThanOrEqual(80);
  expect(next.slug).toMatch(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/);
});

test("D1: any other refusal is reported once, not retried under another name", async () => {
  refuseWith = "This vault is read-only for rotli";
  await expect(
    writeChat({ instance: INSTANCE, title: "hi", messages: [{ speaker: "you", text: "hi" }] }),
  ).rejects.toThrow("read-only");
  expect(writes).toBe(1);
});

const HEAD = "---\ntitle: T\ncreated: 2026-11-24\nupdated: 2026-11-24\n---\n\n# T\n\n## Messages\n\n";
const KEPT = `${HEAD}**you** · 2026-11-24T10:00:00.000Z — hi\n**rotli** · 2026-11-24T10:00:05.000Z — hello\n`;

test("D4: Stop before any reply takes this send's turn off the file, and nothing else", async () => {
  const sent = `${KEPT}**you** · 2026-11-24T10:01:00.000Z — plan my week\n`;
  files.set("t", { contents: sent, revision: 1 });
  await dropStoppedTurn(INSTANCE, "t", { at: "2026-11-24T10:01:00.000Z", text: "plan my week" });
  expect(files.get("t")!.contents).toBe(KEPT);
});

test("D4: a turn-shaped line pasted into the stopped message can't keep it in the file", async () => {
  const text = "from the old chat:\n**you** · 2026-11-24T10:00:30.000Z — what about Friday?";
  files.set("t", { contents: `${KEPT}**you** · 2026-11-24T10:01:00.000Z — ${text}\n`, revision: 1 });
  await dropStoppedTurn(INSTANCE, "t", { at: "2026-11-24T10:01:00.000Z", text });
  expect(files.get("t")!.contents).toBe(KEPT);
});

test("D4: Stop leaves the file alone when anything was written after its turn", async () => {
  const sent = `${KEPT}**you** · 2026-11-24T10:01:00.000Z — plan my week\n**rotli** · 2026-11-24T10:01:04.000Z — Monday\n`;
  files.set("t", { contents: sent, revision: 1 });
  await dropStoppedTurn(INSTANCE, "t", { at: "2026-11-24T10:01:00.000Z", text: "plan my week" });
  expect(files.get("t")!.contents).toBe(sent);
  const edited = `${KEPT}**you** · 2026-11-24T10:01:00.000Z — plan my week, with Friday off\n`;
  files.set("t", { contents: edited, revision: 1 });
  await dropStoppedTurn(INSTANCE, "t", { at: "2026-11-24T10:01:00.000Z", text: "plan my week" });
  expect(files.get("t")!.contents).toBe(edited);
});

test("D4: Stop leaves the file alone when its last turn is not this send's", async () => {
  const sent = `${KEPT}**you** · 2026-11-24T10:01:00.000Z — plan my week\n`;
  files.set("t", { contents: sent, revision: 1 });
  await dropStoppedTurn(INSTANCE, "t", { at: "2026-11-24T10:02:00.000Z", text: "plan my week" });
  expect(files.get("t")!.contents).toBe(sent);
  files.set("t", { contents: KEPT, revision: 1 });
  await dropStoppedTurn(INSTANCE, "t", { at: "2026-11-24T10:00:05.000Z", text: "hello" });
  expect(files.get("t")!.contents).toBe(KEPT);
});

test("D4: a partial answer Stop kept on screen is saved as the reply, with the turn's secure mark", async () => {
  const sent = `${KEPT}**you** · 2026-11-24T10:01:00.000Z — plan my week\n`;
  files.set("t", { contents: sent, revision: 1 });
  await settleStoppedTurn(INSTANCE, "t", {
    userAt: "2026-11-24T10:01:00.000Z",
    userText: "plan my week",
    partial: "Monday: write",
    at: "2026-11-24T10:01:09.000Z",
    secureContext: true,
  });
  const saved = files.get("t")!.contents;
  expect(saved).toContain(
    `${sent}**rotli** · 2026-11-24T10:01:09.000Z — Monday: write\n`.split("---\n\n")[1]!,
  );
  expect(saved).toMatch(/^secureContext: true$/m);
  await settleStoppedTurn(INSTANCE, "t", {
    userAt: "2026-11-24T10:01:00.000Z",
    userText: "plan my week",
    partial: null,
    at: "2026-11-24T10:01:10.000Z",
    secureContext: false,
  });
  expect(files.get("t")!.contents).toBe(saved); // its turn is no longer last: left alone
});

test("a held-back message with a turn-shaped line pasted in comes off whole", () => {
  const blocked = `${KEPT}**you** · 2026-11-24T10:01:00.000Z — from the log:\n**you** · 2026-01-01 — key=abc\n**rotli** · 2026-11-24T10:01:01.000Z — ⚠ Held back: this message has text shaped like a password\n`;
  expect(withoutTrailingBlockedExchange(blocked)).toBe(KEPT);
});
