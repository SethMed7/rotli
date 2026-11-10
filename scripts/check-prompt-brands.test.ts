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

// The fifth review's probes: each compiled and passed the fourth round's check.
describe("check:prompt-brands refuses the fifth review's bypasses", () => {
  test.each([
    [
      "`any` satisfies a brand",
      "export const p = JSON.parse(raw) satisfies PromptText;",
      /`satisfies` claims a prompt brand/,
    ],
    [
      "an `as const` object with `any` spread into promptJson",
      "const loose: any = JSON.parse(raw);\nconst base = { a: 1 } as const;\nexport const p: PromptText = promptJson({ ...base, loose });",
      /promptJson's value holds an `any`/,
    ],
    [
      "an `any` four objects deep in a promptJson value",
      "export const p: PromptText = promptJson({ a: { b: { c: { d: JSON.parse(raw) } } } });",
      /promptJson's value holds an `any`/,
    ],
    [
      "an `any` behind a recursive type in a promptJson value",
      "interface Tree { kids: Tree[]; leaf: any }\ndeclare const tree: Tree;\nexport const p: PromptText = promptJson({ tree });",
      /promptJson's value holds an `any`/,
    ],
    [
      "a brand-typed default parameter from `any`",
      "export function f(p: PromptText = JSON.parse(raw)) { return p; }",
      /an `any` value becomes PromptText/,
    ],
    [
      "an overload claiming a branded return",
      "export function f(v: string): PromptText;\nexport function f(v: string): any { return v; }",
      /an overload claims a prompt brand/,
    ],
    [
      "@ts-expect-error on a plain-string assignment",
      "// @ts-expect-error -- forged\nexport const p: PromptText = raw;",
      /type-check suppression/,
    ],
    // spelled in two halves: the code-shape check refuses the directive itself
    [
      "the ignore directive",
      `// @ts-${"ignore"}\nexport const p: PromptText = raw;`,
      /type-check suppression/,
    ],
  ])("%s", (_name, body, message) => {
    const failures = check(body);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.join("\n")).toMatch(message);
  });

  test("a declaration file under src/ naming a brand", () => {
    const failures = check(
      "export declare const forged: PromptText;\n",
      "src/probe/forged.d.ts",
      'import type { PromptText } from "../lib/promptText";\n',
    );
    expect(failures.join("\n")).toMatch(/a declaration file names a prompt brand/);
  });

  test("a declaration file without a brand is fine", () => {
    expect(check("export declare const plain: string;\n", "src/probe/plain.d.ts", "")).toEqual([]);
  });

  test("plain JavaScript under src/", () => {
    expect(check("export const p = 1;\n", "src/probe/forged.js", "").join("\n")).toMatch(
      /JavaScript under src\/ isn't type-checked/,
    );
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
