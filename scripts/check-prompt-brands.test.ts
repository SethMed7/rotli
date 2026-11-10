import { describe, expect, test } from "bun:test";

import { CONSTRUCTOR_USERS, sourceFailures } from "./check-prompt-brands.mjs";

const root = process.cwd();
const HEAD = `import { type ApprovedText, type PromptText, fixed, prompt, promptJson, reshape } from "../lib/promptText";
declare const raw: string;
declare const cleared: ApprovedText;
declare const note: { body: string };
`;
/** The check's answer for one probe module under src/. */
const check = (body: string, path = "src/probe/probe.ts", head = HEAD) =>
  sourceFailures(root, { [path]: head + body });

// The fourth review's eight bypasses: each compiled and passed the old,
// text-searching check. Each must now be refused.
describe("check:prompt-brands refuses the fourth review's bypasses", () => {
  test.each([
    [
      "fixed with a substitution",
      "export const p: PromptText = fixed(`note: ${raw}`);",
      /fixed takes only a literal/,
    ],
    [
      "prompt called on a hand-built array",
      "export const p: PromptText = prompt(Object.assign([raw], { raw: [raw] }));",
      /template tag/,
    ],
    [
      "JSON.parse assigned to a brand",
      "export const p: PromptText = JSON.parse(raw);",
      /an `any` value becomes PromptText/,
    ],
    [
      "a type guard asserting a brand",
      'export function isPrompt(x: unknown): x is PromptText { return typeof x === "string"; }',
      /type guard asserts/,
    ],
    [
      "a cast through a type alias",
      "type Forged = PromptText;\nexport const p = raw as Forged;",
      /casts to a prompt brand \(PromptText\)/,
    ],
    [
      "a reshape whose change ignores its named text",
      "export const p = reshape(cleared, (_text) => note.body);",
      /ignores its text/,
    ],
  ])("%s", (_name, body, message) => {
    const failures = check(body);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.join("\n")).toMatch(message);
  });

  test("a 22nd module using an open constructor through a namespace import", () => {
    const failures = check(
      "export const t = p.externalText(note.body);\n",
      "src/newThing.ts",
      'import * as p from "./lib/promptText";\ndeclare const note: { body: string };\n',
    );
    expect(failures.join("\n")).toMatch(/namespace import of lib\/promptText/);
    expect(failures.join("\n")).toMatch(
      /uses externalText from lib\/promptText; CONSTRUCTOR_USERS .* lists nothing/,
    );
  });

  test("a 22nd module re-exporting an open constructor", () => {
    const failures = check('export { externalText } from "./lib/promptText";\n', "src/newThing.ts", "");
    expect(failures.join("\n")).toMatch(/re-exports an open constructor/);
  });

  test("a renamed import is still the constructor it names", () => {
    const failures = check(
      "export const t = outside(note.body);\n",
      "src/newThing.ts",
      'import { externalText as outside } from "./lib/promptText";\ndeclare const note: { body: string };\n',
    );
    expect(failures.join("\n")).toMatch(/uses externalText/);
  });

  test("a listed module using a constructor its reason doesn't name", () => {
    expect(CONSTRUCTOR_USERS["src/services/chatAutoTitle.ts"]?.uses).toEqual(["personText"]);
    const failures = check(
      "export const t = externalText(note.body);\n",
      "src/services/chatAutoTitle.ts",
      'import { externalText } from "../lib/promptText";\ndeclare const note: { body: string };\n',
    );
    expect(failures.join("\n")).toMatch(/uses externalText .* lists personText for this module/);
  });
});

describe("check:prompt-brands still allows what the brands are for", () => {
  test("literals, typed pieces, and reshapes that transform their text", () => {
    expect(
      check(
        [
          'export const a: PromptText = fixed("a fixed line");',
          "export const b: PromptText = fixed(`a fixed template`);",
          "export const c: PromptText = prompt`Note: ${cleared}`;",
          "export const d: PromptText = promptJson({ id: cleared, n: 2 });",
          "export const e = reshape(cleared, (text) => text.trim());",
          "export const f = cleared as string;",
          "export const g = [cleared, null].filter((x): x is ApprovedText => x !== null);",
        ].join("\n"),
        // a module CONSTRUCTOR_USERS lists for reshape
        "src/ai/prompt.ts",
      ),
    ).toEqual([]);
  });

  test("the owner makes its own brand", () => {
    expect(
      check(
        "const approve = (text: string): ApprovedText => text as ApprovedText;\nexport const x = approve(raw);\n",
        "src/ai/approvedRead.ts",
        'import type { ApprovedText } from "../lib/promptText";\ndeclare const raw: string;\n',
      ),
    ).toEqual([]);
  });

  test("but never exports it", () => {
    const failures = check(
      "export const approve = (text: string): ApprovedText => text as ApprovedText;\n",
      "src/ai/approvedRead.ts",
      'import type { ApprovedText } from "../lib/promptText";\n',
    );
    expect(failures.join("\n")).toMatch(/exports its ApprovedText constructor/);
  });

  test("test support stays in tests", () => {
    const failures = check(
      "export const t = approved(note.body);\n",
      "src/ai/host.ts",
      'import { approved } from "../lib/promptText.fixtures";\ndeclare const note: { body: string };\n',
    );
    expect(failures.join("\n")).toMatch(/imports test support/);
  });
});
