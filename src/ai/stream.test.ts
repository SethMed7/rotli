import { describe, expect, test as it } from "bun:test";

import { channelStream, makeFinalExtractor } from "./stream";

/** Feed a whole reply through the extractor in arbitrary chunk sizes and return
 * the concatenated emitted text + the final mode/finalText. */
function run(reply: string, chunk: number, proseIsFinal = false) {
  const ex = makeFinalExtractor(proseIsFinal);
  let out = "";
  for (let i = 0; i < reply.length; i += chunk) {
    out += ex.push(reply.slice(i, i + chunk));
  }
  return { out, mode: ex.mode, finalText: ex.finalText };
}

describe("makeFinalExtractor — final answers", () => {
  it("streams the final value, skipping the thought", () => {
    const reply = '{"thought":"let me answer","final":"Hello, world!"}';
    for (const chunk of [1, 2, 3, 7, 999]) {
      const r = run(reply, chunk);
      expect(r.mode).toBe("final");
      expect(r.out).toBe("Hello, world!");
      expect(r.finalText).toBe("Hello, world!");
    }
  });

  it("does NOT match `final` appearing inside the thought text", () => {
    const reply = '{"thought":"my final thought is this","final":"real answer"}';
    for (const chunk of [1, 4, 999]) {
      const r = run(reply, chunk);
      expect(r.out).toBe("real answer");
      expect(r.finalText).toBe("real answer");
    }
  });

  it("handles a lone final key", () => {
    const r = run('{"final":"just this"}', 1);
    expect(r.mode).toBe("final");
    expect(r.out).toBe("just this");
  });

  it("decodes escapes (newlines, quotes) even split across chunks", () => {
    const reply = '{"final":"line1\\nline2 \\"q\\" end"}';
    for (const chunk of [1, 2, 5, 999]) {
      const r = run(reply, chunk);
      expect(r.out).toBe('line1\nline2 "q" end');
    }
  });

  it("decodes a unicode escape split across chunks", () => {
    const reply = '{"final":"caf\\u00e9"}';
    for (const chunk of [1, 2, 3, 999]) {
      expect(run(reply, chunk).out).toBe("café");
    }
  });

  it("streams final even when it precedes thought", () => {
    const r = run('{"final":"answer first","thought":"after"}', 1);
    expect(r.out).toBe("answer first");
    expect(r.finalText).toBe("answer first");
  });

  it("strips a leading ```json fence", () => {
    const reply = '```json\n{"final":"fenced"}\n```';
    for (const chunk of [1, 3, 999]) {
      expect(run(reply, chunk).out).toBe("fenced");
    }
  });
});

describe("makeFinalExtractor — tool calls surface nothing", () => {
  it("emits nothing for a tool call and reports tool mode", () => {
    const reply = '{"thought":"search it","tool":"search_notes","args":{"query":"camino"}}';
    for (const chunk of [1, 2, 6, 999]) {
      const r = run(reply, chunk);
      expect(r.out).toBe("");
      expect(r.mode).toBe("tool");
    }
  });

  it("skips a nested args object without emitting", () => {
    const reply = '{"tool":"read_note","args":{"id":"x","nested":{"a":1,"b":[1,2]}}}';
    const r = run(reply, 1);
    expect(r.out).toBe("");
    expect(r.mode).toBe("tool");
  });
});

describe("makeFinalExtractor — prose mode (force-final)", () => {
  it("streams bare prose verbatim", () => {
    const reply = "Your family: Marisol, Diego, and Lucia.";
    for (const chunk of [1, 4, 999]) {
      const r = run(reply, chunk, true);
      expect(r.mode).toBe("final");
      expect(r.out).toBe(reply);
      expect(r.finalText).toBe(reply);
    }
  });

  it("still extracts a JSON final if the model wraps it", () => {
    const r = run('{"final":"wrapped answer"}', 2, true);
    expect(r.out).toBe("wrapped answer");
  });

  it("does not lead with whitespace-only content as prose prematurely", () => {
    const r = run('   \n  {"final":"x"}', 1, true);
    expect(r.out).toBe("x");
    expect(r.mode).toBe("final");
  });
});

describe("makeFinalExtractor — non-JSON in strict mode surfaces nothing", () => {
  it("classifies stray prose as other and emits nothing", () => {
    const r = run("just some prose, no json", 3, false);
    expect(r.out).toBe("");
    expect(r.mode).toBe("other");
  });
});

describe("channelStream", () => {
  it("yields tokens in order and returns the full text", async () => {
    const gen = channelStream(async (onToken) => {
      onToken("a");
      await Promise.resolve();
      onToken("b");
      onToken("c");
      return "abc";
    });
    const seen: string[] = [];
    let ret = "";
    for (;;) {
      const r = await gen.next();
      if (r.done) {
        ret = r.value;
        break;
      }
      seen.push(r.value);
    }
    expect(seen.join("")).toBe("abc");
    expect(ret).toBe("abc");
  });

  it("propagates the start error", async () => {
    const gen = channelStream(async () => {
      throw new Error("boom");
    });
    await expect(
      (async () => {
        for (;;) {
          const r = await gen.next();
          if (r.done) return r.value;
        }
      })(),
    ).rejects.toThrow("boom");
  });
});
