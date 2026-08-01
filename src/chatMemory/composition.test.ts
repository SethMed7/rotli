// The per-turn conversation-note sync is an AI WRITE, so it obeys the same
// matrix as every other one: no model of any class edits a LOCKED note, and an
// unreadable protection state refuses rather than guesses
// (docs/design/ai-visibility-matrix.md, 2026-08-01).
//
// `mock.module` is process-wide and outlives this file, so the mock spreads the
// REAL module and afterAll puts it back.

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import * as realTauri from "../lib/tauri";
import type { FrontmatterView } from "../lib/tauri";

const MODEL = { id: "gemma-3-12b-it-qat-4bit", endpoint: "http://localhost:11435" };

let locked = false;
/** null ⇒ the protection state can't be read at all. */
let frontmatterReadable = true;
const writes: { id: string; body: string; modelId: string; endpoint: string }[] = [];

void mock.module("../lib/tauri", () => ({
  ...realTauri,
  corpusFrontmatter: async (id: string): Promise<FrontmatterView | null> =>
    frontmatterReadable
      ? {
          id,
          created: "",
          updated: "",
          locked,
          secure: false,
          localAiAllowed: true,
          pinned: false,
          fields: [],
        }
      : null,
  corpusWriteAi: async (id: string, body: string, model: { id: string; endpoint: string }) => {
    if (locked) {
      throw new Error("This note is locked — no AI may edit it. Unlock it from the note's menu first.");
    }
    writes.push({ id, body, modelId: model.id, endpoint: model.endpoint });
    return null as never;
  },
}));

afterAll(() => {
  void mock.module("../lib/tauri", () => realTauri);
});

const { updateNoteAsAi } = await import("./composition");

beforeEach(() => {
  locked = false;
  frontmatterReadable = true;
  writes.length = 0;
});

describe("chat-memory sync obeys the AI write matrix", () => {
  test("an unlocked note is rewritten through the AI lane, carrying the model identity", async () => {
    await updateNoteAsAi("n-1", "# Conversation\n\nnew body", MODEL);
    expect(writes).toEqual([
      { id: "n-1", body: "# Conversation\n\nnew body", modelId: MODEL.id, endpoint: MODEL.endpoint },
    ]);
  });

  test("a LOCKED note is refused before any write is attempted", async () => {
    locked = true;
    await expect(updateNoteAsAi("n-1", "# Conversation\n\nnew body", MODEL)).rejects.toThrow(/locked/i);
    expect(writes).toEqual([]);
  });

  test("an unreadable protection state refuses rather than guessing", async () => {
    frontmatterReadable = false;
    await expect(updateNoteAsAi("n-1", "body", MODEL)).rejects.toThrow(/protection state/i);
    expect(writes).toEqual([]);
  });

  test("no model given ⇒ the write is treated as REMOTE (the fail-closed direction)", async () => {
    await updateNoteAsAi("n-1", "body");
    expect(writes[0]?.endpoint).toBe("");
  });
});
