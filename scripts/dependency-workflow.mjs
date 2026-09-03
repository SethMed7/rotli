import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  BUN_PACKAGE_REVIEW_MIN_VERSION,
  actionMutatesDependencies,
  actionRequiresBun14,
  bunVersionAtLeast,
  combinedExitCode,
  dependencyCommand,
  dependencyLicenseViolations,
  selectedDependencyProjects,
} from "./dependency-policy.mjs";

const root = resolve(import.meta.dir, "..");
const dependencyBinary = process.env.ROTLI_BUN_DEPENDENCY_BIN?.trim() || process.execPath;

const usage = `Dependency review workflow

Usage:
  bun run deps audit [--root=app|site|breve]
  bun run deps audit-plan [--root=app|site|breve]
  bun run deps dedupe-check [--root=app|site|breve]
  bun run deps prune-plan [--root=app|site|breve]
  bun run deps licenses [--root=app|site|breve]
  bun run deps licenses-check
  bun run deps diff [--root=app|site|breve] <bun pm diff arguments...>
  bun run deps audit-fix --root=app|site|breve --apply
  bun run deps dedupe --root=app|site|breve --apply
  bun run deps prune --root=app|site|breve --apply

The audit command works on Rotli's stable Bun pin. The other commands require
Bun ${BUN_PACKAGE_REVIEW_MIN_VERSION} or newer. Mutating commands require one explicit
root and --apply; audit-fix never crosses a declared dependency range. To evaluate an
alternate binary without changing the release toolchain, set ROTLI_BUN_DEPENDENCY_BIN
to its absolute path.`;

async function capture(args, cwd = root) {
  let child;
  try {
    child = Bun.spawn([dependencyBinary, ...args], {
      cwd,
      env: process.env,
      stdin: "inherit",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (error) {
    return { exitCode: 1, stdout: "", stderr: error instanceof Error ? error.message : String(error) };
  }
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stdout, stderr };
}

async function inherit(args, cwd) {
  try {
    const child = Bun.spawn([dependencyBinary, ...args], {
      cwd,
      env: process.env,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    return await child.exited;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

async function bunIdentity() {
  const [versionResult, revisionResult] = await Promise.all([
    capture(["--version"]),
    capture(["--revision"]),
  ]);
  if (versionResult.exitCode !== 0) {
    throw new Error(
      `Unable to run dependency Bun at ${dependencyBinary}: ${versionResult.stderr.trim() || "unknown error"}`,
    );
  }
  return {
    version: versionResult.stdout.trim(),
    revision: revisionResult.exitCode === 0 ? revisionResult.stdout.trim() : null,
  };
}

function parseArguments(values) {
  let rootId;
  let apply = false;
  const extraArguments = [];
  for (const value of values) {
    if (value.startsWith("--root=")) {
      if (rootId) throw new Error("Pass --root only once.");
      rootId = value.slice("--root=".length);
    } else if (value === "--apply") {
      if (apply) throw new Error("Pass --apply only once.");
      apply = true;
    } else {
      extraArguments.push(value);
    }
  }
  return { rootId, apply, extraArguments };
}

async function runJsonAction(action, projects, identity) {
  const roots = [];
  for (const project of projects) {
    const result = await capture(dependencyCommand(action), resolve(root, project.relativeDirectory));
    let value = null;
    let parseError = null;
    try {
      value = JSON.parse(result.stdout);
    } catch (error) {
      parseError = error instanceof Error ? error.message : String(error);
    }
    roots.push({
      id: project.id,
      directory: project.relativeDirectory,
      exitCode: result.exitCode,
      result: value,
      ...(result.stderr.trim() ? { stderr: result.stderr.trim() } : {}),
      ...(parseError ? { parseError } : {}),
    });
  }

  const commandExitCode = combinedExitCode(roots.map((entry) => (entry.parseError ? 1 : entry.exitCode)));
  if (action === "licenses-check") {
    if (commandExitCode !== 0) return commandExitCode;
    const baseline = JSON.parse(
      readFileSync(resolve(root, "scripts/dependency-license-baseline.json"), "utf8"),
    );
    const violations = dependencyLicenseViolations(roots, baseline);
    if (violations.length) {
      console.error(
        `dependency license baseline failed:\n${violations.map((line) => `  - ${line}`).join("\n")}`,
      );
      return 1;
    }
    const unknownCount = roots.reduce(
      (count, entry) => count + (entry.result?.Unknown?.flatMap((item) => item.versions ?? []).length ?? 0),
      0,
    );
    console.log(`dependency license baseline ok — ${unknownCount} reviewed Unknown entries, no drift`);
    return 0;
  }

  console.log(JSON.stringify({ schemaVersion: 1, action, bun: identity, roots }, null, 2));
  return commandExitCode;
}

async function main() {
  const [action, ...values] = process.argv.slice(2);
  if (!action || action === "help" || action === "--help" || action === "-h") {
    console.log(usage);
    return action ? 0 : 1;
  }

  let options;
  let projects;
  try {
    options = parseArguments(values);
    projects = selectedDependencyProjects(options.rootId);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  if (action === "diff" && projects.length !== 1) {
    console.error("diff requires --root=app, --root=site, or --root=breve so its lockfile is unambiguous.");
    return 1;
  }
  if (action === "diff" && options.extraArguments.length === 0) {
    console.error("diff requires package versions or paths to compare.");
    return 1;
  }
  if (action !== "diff" && options.extraArguments.length > 0) {
    console.error(`Unexpected arguments for ${action}: ${options.extraArguments.join(" ")}`);
    return 1;
  }
  const mutates = actionMutatesDependencies(action);
  if (options.apply && !mutates) {
    console.error(`--apply is valid only for audit-fix, dedupe, or prune; ${action} is read-only.`);
    return 1;
  }
  if (mutates && (!options.rootId || !options.apply)) {
    console.error(`${action} mutates dependencies and requires one explicit --root plus --apply.`);
    return 1;
  }

  let identity;
  try {
    identity = await bunIdentity();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  if (actionRequiresBun14(action) && !bunVersionAtLeast(identity.version)) {
    console.error(
      `${action} requires Bun ${BUN_PACKAGE_REVIEW_MIN_VERSION} or newer; dependency binary is ${identity.revision ?? identity.version}.`,
    );
    console.error(
      "Install the exact Bun version pinned in .bun-version or select a compatible alternate binary.",
    );
    return 1;
  }

  if (action === "audit-plan" || action === "licenses" || action === "licenses-check") {
    return runJsonAction(action, projects, identity);
  }

  let command;
  try {
    command = dependencyCommand(action, options.extraArguments);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage);
    return 1;
  }

  const exitCodes = [];
  for (const project of projects) {
    console.log(`\n== ${project.label} (${project.relativeDirectory}) ==`);
    exitCodes.push(await inherit(command, resolve(root, project.relativeDirectory)));
  }
  return combinedExitCode(exitCodes);
}

if (import.meta.main) process.exitCode = await main();
