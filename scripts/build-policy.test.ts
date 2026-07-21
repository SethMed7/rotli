import { describe, expect, test } from "bun:test";
import { bundleBudgetViolations, shouldIgnoreBuildWarning } from "./build-policy.mjs";

function chunk(fileName: string, sizeKib: number, options: { entry?: boolean; imports?: string[] } = {}) {
  return {
    type: "chunk" as const,
    fileName,
    code: "x".repeat(sizeKib * 1024),
    imports: options.imports ?? [],
    isEntry: options.entry ?? false,
  };
}

describe("production build policy", () => {
  test("suppresses only JSXGraph's guarded JessieCode eval warning", () => {
    expect(
      shouldIgnoreBuildWarning({
        code: "EVAL",
        id: "/repo/node_modules/jsxgraph/src/parser/jessiecode.js",
      }),
    ).toBe(true);
    expect(shouldIgnoreBuildWarning({ code: "EVAL", id: "/repo/src/app.tsx" })).toBe(false);
    expect(
      shouldIgnoreBuildWarning({
        code: "CIRCULAR_DEPENDENCY",
        id: "/repo/node_modules/jsxgraph/src/parser/jessiecode.js",
      }),
    ).toBe(false);
  });

  test("counts static entry dependencies against the startup budget", () => {
    const bundle = {
      "entry.js": chunk("entry.js", 100, { entry: true, imports: ["startup.js"] }),
      "startup.js": chunk("startup.js", 1700),
      "lazy.js": chunk("lazy.js", 1700),
    };
    expect(bundleBudgetViolations(bundle)).toEqual([
      "startup.js: 1700.0 KiB exceeds the startup budget of 1600 KiB",
    ]);
  });

  test("caps optional editor engines with a separate lazy budget", () => {
    const bundle = {
      "entry.js": chunk("entry.js", 100, { entry: true }),
      "editor.js": chunk("editor.js", 3700),
    };
    expect(bundleBudgetViolations(bundle)).toEqual([
      "editor.js: 3700.0 KiB exceeds the lazy budget of 3600 KiB",
    ]);
  });
});
