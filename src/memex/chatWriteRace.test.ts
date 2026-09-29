// 2026-09-29: a chat file is rewritten read-modify-write — each turn appended,
// its note pointers (attachedTo, memoryNote) set — while other writers touch
// the same file (a new chat's model/provider frontmatter). Losing that race
// used to drop the write: the "which format?" question vanished on reload,
// and a chat whose memoryNote pointer never landed minted a fresh memory note
// every turn. A conflict now re-reads and writes again.
//
// `mock.module` is process-wide, so the mock spreads the REAL module and
// afterAll puts it back.

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

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
};

const BASE = "---\nid: c1\ntitle: Plan\nattachedTo: [[my-plan]]\n---\n\n## Messages\n";
let disk = BASE;
let revision = 1;
let writes = 0;
let raceOnce = false;
let failWith: string | null = null;

void mock.module("../lib/tauri", () => ({
  ...realTauri,
  memexReadChat: async () => ({ contents: disk, revision: `r${revision}` }),
  memexWriteChat: async (_root: string, _slug: string, contents: string, expected: string | null) => {
    writes += 1;
    if (failWith) throw new Error(failWith);
    if (raceOnce) {
      raceOnce = false;
      disk = disk.replace("title: Plan\n", "title: Plan\nprovider: claude\n");
      revision += 1;
    }
    if (expected !== `r${revision}`) {
      throw new Error(
        `revision conflict: expected ${expected}, found r${revision}; the file changed after it was opened`,
      );
    }
    disk = contents;
    revision += 1;
    return "/tmp/vault/chats/plan.md";
  },
}));

afterAll(() => {
  void mock.module("../lib/tauri", () => realTauri);
});

const { setChatAttachedTo, setChatMemoryNoteStem, writeChat } = await import("./service");

beforeEach(() => {
  disk = BASE;
  revision = 1;
  writes = 0;
  raceOnce = false;
  failWith = null;
});

describe("chat note pointers survive a concurrent writer", () => {
  test("a memoryNote pointer that loses the race is written again, keeping both edits", async () => {
    raceOnce = true;
    await setChatMemoryNoteStem(INSTANCE, "plan", "plan-chat-notes");
    expect(writes).toBe(2);
    expect(disk).toContain("provider: claude");
    expect(disk).toContain("memoryNote: [[plan-chat-notes]]");
  });

  test("the attachedTo pointer gets the same retry", async () => {
    raceOnce = true;
    await setChatAttachedTo(INSTANCE, "plan", "other-note");
    expect(disk).toContain("provider: claude");
    expect(disk).toContain("attachedTo: [[other-note]]");
  });

  test("a non-conflict failure is not retried", async () => {
    failWith = "disk full";
    await expect(setChatMemoryNoteStem(INSTANCE, "plan", "x")).rejects.toThrow("disk full");
    expect(writes).toBe(1);
  });
});

describe("a chat turn survives a concurrent writer", () => {
  test("a turn that loses the race is appended again, keeping both edits", async () => {
    raceOnce = true;
    await writeChat({
      instance: INSTANCE,
      title: "Plan",
      existingSlug: "plan",
      messages: [{ speaker: "rotli", text: "Which format do you want?", at: "2026-09-29T12:09:28.850Z" }],
    });
    expect(writes).toBe(2);
    expect(disk).toContain("provider: claude");
    expect(disk).toContain("Which format do you want?");
  });
});
