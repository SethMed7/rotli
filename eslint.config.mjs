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
export default tseslint.config({
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
    "react-hooks/exhaustive-deps": "error",
    "react-hooks/rules-of-hooks": "error",
  },
});
