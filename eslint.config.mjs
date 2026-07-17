import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

// Lint-only for now (Batch 2 commit 1 of the Stage-3 remediation plan) — not yet
// wired into `bun run lint`. Scoped to src/**/*.{ts,tsx} only; breve-runtime is a
// separate measure-then-decide (plan 2.5), scripts/ and src-tauri/ are untouched.
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
    "@typescript-eslint/no-explicit-any": "error",
    "react-hooks/exhaustive-deps": "error",
    "react-hooks/rules-of-hooks": "error",
  },
});
