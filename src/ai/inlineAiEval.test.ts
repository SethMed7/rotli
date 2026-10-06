// Deterministic offline evals for Ask AI (`/ai`): the exact request a model
// receives, and what Rotli does with canned replies — a chart, a source list,
// a thinking block, a runaway, a failure — plus the secret gate. No model runs.

import { describe, expect, test } from "bun:test";

import { parseChart } from "../editor/chartSpec";
import {
  CURSOR_MARK,
  INLINE_AI_VERSION,
  INLINE_CONTEXT,
  MAX_INSERT_CHARS,
  REPLY_EMPTY,
  REPLY_TOO_LONG,
  askInline,
  mapAnchor,
  renderInlineRequest,
} from "./inlineAi";
import inlinePrompt from "./prompts/inlineAi.md?raw";
import type { CompleteReq } from "./types";

/** A model that always gives `reply` (or fails with it), recording each request. */
function cannedModel(reply: string | Error) {
  const sent: CompleteReq[] = [];
  const complete = async (req: CompleteReq): Promise<string> => {
    sent.push(req);
    if (reply instanceof Error) throw reply;
    return reply;
  };
  return { sent, host: { complete } };
}

/** The body of the first ```chart fence in a text. */
function chartBody(text: string): string | null {
  return /```chart\n([\s\S]*?)\n```/.exec(text)?.[1] ?? null;
}

const CHART_REPLY =
  "```chart\ntype: line\ntitle: Pages read (example)\n\nWeek, Pages\nW1, 40\nW2, 55\nW3, 38\n```";
const SOURCES_REPLY =
  "- *Thinking, Fast and Slow* — Daniel Kahneman, Farrar, Straus and Giroux, 2011\n- *The Shallows* — Nicholas Carr, W. W. Norton, 2010";

describe("the request", () => {
  test("is the versioned asset, the note fenced as data with the cursor marked, then the ask", () => {
    expect(INLINE_AI_VERSION).toBe(2);
    const request = renderInlineRequest(
      "  a chart of my pages  ",
      "# Reading\n\nW1 40, W2 55.\n",
      "\nLater.",
    );
    expect(request.messages).toHaveLength(2);
    expect(request.messages[0]?.role).toBe("system");
    expect(request.messages[0]?.content).toContain("inserted into a person's Markdown note");
    expect(request.messages[1]?.content).toBe(
      `<<<\n# Reading\n\nW1 40, W2 55.\n${CURSOR_MARK}\nLater.\n>>>\n\na chart of my pages`,
    );
  });

  test("reads a bounded window of the note around the cursor", () => {
    const before = `${"a".repeat(INLINE_CONTEXT.before)}NEAR`;
    const after = `FAR${"b".repeat(INLINE_CONTEXT.after)}`;
    const content = renderInlineRequest("x", before, after).messages[1]?.content ?? "";
    expect(content).toContain(`NEAR${CURSOR_MARK}FAR`);
    expect(content.length).toBeLessThan(INLINE_CONTEXT.before + INLINE_CONTEXT.after + 40);
  });

  test("teaches the chart fence exactly as SYNTAX.md reads it", () => {
    const body = chartBody(inlinePrompt);
    expect(body).not.toBeNull();
    expect(parseChart(body ?? "").ok).toBe(true);
  });
});

describe("the reply", () => {
  test("a chart request yields one chart fence that the note can draw", async () => {
    const stub = cannedModel(CHART_REPLY);
    const verdict = await askInline(stub.host, "chart my pages per week", "W1 40, W2 55, W3 38", "");
    expect(verdict).toEqual({ ok: true, text: CHART_REPLY });
    const parsed = parseChart(chartBody(verdict.ok ? verdict.text : "") ?? "");
    expect(parsed.ok && parsed.spec.type).toBe("line");
  });

  test("a sources request yields a list, kept as written", async () => {
    const verdict = await askInline(cannedModel(SOURCES_REPLY).host, "sources on attention", "", "");
    expect(verdict).toEqual({ ok: true, text: SOURCES_REPLY });
  });

  test("a thinking block is never part of the passage", async () => {
    const verdict = await askInline(
      cannedModel(`<think>plan the list</think>\n\n${SOURCES_REPLY}`).host,
      "sources",
      "",
      "",
    );
    expect(verdict).toEqual({ ok: true, text: SOURCES_REPLY });
  });

  test("an empty or runaway answer is refused, with words", async () => {
    expect(await askInline(cannedModel("<think>hm</think>").host, "x", "", "")).toEqual({
      ok: false,
      reason: REPLY_EMPTY,
    });
    expect(await askInline(cannedModel("z".repeat(MAX_INSERT_CHARS + 1)).host, "x", "", "")).toEqual({
      ok: false,
      reason: REPLY_TOO_LONG,
    });
  });

  test("a failed model says so", async () => {
    expect(await askInline(cannedModel(new Error("timed out")).host, "x", "", "")).toEqual({
      ok: false,
      reason: "The model couldn't answer: timed out",
    });
  });
});

describe("what never reaches a model", () => {
  test("secret-shaped text in the request or the note around the cursor", async () => {
    // a test card number (Luhn-valid, never a real account)
    for (const [ask, before] of [
      ["chart my card 4242 4242 4242 4242", ""],
      ["summarise this", "card 4242 4242 4242 4242"],
    ] as const) {
      const stub = cannedModel(SOURCES_REPLY);
      const verdict = await askInline(stub.host, ask, before, "");
      expect(verdict.ok).toBe(false);
      expect(stub.sent).toHaveLength(0);
    }
  });

  test("an empty ask", async () => {
    const stub = cannedModel(SOURCES_REPLY);
    expect(await askInline(stub.host, "   ", "note", "")).toEqual({
      ok: false,
      reason: "Write what you want first.",
    });
    expect(stub.sent).toHaveLength(0);
  });
});

describe("mapAnchor — where Insert lands after the note was edited", () => {
  const before = "# Note\n\nalpha\n\nomega";
  const at = before.indexOf("\nomega");

  test("an edit after the cursor leaves it in place", () => {
    expect(mapAnchor(before, at, `${before} more`)).toBe(at);
  });

  test("an edit above the cursor carries it along", () => {
    const after = before.replace("alpha", "alpha and beta");
    expect(mapAnchor(before, at, after)).toBe(after.indexOf("\nomega"));
  });

  test("an edit across the cursor has no honest answer", () => {
    expect(mapAnchor(before, at, before.replace("alpha\n\nomega", "merged"))).toBeNull();
  });
});
