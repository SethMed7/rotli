import { describe, expect, test } from "bun:test";

import { brandFailures } from "./check-prompt-brands.mjs";

const file = (path: string, source: string) => ({ path, source });
const failuresOf = (path: string, source: string) =>
  brandFailures([file(path, source)]).filter(
    (failure) => !failure.includes("CONSTRUCTOR_IMPORTERS but gone"),
  );

describe("check:prompt-brands", () => {
  // the ways a note's text could be made to look approved without the read
  test.each([
    ["a plain cast", "const t = note.body as ApprovedText;"],
    ["a double cast", "const t = note.body as unknown as PromptText;"],
    ["a row cast", "const rows = listed as Approved<CorpusNoteMeta>[];"],
    ["a type argument", 'const t = await invoke<ApprovedText>("corpus_read", { id });'],
    ["a person cast", "const t = body as PersonText;"],
  ])("%s outside the owners fails", (_name, line) => {
    const failures = failuresOf("src/ai/host.ts", `${line}\n`);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("src/ai/host.ts:1");
  });

  test("the owners may make their own brands, and only those", () => {
    expect(failuresOf("src/lib/promptText.ts", "return out as PromptText;\n")).toEqual([]);
    expect(
      failuresOf("src/ai/approvedRead.ts", "const approve = (t: string) => t as ApprovedText;\n"),
    ).toEqual([]);
    expect(failuresOf("src/ai/approvedRead.ts", "const p = t as PromptText;\n")).toHaveLength(1);
  });

  test("a generic's declaration is not a forgery", () => {
    expect(failuresOf("src/ai/tools.ts", "function truncate<T extends PromptPart>(text: T): T {\n")).toEqual(
      [],
    );
  });

  test("an open constructor is importable only by a named module", () => {
    const source = 'import { personText } from "../lib/promptText";\n';
    expect(failuresOf("src/editor/librarianBar.tsx", source)).toEqual([]);
    const failures = failuresOf("src/services/notes.ts", source);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("personText");
    // the safe builders stay free to import
    expect(
      failuresOf("src/services/notes.ts", 'import { fixed, prompt } from "../lib/promptText";\n'),
    ).toEqual([]);
  });

  test("a reshape that ignores its text fails", () => {
    expect(failuresOf("src/ai/loop.ts", "result = reshape(result, () => other);\n")).toHaveLength(1);
    expect(failuresOf("src/ai/loop.ts", "result = reshape(result, (text) => text.trim());\n")).toEqual([]);
  });

  test("approvedRead never exports its constructor", () => {
    expect(
      failuresOf("src/ai/approvedRead.ts", "export const approve = (t: string) => t as ApprovedText;\n"),
    ).toHaveLength(1);
  });

  test("the test constructors stay in tests", () => {
    const source = 'import { approved } from "../lib/promptText.fixtures";\nconst t = approved(x);\n';
    expect(failuresOf("src/ai/host.ts", source)).toHaveLength(1);
    expect(failuresOf("src/ai/host.test.ts", source)).toEqual([]);
  });

  test("comments are not code", () => {
    expect(failuresOf("src/ai/host.ts", "// never write `body as ApprovedText`\n")).toEqual([]);
  });
});
