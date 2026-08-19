import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const REACT_COMPILER_CODE = "react(react-compiler)";

function diagnosticKind(message) {
  return message.split(":", 1)[0];
}

function normalizedFile(filename, repositoryRoot, scanRoot) {
  const absolute = isAbsolute(filename)
    ? filename
    : existsSync(resolve(repositoryRoot, filename))
      ? resolve(repositoryRoot, filename)
      : resolve(scanRoot, filename);
  return relative(scanRoot, absolute).replaceAll("\\", "/");
}

export function diagnosticBudgets(diagnostics, repositoryRoot, scanRoot) {
  const budgets = {};
  for (const diagnostic of diagnostics) {
    if (diagnostic.code !== REACT_COMPILER_CODE) continue;
    const file = normalizedFile(diagnostic.filename, repositoryRoot, scanRoot);
    const kind = diagnosticKind(diagnostic.message);
    budgets[file] ??= {};
    budgets[file][kind] = (budgets[file][kind] ?? 0) + 1;
  }
  return budgets;
}

export function budgetRegressions(current, baseline) {
  const regressions = [];
  for (const [file, kinds] of Object.entries(current)) {
    for (const [kind, count] of Object.entries(kinds)) {
      const allowed = baseline[file]?.[kind] ?? 0;
      if (count > allowed) regressions.push({ file, kind, count, allowed });
    }
  }
  return regressions;
}

function budgetTotal(budgets) {
  return Object.values(budgets).reduce(
    (total, kinds) => total + Object.values(kinds).reduce((subtotal, count) => subtotal + count, 0),
    0,
  );
}

function main() {
  const repositoryRoot = process.env.ROTLI_REACT_COMPILER_REPOSITORY_ROOT ?? process.cwd();
  const scanRoot = process.env.ROTLI_REACT_COMPILER_ROOT ?? repositoryRoot;
  const sourceRoot = join(scanRoot, "src");
  const baselinePath =
    process.env.ROTLI_REACT_COMPILER_BASELINE ?? join(repositoryRoot, "scripts/react-compiler-baseline.json");
  const oxlint = process.env.ROTLI_OXLINT_BIN ?? join(repositoryRoot, "node_modules/.bin/oxlint");

  if (!existsSync(sourceRoot)) {
    console.error(`check:react-compiler failed — missing source root ${sourceRoot}`);
    process.exit(1);
  }
  if (!existsSync(baselinePath)) {
    console.error(`check:react-compiler failed — missing baseline ${baselinePath}`);
    process.exit(1);
  }

  const result = spawnSync(
    oxlint,
    [
      "--config",
      join(repositoryRoot, ".oxlintrc.json"),
      "--react-plugin",
      "-D",
      "react/react-compiler",
      "--format",
      "json",
      sourceRoot,
    ],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  if (result.error) {
    console.error(`check:react-compiler failed — ${result.error.message}`);
    process.exit(1);
  }

  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    console.error("check:react-compiler failed — oxlint did not return a JSON report");
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(1);
  }

  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const current = diagnosticBudgets(report.diagnostics ?? [], repositoryRoot, scanRoot);
  const regressions = budgetRegressions(current, baseline);
  if (regressions.length > 0) {
    console.error(
      `check:react-compiler failed — new Rules-of-React diagnostics:\n${regressions
        .map(
          ({ file, kind, count, allowed }) =>
            `  - ${file}: ${kind} ${count} (baseline allows ${allowed})`,
        )
        .join("\n")}`,
    );
    process.exit(1);
  }

  const currentTotal = budgetTotal(current);
  const baselineTotal = budgetTotal(baseline);
  console.log(
    `check:react-compiler ok — ${currentTotal} known diagnostics, ${baselineTotal - currentTotal} retired from the baseline, 0 new`,
  );
}

if (import.meta.main) main();
