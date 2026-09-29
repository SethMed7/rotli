// 2026-09-29 regression: a reply that lands while another writer is touching
// the same chat file (a new chat's model/provider frontmatter, its note link)
// hit a revision conflict and was dropped — the question Rotli asked vanished
// on reload. Appending a turn is safe to redo, so a conflict re-reads and
// appends again instead of losing the message.
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

const BASE = `---
id: 2026-09-29-bio
title: Bio
source: rotli
created: 2026-09-29
updated: 2026-09-29
tags: [chat]
---

# Bio


## Messages
**you** · 2026-09-29T12:09:28.786Z — write me a bio
`;

let disk = BASE;
let revision = 1;
let writes = 0;
/** Simulates a concurrent writer landing between our read and our write. */
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
      disk = disk.replace("tags: [chat]\n", "tags: [chat]\nmodel: default\nprovider: claude\n");
      revision += 1;
    }
    if (expected !== `r${revision}`) {
      throw new Error(
        `revision conflict: expected ${expected}, found r${revision}; the file changed after it was opened`,
      );
    }
    disk = contents;
    revision += 1;
    return "/tmp/vault/chats/bio.md";
  },
}));

afterAll(() => {
  void mock.module("../lib/tauri", () => realTauri);
});

const { writeChat } = await import("./service");

beforeEach(() => {
  disk = BASE;
  revision = 1;
  writes = 0;
  raceOnce = false;
  failWith = null;
});

describe("writeChat append", () => {
  test("a turn that loses a revision race is re-appended, keeping both edits", async () => {
    raceOnce = true;
    await writeChat({
      instance: INSTANCE,
      title: "Bio",
      existingSlug: "bio",
      messages: [{ speaker: "rotli", text: "Which format do you want?", at: "2026-09-29T12:09:28.850Z" }],
    });
    expect(writes).toBe(2);
    expect(disk).toContain("provider: claude");
    expect(disk).toContain("Which format do you want?");
  });

  test("a non-conflict failure is not retried", async () => {
    failWith = "disk full";
    await expect(
      writeChat({
        instance: INSTANCE,
        title: "Bio",
        existingSlug: "bio",
        messages: [{ speaker: "rotli", text: "hi" }],
      }),
    ).rejects.toThrow("disk full");
    expect(writes).toBe(1);
  });
});
