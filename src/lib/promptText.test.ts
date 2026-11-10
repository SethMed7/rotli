// The prompt brands at work: what the compiler accepts as a piece of a model
// request, and what it refuses (each `@ts-expect-error` below fails the
// typecheck if that line ever compiles). Runtime: the brands change nothing.
import { describe, expect, test } from "bun:test";

import {
  type ApprovedText,
  type PromptText,
  externalText,
  fixed,
  joinPrompt,
  modelText,
  personText,
  prompt,
  promptJson,
  reshape,
} from "./promptText";
import { approved, person } from "./promptText.fixtures";

/** Text read at runtime: its type is plain `string`. */
const fromANote: string = ["words from", "a note"].join(" ");

describe("what a model request may be built from", () => {
  test("source literals and typed pieces make a PromptText, unchanged at runtime", () => {
    const title = approved("Harbor plan");
    const request: PromptText = prompt`Note: ${title}\nAsked: ${personText("when?")} ${3} ${modelText("ok")} ${externalText("web")}`;
    expect(String(request)).toBe("Note: Harbor plan\nAsked: when? 3 ok web");
    expect(String(joinPrompt([title, person("b")], ", "))).toBe("Harbor plan, b");
    expect(String(promptJson({ id: title, n: 2, tags: [title] }))).toBe(
      '{"id":"Harbor plan","n":2,"tags":["Harbor plan"]}',
    );
    expect(String(fixed("a fixed line"))).toBe("a fixed line");
  });

  test("a reshape keeps the brand and transforms the text it is given", () => {
    const body: ApprovedText = reshape(approved("  the words  "), (text) => text.trim());
    expect(String(body)).toBe("the words");
  });

  test("a string read at runtime is not a piece, and can't be passed off as one", () => {
    // @ts-expect-error a widened string (a note read without the gate) is refused
    const refused = prompt`Note: ${fromANote}`;
    expect(String(refused)).toContain(fromANote); // (the brand is the compiler's; the bytes are the same)
    // @ts-expect-error nor may it be a fixed line
    fixed(fromANote);
    // @ts-expect-error nor a JSON field
    promptJson({ title: fromANote });
    // @ts-expect-error nor a template written around it, nested in the tag
    const nested = prompt`Note: ${`raw ${fromANote}`}`;
    expect(String(nested)).toContain(fromANote);
    // @ts-expect-error or in a JSON field
    promptJson({ title: `raw ${fromANote}` });
    // @ts-expect-error nor ApprovedText: only ai/approvedRead.ts makes that
    const forged: ApprovedText = fromANote;
    expect(forged === fromANote).toBe(true);
  });
});
