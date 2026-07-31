import { describe, expect, test } from "bun:test";
import { bundleBudgetViolations, shouldIgnoreBuildWarning, shouldStubLazyLocale } from "./build-policy.mjs";

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

describe("lazy locale stubbing (perf audit finding 17)", () => {
  const univer = "/repo/node_modules/@univerjs/engine-render/lib/es/index.js";
  const excalidraw = "/repo/node_modules/@excalidraw/excalidraw/dist/prod/index.js";

  test("stubs Univer hyphenation dictionaries but keeps English and index", () => {
    expect(shouldStubLazyLocale("./hu-DVk7Y_ka.js", univer)).toBe(true);
    expect(shouldStubLazyLocale("./de-1901-CWoAOigE.js", univer)).toBe(true);
    expect(shouldStubLazyLocale("./en-gb-B7Al27b_.js", univer)).toBe(false);
    expect(shouldStubLazyLocale("./index.js", univer)).toBe(false);
  });

  test("stubs Excalidraw locale chunks but keeps English", () => {
    expect(shouldStubLazyLocale("./locales/ar-SA-G6X2FPQ2.js", excalidraw)).toBe(true);
    expect(shouldStubLazyLocale("./locales/zh-CN-ABCDEFGH.js", excalidraw)).toBe(true);
    expect(shouldStubLazyLocale("./locales/en-B4ZKOASM.js", excalidraw)).toBe(false);
  });

  test("never stubs outside the two vendor loader tables", () => {
    expect(shouldStubLazyLocale("./hu-DVk7Y_ka.js", "/repo/src/main.tsx")).toBe(false);
    expect(shouldStubLazyLocale("./locales/ar-SA-G6X2FPQ2.js", undefined)).toBe(false);
    expect(shouldStubLazyLocale("./chunk-SRAX5OIU.js", excalidraw)).toBe(false);
  });
});
