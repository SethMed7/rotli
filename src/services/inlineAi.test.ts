import { describe, expect, test } from "bun:test";

import type { AiBodyEdit } from "../lib/aiEditPolicy";
import type { FrontmatterView } from "../lib/tauri";
import { type InlineAiDeps, askAtCursor, insertAtCursor } from "./inlineAi";

const MODEL = { id: "gemma-local", endpoint: "http://127.0.0.1:11435" };
// the caret sits on the empty line the cleared `/ai` left behind
const DOC = "# Plan\n\nFirst.\n\nLast.";
const AT = DOC.indexOf("\nLast.");

function deps(over: { verdict?: AiBodyEdit; body?: string; readError?: string; revisions?: string[] } = {}) {
  const calls: string[] = [];
  const revisions = [...(over.revisions ?? ["r1"])];
  const inserted: { body: string; text: string; revision: string }[] = [];
  const adopted: { body: string; revision: string }[] = [];
  const d: InlineAiDeps = {
    flush: async () => {
      calls.push("flush");
    },
    frontmatter: async () => {
      calls.push("frontmatter");
      return {
        aiBodyEdit: over.verdict ?? "person-written",
        locked: over.verdict === "locked",
      } as FrontmatterView;
    },
    read: async () => {
      calls.push("read");
      if (over.readError) throw new Error(over.readError);
      return {
        body: `---\nid: n\n---\n\n${over.body ?? DOC}`,
        editor: over.body ?? DOC,
        revision: revisions.shift() ?? "r-last",
      };
    },
    insert: async (_id, body, text, _model, revision) => {
      calls.push("insert");
      inserted.push({ body, text, revision });
      return { revision: "r-after" };
    },
    adopt: (_id, body, revision) => {
      adopted.push({ body, revision });
    },
  };
  return { d, calls, inserted, adopted };
}

function host(reply = "Middle.") {
  const sent: string[] = [];
  return {
    sent,
    host: {
      complete: async (req: { messages: { content: string }[] }) => {
        sent.push(req.messages[1]?.content ?? "");
        return reply;
      },
    },
  };
}

describe("asking — the gates before any model runs", () => {
  test("a person-written note may ask; the model sees the gated read around the cursor", async () => {
    const { d, calls } = deps();
    const h = host();
    expect(await askAtCursor(d, h.host, MODEL, "n", "a middle line", DOC, AT)).toEqual({
      ok: true,
      text: "Middle.",
    });
    expect(calls).toEqual(["frontmatter", "flush", "read"]);
    expect(h.sent[0]).toContain("First.\n⟦here⟧\nLast.");
  });

  for (const verdict of ["locked", "revoked"] as const) {
    test(`a ${verdict} note refuses before the model is called`, async () => {
      const { d, calls } = deps({ verdict });
      const h = host();
      const answer = await askAtCursor(d, h.host, MODEL, "n", "x", DOC, AT);
      expect(answer.ok).toBe(false);
      expect(h.sent).toHaveLength(0);
      expect(calls).toEqual(["frontmatter"]);
    });
  }

  test("the read gate's refusal (a secure note, a remote model) stops it, in the gate's words", async () => {
    const { d } = deps({ readError: "This note is secure — remote models never see it." });
    const h = host();
    expect(await askAtCursor(d, h.host, MODEL, "n", "x", DOC, AT)).toEqual({
      ok: false,
      reason: "This note is secure — remote models never see it.",
    });
    expect(h.sent).toHaveLength(0);
  });

  test("a note still saving is not guessed at", async () => {
    const { d } = deps({ body: `${DOC} (older)` });
    const h = host();
    expect(await askAtCursor(d, h.host, MODEL, "n", "x", DOC, AT)).toMatchObject({ ok: false });
    expect(h.sent).toHaveLength(0);
  });
});

describe("inserting — the person's choice, written through the AI lane", () => {
  test("writes exactly the passage at the cursor with the FRESH revision, then shows it", async () => {
    // the revision moved between Ask and Insert (a Librarian metadata write)
    const { d, inserted, adopted, calls } = deps({ revisions: ["r-fresh"] });
    expect(await insertAtCursor(d, MODEL, "n", "Middle.", DOC, AT)).toEqual({ ok: true });
    expect(calls).toEqual(["frontmatter", "flush", "read", "insert"]);
    expect(inserted).toEqual([
      { body: "# Plan\n\nFirst.\nMiddle.\nLast.", text: "Middle.", revision: "r-fresh" },
    ]);
    expect(adopted).toEqual([{ body: "# Plan\n\nFirst.\nMiddle.\nLast.", revision: "r-after" }]);
  });

  test("a note locked since the answer arrived refuses, and nothing is written", async () => {
    const { d, inserted } = deps({ verdict: "locked" });
    expect((await insertAtCursor(d, MODEL, "n", "x", DOC, AT)).ok).toBe(false);
    expect(inserted).toHaveLength(0);
  });

  test("Rust's refusal comes back as the reason, and the editor is left alone", async () => {
    const { d, adopted } = deps();
    d.insert = async () => {
      throw new Error("The note changed while the answer was ready, so it wasn't inserted. Try again.");
    };
    expect(await insertAtCursor(d, MODEL, "n", "x", DOC, AT)).toEqual({
      ok: false,
      reason: "The note changed while the answer was ready, so it wasn't inserted. Try again.",
    });
    expect(adopted).toHaveLength(0);
  });
});
