import { describe, expect, test } from "bun:test";

import {
  moduleLoadReads,
  namesTheApp,
  productNameFailures,
  rustLiterals,
  scan,
  tsLiterals,
} from "./check-product-name.mjs";

const texts = (found: { text: string }[]) => found.map((item) => item.text);

describe("check:product-name", () => {
  test("words that name the app count; code tokens don't", () => {
    for (const words of [
      "Make Rotli yours.",
      "is removed from Rotli.",
      "Message rotli…",
      "Rotli",
      "read-only for rotli",
    ])
      expect(namesTheApp(words)).toBe(true);
    for (const token of [
      "rotli",
      "rotli://open",
      "rotli:open-request",
      ".rotli/settings.json",
      "rotli-settings",
      "rotli.co",
      "ROTLI_APP_IDENTIFIER",
      "storage/rotli/a.docx",
      "com.rotli.app",
    ])
      expect(namesTheApp(token)).toBe(false);
    // a sentence that only mentions the dot-folder doesn't name the app
    expect(namesTheApp("They’re in .rotli/settings.json inside the vault folder")).toBe(false);
  });

  test("a new string, template part or JSX text naming the app is found", () => {
    const source = [
      'const a = "Rotli saved it";',
      "const b = `${n} files Rotli kept`;",
      "const c = <p>Open Rotli now</p>;",
      'const d = <p title="Search rotli">x</p>;',
    ].join("\n");
    expect(texts(tsLiterals("src/x.tsx", source))).toEqual([
      "Rotli saved it",
      "files Rotli kept",
      "Open Rotli now",
      "Search rotli",
    ]);
  });

  test("routed words, comments, imports, class names and console lines are not", () => {
    const source = [
      "// Rotli does this",
      'import { x } from "./rotli";',
      "const a = `${productName()} saved it`;",
      'const b = <p className="dashboard rotli">x</p>;',
      'console.warn("Rotli warns developers");',
      'type Section = "rotli" | "provider";',
    ].join("\n");
    expect(tsLiterals("src/x.tsx", source)).toEqual([]);
  });

  test("Rust: sentences count; tests, logs and printed lines don't", () => {
    const source = [
      'fn a() -> String { "Rotli opens a file here".into() }',
      'fn b() { eprintln!("Rotli is starting"); }',
      'fn c() -> String { format!("rotli: could not {x}") }',
      "#[cfg(test)]",
      "mod tests {",
      '    fn t() { let _ = "Rotli in a test"; }',
      "}",
      'fn d() -> String { "after the tests, Rotli again".into() }',
    ].join("\n");
    expect(texts(rustLiterals(source))).toEqual(["Rotli opens a file here", "after the tests, Rotli again"]);
  });

  test("an unlisted string fails, a listed one passes, and a stale or uncategorised entry fails", () => {
    const found = { "src/a.tsx": [{ text: "Rotli saved it", line: 3 }] };
    const categories = { "rotli-name": "Rotli's own names" };
    expect(productNameFailures(found, { categories, allowed: {} })[0]).toContain(
      'src/a.tsx:3: "Rotli saved it" names the app outside the host words',
    );
    expect(
      productNameFailures(found, {
        categories,
        allowed: { "src/a.tsx": { "Rotli saved it": "rotli-name" } },
      }),
    ).toEqual([]);
    expect(
      productNameFailures(
        {},
        { categories, allowed: { "src/a.tsx": { "Rotli saved it": "rotli-name" } } },
      )[0],
    ).toContain("is no longer in src/a.tsx");
    expect(
      productNameFailures(found, {
        categories,
        allowed: { "src/a.tsx": { "Rotli saved it": "made-up" } },
      })[0],
    ).toContain('has no category "made-up"');
  });

  test("a read of the host's name as a module loads is found; one inside a function or getter isn't", () => {
    const source = [
      "export const NOTICE = `Main changed outside ${productName()}`;",
      "const LABELS = { managed: `Managed by ${productName()}`, get fine() { return productName(); } };",
      "export const notice = () => `Main changed outside ${productName()}`;",
      "function later() { return inlineName(); }",
      "if (appHost()) document.title = 'x';",
    ].join("\n");
    expect(moduleLoadReads("src/x.ts", source)).toEqual([
      { call: "productName", line: 1 },
      { call: "productName", line: 2 },
      { call: "appHost", line: 5 },
    ]);
  });

  test("the tree passes with its allowlist", async () => {
    const allowlist = await Bun.file("scripts/product-name-allowlist.json").json();
    expect(productNameFailures(scan(process.cwd()), allowlist)).toEqual([]);
  });
});
