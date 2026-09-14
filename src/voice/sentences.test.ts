// The speakable-text rules. Two things matter and both are asserted here:
// speech must START EARLY (a finished sentence leaves the buffer immediately,
// so playback overlaps generation), and it must never read Markdown furniture
// or code aloud.

import { describe, expect, test } from "bun:test";

import { speakableText, takeSentences } from "./sentences";

describe("speakableText — prose, not markup", () => {
  test("headings, quotes, bullets and checkboxes lose their marks, keep their words", () => {
    expect(speakableText("## Ship it")).toBe("Ship it");
    expect(speakableText("> a quote")).toBe("a quote");
    expect(speakableText("- a bullet")).toBe("a bullet");
    expect(speakableText("  - [ ] a task")).toBe("a task");
    expect(speakableText("  - [ ][x] a failed check")).toBe("a failed check");
    expect(speakableText("2. [x][ ] a passed check")).toBe("a passed check");
    expect(speakableText("- (x) selected option")).toBe("selected option");
    expect(speakableText("3. third")).toBe("third");
    expect(speakableText("b. lettered")).toBe("lettered");
    expect(speakableText("e.g. an example")).toBe("e.g. an example");
  });

  test("a link is read as its label — never the URL", () => {
    expect(speakableText("see [the docs](https://example.com/a/b) now")).toBe("see the docs now");
    expect(speakableText("see [](example.com) now")).toBe("see example.com now");
  });

  test("an image says nothing at all", () => {
    expect(speakableText("![a chart](storage:x.png)")).toBe("");
  });

  test("emphasis and inline code are spoken as their words", () => {
    expect(speakableText("**bold** and `code` and ~~gone~~")).toBe("bold and code and gone");
  });
});

describe("takeSentences — start speaking before the answer finishes", () => {
  test("a completed sentence leaves the buffer; the partial tail waits", () => {
    const { speak, rest } = takeSentences("Hello there. And then I ");
    expect(speak.map((s) => s.text)).toEqual(["Hello there."]);
    expect(rest).toBe("And then I ");
  });

  test("nothing is emitted while the first sentence is still arriving", () => {
    const { speak, rest } = takeSentences("Still writing the firs");
    expect(speak).toEqual([]);
    expect(rest).toBe("Still writing the firs");
  });

  test("several sentences in one delta all come out, in order", () => {
    const { speak } = takeSentences("One. Two! Three? ");
    expect(speak.map((s) => s.text)).toEqual(["One.", "Two!", "Three?"]);
  });

  test("an abbreviation does not cut the sentence short", () => {
    const { speak } = takeSentences("Ask Dr. Sanchez about it. Then go. ");
    expect(speak.map((s) => s.text)).toEqual(["Ask Dr. Sanchez about it.", "Then go."]);
  });

  test("flush speaks a trailing fragment — a reply that stops mid-thought is still read", () => {
    const { speak, rest } = takeSentences("no terminal punctuation here", true);
    expect(speak.map((s) => s.text)).toEqual(["no terminal punctuation here"]);
    expect(rest).toBe("");
  });

  test("a fenced code block is SKIPPED, and prose around it still reads", () => {
    const reply = "Try this. \n```ts\nconst x = 1;\n```\nThat works. ";
    const { speak } = takeSentences(reply, true);
    const said = speak.map((s) => s.text).join(" ");
    expect(said).toContain("Try this.");
    expect(said).toContain("That works.");
    expect(said).not.toContain("const x");
  });

  test("a chunk that is ONLY markup emits nothing to say", () => {
    const { speak } = takeSentences("```\ncode only\n```", true);
    expect(speak).toEqual([]);
  });

  test("streaming deltas accumulate into the same sentences as one whole string", () => {
    const whole = "First one. Second one. Third one. ";
    const streamed: string[] = [];
    let buffer = "";
    for (const ch of whole) {
      buffer += ch;
      const { speak, rest } = takeSentences(buffer);
      streamed.push(...speak.map((s) => s.text));
      buffer = rest;
    }
    expect(streamed).toEqual(takeSentences(whole).speak.map((s) => s.text));
    expect(streamed).toEqual(["First one.", "Second one.", "Third one."]);
  });
});
