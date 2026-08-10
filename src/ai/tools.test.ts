// statusFor — the live per-step label the chat surface shows. Enriching it with
// the call's own argument is what makes a multi-step research answer show LIFE
// ("searching the web for 'frontier ai'…") instead of one long generic
// "thinking". The argument is model-supplied + untrusted, so it is clipped to a
// short single line and never carries markup.

import { describe, expect, test } from "bun:test";

import { statusFor } from "./tools";

describe("statusFor — enriched, safe live labels", () => {
  test("bare tool (no args) keeps the generic label", () => {
    expect(statusFor("search_notes")).toBe("searching your notes…");
    expect(statusFor("web_search")).toBe("searching the web…");
    expect(statusFor("research_web")).toBe("researching the web…");
    expect(statusFor("read_note")).toBe("reading a note…");
  });

  test("a query is woven into the search label", () => {
    expect(statusFor("search_notes", { query: "camino" })).toBe("searching your notes for “camino”…");
    expect(statusFor("web_search", { query: "frontier ai" })).toBe("searching the web for “frontier ai”…");
    expect(statusFor("research_web", { query: "frontier ai" })).toBe(
      "researching the web for “frontier ai”…",
    );
    expect(statusFor("search_memory", { query: "decisions" })).toBe("searching your memory for “decisions”…");
  });

  test("web_fetch shows the bare host, not the whole URL", () => {
    expect(statusFor("web_fetch", { url: "https://www.pacingthefrontier.com/letter" })).toBe(
      "reading pacingthefrontier.com…",
    );
    // a non-http(s) or unparseable url falls back to the generic label
    expect(statusFor("web_fetch", { url: "not a url" })).toBe("reading a web page…");
  });

  test("read_file names the file", () => {
    expect(statusFor("read_file", { query: "report.csv" })).toBe("reading “report.csv”…");
  });

  test("an untrusted argument is clipped to one short line (no newlines, no runaway length)", () => {
    const nasty = "line one\nline two\t" + "x".repeat(200);
    const label = statusFor("search_notes", { query: nasty });
    expect(label).not.toContain("\n");
    expect(label).not.toContain("\t");
    // clipped well under the raw length, and ellipsised
    expect(label.length).toBeLessThan(80);
    expect(label).toContain("…");
  });

  test("a non-string argument is ignored, not stringified into the label", () => {
    // the model sometimes nests args ({"query":{"text":"x"}}) — that must not
    // reach the label as "[object Object]"
    expect(statusFor("search_notes", { query: { text: "x" } as unknown as string })).toBe(
      "searching your notes…",
    );
  });
});
