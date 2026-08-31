import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import {
  BUN_LOCKFILE_VERSION,
  MINIMUM_RELEASE_AGE_SECONDS,
  actionMutatesDependencies,
  bunVersionAtLeast,
  combinedExitCode,
  dependencyCommand,
  dependencyLicenseViolations,
  dependencyPolicyViolations,
  selectedDependencyProjects,
} from "./dependency-policy.mjs";

const bunfig = `[install]
frozenLockfile = true
minimumReleaseAge = ${MINIMUM_RELEASE_AGE_SECONDS}
ignoreScripts = true
linker = "isolated"
globalStore = false
`;
const lockfile = `{ "lockfileVersion": ${BUN_LOCKFILE_VERSION} }`;

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
    packageManager: "bun@1.4.0",
    scripts: {
      deps: "bun scripts/dependency-workflow.mjs",
      "dev:app": "bun --no-orphans scripts/tauri-dev-supervisor.ts",
    },
  };
  return {
    bunVersion: "1.4.0",
    manifests: {
      "package.json": rootManifest,
      "site/package.json": { packageManager: "bun@1.4.0" },
      "breve-runtime/defaults/package.json": { packageManager: "bun@1.4.0" },
    },
    bunfigs: {
      "bunfig.toml": bunfig,
      "site/bunfig.toml": bunfig,
      "breve-runtime/defaults/bunfig.toml": bunfig,
    },
    lockfiles: {
      "bun.lock": lockfile,
      "site/bun.lock": lockfile,
      "breve-runtime/defaults/bun.lock": lockfile,
    },
    regressionWorkflow: `branches: [main, dev]
- run: bun run deps audit
- run: bun run deps dedupe-check
- run: bun run deps licenses-check
- run: bun run --silent deps licenses > dependency-licenses.json
- name: dependency-licenses
  path: dependency-licenses.json
`,
  };
}

describe("dependency policy", () => {
  test("holds every install root to the hardened Bun install policy", () => {
    expect(dependencyPolicyViolations(validPolicy())).toEqual([]);
  });

  test("rejects a root that bypasses the release-age gate", () => {
    const policy = validPolicy();
    policy.bunfigs["site/bunfig.toml"] = "[install]\n";
    expect(dependencyPolicyViolations(policy)).toContain(
      `site/bunfig.toml: install.minimumReleaseAge must be ${MINIMUM_RELEASE_AGE_SECONDS} seconds`,
    );
  });

  test("rejects lifecycle scripts, shared resolution, and an old lockfile", () => {
    const policy = validPolicy();
    policy.manifests["site/package.json"].trustedDependencies = ["sharp"];
    policy.bunfigs["site/bunfig.toml"] = `[install]
frozenLockfile = false
minimumReleaseAge = ${MINIMUM_RELEASE_AGE_SECONDS}
ignoreScripts = false
linker = "hoisted"
globalStore = true
`;
    policy.lockfiles["site/bun.lock"] = '{ "lockfileVersion": 1 }';

    expect(dependencyPolicyViolations(policy)).toEqual(
      expect.arrayContaining([
        "site/package.json: trustedDependencies must be absent when lifecycle scripts are disabled",
        "site/bunfig.toml: install.frozenLockfile must be true",
        "site/bunfig.toml: install.ignoreScripts must be true",
        "site/bunfig.toml: install.linker must be isolated",
        "site/bunfig.toml: install.globalStore must be false",
        "site/bun.lock: lockfileVersion must be 2",
      ]),
    );
  });

  test("rejects package-manager drift and a partial CI audit", () => {
    const policy = validPolicy();
    policy.manifests["breve-runtime/defaults/package.json"].packageManager = "bun@1.3.14";
    policy.regressionWorkflow = "- run: bun audit\n";
    expect(dependencyPolicyViolations(policy)).toEqual(
      expect.arrayContaining([
        "breve-runtime/defaults/package.json: packageManager must match .bun-version (1.4.0)",
        "regression.yml: dependency audit must cover every Bun lockfile through bun run deps audit",
        "regression.yml: protected automation must run on main and dev pushes",
        "regression.yml: dependency convergence must cover every Bun lockfile",
        "regression.yml: unknown production-license metadata must stay on its reviewed baseline",
        "regression.yml: CI must retain the production dependency license inventory",
      ]),
    );
  });

  test("ratchets unknown-license entries in both directions", () => {
    const roots = [
      {
        id: "app",
        result: {
          Unknown: [{ name: "vendor-a", versions: ["1.0.0", "2.0.0"] }],
        },
      },
      { id: "site", result: {} },
      { id: "breve", result: {} },
    ];
    const baseline = {
      schemaVersion: 1,
      unknownPackages: {
        app: ["vendor-a@1.0.0", "vendor-b@1.0.0"],
        site: [],
        breve: [],
      },
    };

    expect(dependencyLicenseViolations(roots, baseline)).toEqual([
      "app: unreviewed Unknown-license packages: vendor-a@2.0.0",
      "app: stale Unknown-license baseline entries: vendor-b@1.0.0",
    ]);
  });

  test("rejects malformed and duplicate license baselines", () => {
    const roots = [
      { id: "app", result: {} },
      { id: "site", result: {} },
      { id: "breve", result: {} },
    ];

    expect(dependencyLicenseViolations(roots, { schemaVersion: 1 })).toEqual([
      "dependency-license-baseline.json: unknownPackages must map every dependency root",
    ]);
    expect(
      dependencyLicenseViolations(roots, {
        schemaVersion: 1,
        unknownPackages: { app: ["vendor@1", "vendor@1"], site: [], breve: [] },
      }),
    ).toEqual(["dependency-license-baseline.json: unknownPackages.app contains duplicates"]);
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
    expect(dependencyCommand("licenses-check")).toEqual(["pm", "licenses", "--json", "--prod"]);
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

  test("gates Bun 1.4 commands on the required feature line", () => {
    expect(bunVersionAtLeast("1.3.14")).toBe(false);
    expect(bunVersionAtLeast("1.4.0")).toBe(true);
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
