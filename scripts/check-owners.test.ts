import { describe, expect, test } from "bun:test";

import { ownerFailures } from "./check-owners.mjs";

const check = (path: string, text: string) => ownerFailures({ [path]: text });

describe("check:owners refuses each class the sixth review found", () => {
  test.each([
    [
      "a buffer replaced outside the owner",
      "src/editor/saveQueue.ts",
      "const docs = new Map();\nexport function recover(id: string, lines: string[]) { docs.set(id, lines); }",
      /replaced outside buffers.ts/,
    ],
    [
      "a buffer replaced inside buffers.ts but not by adopt/seed/edit",
      "src/editor/buffers.ts",
      "const docs = new Map();\nexport function sneak(id: string) { docs.set(id, []); }",
      /replaced outside buffers.ts/,
    ],
    [
      "a note declared saved outside adopt",
      "src/editor/buffers.ts",
      'import { recordSaved } from "./saveGenerations";\nexport function landed(id: string) { recordSaved(id); }',
      /declared saved outside/,
    ],
    [
      "the generation ledger's writers imported elsewhere",
      "src/editor/saveQueue.ts",
      'import { recordSaved } from "./saveGenerations";\nexport const x = recordSaved;',
      /only buffers.ts moves a note's generations/,
    ],
    [
      "a writer asking the conversation whether it is marked",
      "src/editor/librarianSession.ts",
      'import { markedConversation } from "./librarianKeep";\nexport const y = markedConversation("c");',
      /asks the conversation/,
    ],
    [
      "settlement reading the conversation's mark",
      "src/editor/librarianKeep.ts",
      "declare const chat: { onDeviceOnly?: boolean };\nexport const z = chat.onDeviceOnly;",
      /goes by the turn's `protection`/,
    ],
    [
      "the chat surface writing by its live mark",
      "src/components/chat/chatSurface.tsx",
      "declare const secureReadRef: { current: boolean };\nexport const write = { secureContext: secureReadRef.current };",
      /use the turn's captured `turnMark`/,
    ],
    [
      "a hand-written frontmatter regex",
      "src/memex/contract.ts",
      "export const fm = (s: string) => /^---\\n([\\s\\S]*?)\\n---/.exec(s);",
      /hand-written frontmatter match/,
    ],
    [
      "an LF-only fence searched as text",
      "src/services/folderNotes.ts",
      'export const lock = (s: string) => s.replace("\\n---\\n", "\\nlocked: true\\n---\\n");',
      /LF-only text/,
    ],
  ])("%s", (_name, path, text, message) => {
    expect(check(path, text).join("\n")).toMatch(message);
  });
});

describe("check:owners allows what the owners are for", () => {
  test("the owner's own functions, the turn's protection, and the shared parser", () => {
    expect(
      check(
        "src/editor/buffers.ts",
        [
          'import { recordSaved } from "./saveGenerations";',
          "const docs = new Map<string, string[]>();",
          "export function seed(id: string) { docs.set(id, []); recordSaved(id); }",
          "export function edit(id: string, lines: string[]) { docs.set(id, lines); }",
          "export function adopt(id: string, lines: string[]) { docs.set(id, lines); recordSaved(id); }",
        ].join("\n"),
      ),
    ).toEqual([]);
    expect(
      check(
        "src/editor/librarianKeep.ts",
        "declare const protection: { onDeviceOnly: boolean };\nexport const ok = protection.onDeviceOnly;",
      ),
    ).toEqual([]);
    expect(
      check(
        "src/components/chat/chatSurface.tsx",
        "declare const secureReadRef: { current: boolean };\nconst attachedSecure = secureReadRef.current;\nsecureReadRef.current = true;\nexport { attachedSecure };",
      ),
    ).toEqual([]);
    expect(
      check(
        "src/lib/frontmatterBlock.ts",
        "export const BLOCK = /^(\\uFEFF?)---(\\r?\\n)([\\s\\S]*?)\\r?\\n---/;",
      ),
    ).toEqual([]);
    // a horizontal rule inserted into a note is not a frontmatter match
    expect(check("src/editor/slashActions.ts", 'export const insert = "---\\n\\n";')).toEqual([]);
  });
});
