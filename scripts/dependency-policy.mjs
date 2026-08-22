export const BUN_PACKAGE_REVIEW_MIN_VERSION = "1.4.0";
export const BUN_LOCKFILE_VERSION = 2;
export const MINIMUM_RELEASE_AGE_SECONDS = 259200;

export const DEPENDENCY_PROJECTS = Object.freeze([
  Object.freeze({
    id: "app",
    label: "Rotli app",
    relativeDirectory: ".",
    manifestPath: "package.json",
    bunfigPath: "bunfig.toml",
    lockfilePath: "bun.lock",
  }),
  Object.freeze({
    id: "site",
    label: "Marketing site",
    relativeDirectory: "site",
    manifestPath: "site/package.json",
    bunfigPath: "site/bunfig.toml",
    lockfilePath: "site/bun.lock",
  }),
  Object.freeze({
    id: "breve",
    label: "Breve runtime",
    relativeDirectory: "breve-runtime/defaults",
    manifestPath: "breve-runtime/defaults/package.json",
    bunfigPath: "breve-runtime/defaults/bunfig.toml",
    lockfilePath: "breve-runtime/defaults/bun.lock",
  }),
]);

const BUN_14_ACTIONS = new Set([
  "audit-fix",
  "audit-plan",
  "dedupe",
  "dedupe-check",
  "diff",
  "licenses",
  "licenses-check",
  "prune",
  "prune-plan",
]);
const MUTATING_ACTIONS = new Set(["audit-fix", "dedupe", "prune"]);

export function parseBunVersion(value) {
  const match = String(value).trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return match.slice(1).map(Number);
}

export function bunVersionAtLeast(value, minimum = BUN_PACKAGE_REVIEW_MIN_VERSION) {
  const actual = parseBunVersion(value);
  const required = parseBunVersion(minimum);
  if (!actual || !required) return false;
  for (let index = 0; index < required.length; index += 1) {
    if (actual[index] !== required[index]) return actual[index] > required[index];
  }
  return true;
}

export function actionRequiresBun14(action) {
  return BUN_14_ACTIONS.has(action);
}

export function actionMutatesDependencies(action) {
  return MUTATING_ACTIONS.has(action);
}

export function dependencyCommand(action, extraArguments = []) {
  switch (action) {
    case "audit":
      return ["audit"];
    case "audit-plan":
      return ["audit", "fix", "--dry-run", "--json", "--ignore-scripts"];
    case "audit-fix":
      return ["audit", "fix", "--ignore-scripts"];
    case "dedupe-check":
      return ["dedupe", "--check"];
    case "dedupe":
      return ["dedupe"];
    case "prune-plan":
      return ["prune", "--dry-run"];
    case "prune":
      return ["prune"];
    case "licenses":
    case "licenses-check":
      return ["pm", "licenses", "--json", "--prod"];
    case "diff":
      return ["pm", "diff", ...extraArguments];
    default:
      throw new Error(`Unknown dependency action: ${action}`);
  }
}

export function selectedDependencyProjects(rootId) {
  if (!rootId) return [...DEPENDENCY_PROJECTS];
  const project = DEPENDENCY_PROJECTS.find((candidate) => candidate.id === rootId);
  if (!project) {
    throw new Error(`Unknown dependency root '${rootId}'. Expected app, site, or breve.`);
  }
  return [project];
}

export function combinedExitCode(exitCodes) {
  return exitCodes.some((code) => code !== 0) ? 1 : 0;
}

export function bunfigInstallSettings(text) {
  let section = "";
  const settings = {};
  for (const sourceLine of String(text).split(/\r?\n/)) {
    const line = sourceLine.replace(/\s+#.*$/, "").trim();
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }
    if (section !== "install") continue;
    const valueMatch = line.match(/^([A-Za-z][A-Za-z0-9]*)\s*=\s*(.+)$/);
    if (!valueMatch) continue;
    const [, key, rawValue] = valueMatch;
    if (/^\d+$/.test(rawValue)) settings[key] = Number(rawValue);
    else if (rawValue === "true" || rawValue === "false") settings[key] = rawValue === "true";
    else settings[key] = rawValue.match(/^"(.*)"$/)?.[1] ?? rawValue;
  }
  return settings;
}

export function bunfigMinimumReleaseAge(text) {
  return bunfigInstallSettings(text).minimumReleaseAge ?? null;
}

export function bunLockfileVersion(text) {
  const match = String(text).match(/^\s*\{\s*"lockfileVersion"\s*:\s*(\d+)/);
  return match ? Number(match[1]) : null;
}

export function unknownLicensePackages(result) {
  return (result?.Unknown ?? [])
    .flatMap((entry) => (entry.versions ?? []).map((version) => `${entry.name}@${version}`))
    .sort((left, right) => left.localeCompare(right));
}

export function dependencyLicenseViolations(roots, baseline) {
  const violations = [];
  if (baseline?.schemaVersion !== 1) {
    return ["dependency-license-baseline.json: schemaVersion must be 1"];
  }
  if (!baseline.unknownPackages || typeof baseline.unknownPackages !== "object") {
    return ["dependency-license-baseline.json: unknownPackages must map every dependency root"];
  }

  for (const project of DEPENDENCY_PROJECTS) {
    const actual = unknownLicensePackages(roots.find((root) => root.id === project.id)?.result);
    const entries = baseline.unknownPackages[project.id];
    if (!Array.isArray(entries)) {
      violations.push(`dependency-license-baseline.json: unknownPackages.${project.id} must be an array`);
      continue;
    }
    const expected = [...entries].sort((left, right) => left.localeCompare(right));
    if (new Set(expected).size !== expected.length) {
      violations.push(`dependency-license-baseline.json: unknownPackages.${project.id} contains duplicates`);
      continue;
    }
    const unreviewed = actual.filter((entry) => !expected.includes(entry));
    const stale = expected.filter((entry) => !actual.includes(entry));
    if (unreviewed.length) {
      violations.push(`${project.id}: unreviewed Unknown-license packages: ${unreviewed.join(", ")}`);
    }
    if (stale.length) {
      violations.push(`${project.id}: stale Unknown-license baseline entries: ${stale.join(", ")}`);
    }
  }
  return violations;
}

export function dependencyPolicyViolations({ bunVersion, manifests, bunfigs, lockfiles, regressionWorkflow }) {
  const violations = [];
  if (!/^\d+\.\d+\.\d+$/.test(bunVersion)) {
    violations.push(".bun-version: expected an exact stable semver");
  }

  for (const project of DEPENDENCY_PROJECTS) {
    const manifest = manifests[project.manifestPath];
    if (!manifest) {
      violations.push(`${project.manifestPath}: dependency root manifest is missing`);
      continue;
    }
    if (manifest.packageManager !== `bun@${bunVersion}`) {
      violations.push(`${project.manifestPath}: packageManager must match .bun-version (${bunVersion})`);
    }
    if (Object.hasOwn(manifest, "trustedDependencies")) {
      violations.push(`${project.manifestPath}: trustedDependencies must be absent when lifecycle scripts are disabled`);
    }

    const bunfig = bunfigs[project.bunfigPath];
    const install = bunfigInstallSettings(bunfig);
    if (install.minimumReleaseAge !== MINIMUM_RELEASE_AGE_SECONDS) {
      violations.push(
        `${project.bunfigPath}: install.minimumReleaseAge must be ${MINIMUM_RELEASE_AGE_SECONDS} seconds`,
      );
    }
    if (install.ignoreScripts !== true) {
      violations.push(`${project.bunfigPath}: install.ignoreScripts must be true`);
    }
    if (install.linker !== "isolated") {
      violations.push(`${project.bunfigPath}: install.linker must be isolated`);
    }
    if (install.globalStore !== false) {
      violations.push(`${project.bunfigPath}: install.globalStore must be false`);
    }
    if (bunLockfileVersion(lockfiles[project.lockfilePath]) !== BUN_LOCKFILE_VERSION) {
      violations.push(`${project.lockfilePath}: lockfileVersion must be ${BUN_LOCKFILE_VERSION}`);
    }
  }

  const rootManifest = manifests["package.json"];
  if (rootManifest?.scripts?.deps !== "bun scripts/dependency-workflow.mjs") {
    violations.push("package.json: deps must run scripts/dependency-workflow.mjs");
  }
  if (rootManifest?.scripts?.["dev:app"] !== "bun --no-orphans scripts/tauri-dev-supervisor.ts") {
    violations.push("package.json: dev:app must keep the supervised process tree under --no-orphans");
  }
  if (!regressionWorkflow.includes("run: bun run deps audit")) {
    violations.push("regression.yml: dependency audit must cover every Bun lockfile through bun run deps audit");
  }
  if (!regressionWorkflow.includes("branches: [main, dev]")) {
    violations.push("regression.yml: protected automation must run on main and dev pushes");
  }
  if (!regressionWorkflow.includes("run: bun run deps dedupe-check")) {
    violations.push("regression.yml: dependency convergence must cover every Bun lockfile");
  }
  if (!regressionWorkflow.includes("run: bun run deps licenses-check")) {
    violations.push("regression.yml: unknown production-license metadata must stay on its reviewed baseline");
  }
  if (
    !regressionWorkflow.includes("run: bun run --silent deps licenses > dependency-licenses.json") ||
    !regressionWorkflow.includes("name: dependency-licenses") ||
    !regressionWorkflow.includes("path: dependency-licenses.json")
  ) {
    violations.push("regression.yml: CI must retain the production dependency license inventory");
  }

  return violations;
}
