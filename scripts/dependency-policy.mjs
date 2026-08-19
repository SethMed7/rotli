export const BUN_PACKAGE_REVIEW_MIN_VERSION = "1.4.0";
export const MINIMUM_RELEASE_AGE_SECONDS = 259200;

export const DEPENDENCY_PROJECTS = Object.freeze([
  Object.freeze({
    id: "app",
    label: "Rotli app",
    relativeDirectory: ".",
    manifestPath: "package.json",
    bunfigPath: "bunfig.toml",
  }),
  Object.freeze({
    id: "site",
    label: "Marketing site",
    relativeDirectory: "site",
    manifestPath: "site/package.json",
    bunfigPath: "site/bunfig.toml",
  }),
  Object.freeze({
    id: "breve",
    label: "Breve runtime",
    relativeDirectory: "breve-runtime/defaults",
    manifestPath: "breve-runtime/defaults/package.json",
    bunfigPath: "breve-runtime/defaults/bunfig.toml",
  }),
]);

const BUN_14_ACTIONS = new Set([
  "audit-fix",
  "audit-plan",
  "dedupe",
  "dedupe-check",
  "diff",
  "licenses",
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

export function bunfigMinimumReleaseAge(text) {
  let section = "";
  for (const sourceLine of String(text).split(/\r?\n/)) {
    const line = sourceLine.replace(/\s+#.*$/, "").trim();
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      continue;
    }
    if (section !== "install") continue;
    const valueMatch = line.match(/^minimumReleaseAge\s*=\s*(\d+)$/);
    if (valueMatch) return Number(valueMatch[1]);
  }
  return null;
}

export function dependencyPolicyViolations({ bunVersion, manifests, bunfigs, regressionWorkflow }) {
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

    const bunfig = bunfigs[project.bunfigPath];
    if (bunfigMinimumReleaseAge(bunfig) !== MINIMUM_RELEASE_AGE_SECONDS) {
      violations.push(
        `${project.bunfigPath}: install.minimumReleaseAge must be ${MINIMUM_RELEASE_AGE_SECONDS} seconds`,
      );
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

  return violations;
}
