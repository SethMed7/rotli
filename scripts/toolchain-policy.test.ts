import { describe, expect, test } from "bun:test";

import {
  OXFMT_CHECK_COMMAND,
  OXFMT_COMMAND,
  OXFMT_SCHEMA,
  OXLINT_COMMAND,
  PARALLEL_LINT_COMMAND,
  SERIAL_LINT_COMMAND,
  toolchainPolicyViolations,
} from "./toolchain-policy.mjs";

function validPolicy() {
  return {
    manifest: {
      scripts: {
        lint: PARALLEL_LINT_COMMAND,
        "lint:serial": SERIAL_LINT_COMMAND,
        "lint:oxlint": OXLINT_COMMAND,
        format: OXFMT_COMMAND,
        "format:check": OXFMT_CHECK_COMMAND,
      },
    },
    oxlintConfig: {
      options: { typeAware: true, maxWarnings: 0 },
      rules: {},
    },
    reactCompilerConfig: { rules: { "react/react-compiler": "error" } },
    oxfmtConfig: { $schema: OXFMT_SCHEMA },
    viteConfig: "build: { rolldownOptions: { onwarn(warning) { buildWarningViolation(warning); } } }",
  };
}

describe("Oxc and Rolldown repository policy", () => {
  test("accepts the hardened native toolchain wiring", () => {
    expect(toolchainPolicyViolations(validPolicy())).toEqual([]);
  });

  test("rejects compatibility aliases, non-type-aware lint, and formatter drift", () => {
    const policy = validPolicy();
    policy.manifest.scripts.lint = "bun run typecheck";
    policy.oxlintConfig.options.typeAware = false;
    policy.reactCompilerConfig.rules["react/react-compiler"] = "off";
    policy.oxfmtConfig.$schema = "https://example.test/schema.json";
    policy.viteConfig = "build: { rollupOptions: {} }";

    expect(toolchainPolicyViolations(policy)).toEqual(
      expect.arrayContaining([
        "package.json: lint must stay on the repository-owned command",
        ".oxlintrc.json: options.typeAware must be true",
        "scripts/react-compiler-oxlint.json: react/react-compiler must stay enabled for the diagnostic ratchet",
        ".oxfmtrc.json: $schema must be ./node_modules/oxfmt/configuration_schema.json",
        "vite.config.ts: Vite 8 must use native build.rolldownOptions",
        "vite.config.ts: deprecated build.rollupOptions compatibility alias is forbidden",
        "vite.config.ts: every unexpected Rolldown/Oxc warning must fail the build",
      ]),
    );
  });
});
