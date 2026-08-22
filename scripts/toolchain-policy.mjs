export const PARALLEL_LINT_COMMAND =
  "bun run --parallel typecheck check:e2e-types typecheck:tsc6 format:check check:code-shape check:react-compiler check:naming check:hex check:architecture check:ipc check:secret-parity check:parity check:structure check:security check:knip check:docs lint:oxlint";

export const SERIAL_LINT_COMMAND =
  "bun run typecheck && bun run check:e2e-types && bun run typecheck:tsc6 && bun run format:check && bun run check:code-shape && bun run check:react-compiler && bun run check:naming && bun run check:hex && bun run check:architecture && bun run check:ipc && bun run check:secret-parity && bun run check:parity && bun run check:structure && bun run check:security && bun run check:knip && bun run check:docs && bun run lint:oxlint";

export const OXLINT_COMMAND =
  "oxlint --disable-nested-config -c .oxlintrc.json --report-unused-disable-directives-severity=error src e2e scripts breve-runtime playwright.config.ts vite.config.ts";
export const OXFMT_COMMAND =
  'oxfmt -c .oxfmtrc.json "src/**/*.{ts,tsx}" "e2e/**/*.ts" "scripts/**/*.ts" playwright.config.ts';
export const OXFMT_CHECK_COMMAND =
  'oxfmt -c .oxfmtrc.json --check "src/**/*.{ts,tsx}" "e2e/**/*.ts" "scripts/**/*.ts" playwright.config.ts';
export const OXFMT_SCHEMA = "./node_modules/oxfmt/configuration_schema.json";

export function toolchainPolicyViolations({ manifest, oxlintConfig, oxfmtConfig, viteConfig }) {
  const violations = [];
  const scripts = manifest?.scripts ?? {};
  for (const [name, expected] of Object.entries({
    lint: PARALLEL_LINT_COMMAND,
    "lint:serial": SERIAL_LINT_COMMAND,
    "lint:oxlint": OXLINT_COMMAND,
    format: OXFMT_COMMAND,
    "format:check": OXFMT_CHECK_COMMAND,
  })) {
    if (scripts[name] !== expected) violations.push(`package.json: ${name} must stay on the repository-owned command`);
  }

  if (oxlintConfig?.options?.typeAware !== true) {
    violations.push(".oxlintrc.json: options.typeAware must be true");
  }
  if (oxlintConfig?.options?.maxWarnings !== 0) {
    violations.push(".oxlintrc.json: options.maxWarnings must be 0");
  }
  if (oxfmtConfig?.$schema !== OXFMT_SCHEMA) {
    violations.push(`.oxfmtrc.json: $schema must be ${OXFMT_SCHEMA}`);
  }
  if (!viteConfig.includes("rolldownOptions:")) {
    violations.push("vite.config.ts: Vite 8 must use native build.rolldownOptions");
  }
  if (viteConfig.includes("rollupOptions:")) {
    violations.push("vite.config.ts: deprecated build.rollupOptions compatibility alias is forbidden");
  }
  if (!viteConfig.includes("buildWarningViolation(warning)")) {
    violations.push("vite.config.ts: every unexpected Rolldown/Oxc warning must fail the build");
  }

  return violations;
}
