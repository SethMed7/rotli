import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

// Wired into `bun run lint` (Batch 2 commit 3 of the Stage-3 remediation plan).
// Scoped to src/**/*.{ts,tsx} only — scripts/ and src-tauri/ are untouched.
// breve-runtime/scripts/**/*.ts was measured (plan 2.5; re-measured 2026-07-17)
// at 76 findings against this same rule set minus react-hooks (71 no-explicit-any,
// 4 no-floating-promises, 1 no-misused-promises)
// — over the 15-site adoption threshold, so it is DEFERRED, not silently skipped;
// the count + rationale are recorded in CONTRIBUTING.md's lint paragraph.
//
// no-misused-promises measured at 4 real sites (plan 2.2, threshold 10) — adopted.
//
// package.json pins "typescript": "~5.8.3" deliberately — typescript-eslint 8.x
// (this package) crashes on TS 7. Do not bump the typescript devDependency past
// that range without re-validating typescript-eslint compatibility first. (A
// comment can't live inline in package.json: scripts/check-structure.mjs and
// scripts/check-documentation.mjs both JSON.parse it directly.)
export default tseslint.config(
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: { allowDefaultProject: [] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { "@typescript-eslint": tseslint.plugin, "react-hooks": reactHooks },
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-explicit-any": "error",
      // Identifier casing, measured before adoption (2026-07-18): a one-off run of
      // exactly this config found 5 hits in all of src, every one a leading-underscore
      // discard or the dunder build global — i.e. the codebase already satisfies it.
      // This locks in an existing invariant; it is not a restyling campaign.
      "@typescript-eslint/naming-convention": [
        "error",
        // Vite `define`-injected build globals (declare const __APP_VERSION__ —
        // vite.config.ts) use the conventional dunder shape; exempt by shape.
        { selector: "variable", filter: { regex: "^__[A-Z0-9_]+__$", match: true }, format: null },
        { selector: "variable", format: ["camelCase", "UPPER_CASE", "PascalCase"], leadingUnderscore: "allow" },
        { selector: "typeLike", format: ["PascalCase"] },
        { selector: "interface", format: ["PascalCase"], custom: { regex: "^I[A-Z]", match: false } },
      ],
      // bun:test exposes test() and it() as aliases; the suite standardized on
      // test() (2026-07-18 sweep — 14 it()-only files converted, 0 mixed). One
      // spelling, mechanically held.
      "no-restricted-imports": [
        "error",
        { paths: [{ name: "bun:test", importNames: ["it"], message: "use test(), not it() — the suite's one spelling" }] },
      ],
      "react-hooks/exhaustive-deps": "error",
      "react-hooks/rules-of-hooks": "error",
    },
  },
  // The Playwright regression layer (e2e/ + its config) — same typed rule set,
  // minus react-hooks (no React here). These files typecheck against
  // tsconfig.e2e.json (not the root tsconfig, whose include is src only), so
  // they get an explicit `project` instead of the projectService lookup.
  // no-floating-promises matters most in this layer: an unawaited expect() is
  // a spec that can pass before its assertion runs.
  {
    files: ["e2e/**/*.ts", "playwright.config.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: ["./tsconfig.e2e.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { "@typescript-eslint": tseslint.plugin },
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
);
