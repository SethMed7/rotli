import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import {
  MINIMUM_RELEASE_AGE_SECONDS,
  actionMutatesDependencies,
  bunVersionAtLeast,
  combinedExitCode,
  dependencyCommand,
  dependencyPolicyViolations,
  selectedDependencyProjects,
} from "./dependency-policy.mjs";

const bunfig = `[install]\nminimumReleaseAge = ${MINIMUM_RELEASE_AGE_SECONDS}\n`;

async function runWorkflow(arguments_: string[]) {
  const child = Bun.spawn(
    [process.execPath, join(import.meta.dir, "dependency-workflow.mjs"), ...arguments_],
    {
      cwd: join(import.meta.dir, ".."),
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

function validPolicy() {
  const rootManifest = {
    packageManager: "bun@1.3.14",
    scripts: {
      deps: "bun scripts/dependency-workflow.mjs",
      "dev:app": "bun --no-orphans scripts/tauri-dev-supervisor.ts",
    },
  };
  return {
    bunVersion: "1.3.14",
    manifests: {
      "package.json": rootManifest,
      "site/package.json": { packageManager: "bun@1.3.14" },
      "breve-runtime/defaults/package.json": { packageManager: "bun@1.3.14" },
    },
    bunfigs: {
      "bunfig.toml": bunfig,
      "site/bunfig.toml": bunfig,
      "breve-runtime/defaults/bunfig.toml": bunfig,
    },
    regressionWorkflow: "- run: bun run deps audit\n",
  };
}

describe("dependency policy", () => {
  test("holds every install root to one Bun pin and release-age gate", () => {
    expect(dependencyPolicyViolations(validPolicy())).toEqual([]);
  });

  test("rejects a root that bypasses the release-age gate", () => {
    const policy = validPolicy();
    policy.bunfigs["site/bunfig.toml"] = "[install]\n";
    expect(dependencyPolicyViolations(policy)).toContain(
      `site/bunfig.toml: install.minimumReleaseAge must be ${MINIMUM_RELEASE_AGE_SECONDS} seconds`,
    );
  });

  test("rejects package-manager drift and a partial CI audit", () => {
    const policy = validPolicy();
    policy.manifests["breve-runtime/defaults/package.json"].packageManager = "bun@1.4.0";
    policy.regressionWorkflow = "- run: bun audit\n";
    expect(dependencyPolicyViolations(policy)).toEqual(
      expect.arrayContaining([
        "breve-runtime/defaults/package.json: packageManager must match .bun-version (1.3.14)",
        "regression.yml: dependency audit must cover every Bun lockfile through bun run deps audit",
      ]),
    );
  });
});

describe("dependency workflow commands", () => {
  test("builds read-only Bun 1.4 maintenance commands", () => {
    expect(dependencyCommand("audit-plan")).toEqual([
      "audit",
      "fix",
      "--dry-run",
      "--json",
      "--ignore-scripts",
    ]);
    expect(dependencyCommand("dedupe-check")).toEqual(["dedupe", "--check"]);
    expect(dependencyCommand("prune-plan")).toEqual(["prune", "--dry-run"]);
    expect(dependencyCommand("licenses")).toEqual(["pm", "licenses", "--json", "--prod"]);
  });

  test("keeps reviewed mutations explicit and inside declared ranges", () => {
    expect(actionMutatesDependencies("audit-fix")).toBe(true);
    expect(actionMutatesDependencies("dedupe")).toBe(true);
    expect(actionMutatesDependencies("prune")).toBe(true);
    expect(actionMutatesDependencies("audit-plan")).toBe(false);
    expect(dependencyCommand("audit-fix")).toEqual(["audit", "fix", "--ignore-scripts"]);
    expect(dependencyCommand("dedupe")).toEqual(["dedupe"]);
    expect(dependencyCommand("prune")).toEqual(["prune"]);
  });

  test("requires an explicit root for package diffs", () => {
    expect(selectedDependencyProjects("site").map((project) => project.id)).toEqual(["site"]);
    expect(() => selectedDependencyProjects("unknown")).toThrow("Expected app, site, or breve");
    expect(dependencyCommand("diff", ["sharp@0.34.5", "0.35.2", "--stat"])).toEqual([
      "pm",
      "diff",
      "sharp@0.34.5",
      "0.35.2",
      "--stat",
    ]);
  });

  test("gates preview commands on the Bun 1.4 feature line", () => {
    expect(bunVersionAtLeast("1.3.14")).toBe(false);
    expect(bunVersionAtLeast("1.4.0-canary.1+4c689909e")).toBe(true);
    expect(bunVersionAtLeast("2.0.0")).toBe(true);
  });

  test("preserves advisory and candidate failures across roots", () => {
    expect(combinedExitCode([0, 0, 0])).toBe(0);
    expect(combinedExitCode([0, 1, 0])).toBe(1);
  });

  test("refuses mutations without both an explicit root and acknowledgement", async () => {
    const missingApply = await runWorkflow(["audit-fix", "--root=app"]);
    const missingRoot = await runWorkflow(["dedupe", "--apply"]);
    const applyOnReadOnly = await runWorkflow(["audit", "--apply"]);

    expect(missingApply.exitCode).toBe(1);
    expect(missingApply.stderr).toContain("requires one explicit --root plus --apply");
    expect(missingRoot.exitCode).toBe(1);
    expect(missingRoot.stderr).toContain("requires one explicit --root plus --apply");
    expect(applyOnReadOnly.exitCode).toBe(1);
    expect(applyOnReadOnly.stderr).toContain("audit is read-only");
  });
});
