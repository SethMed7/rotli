// Which lanes a change needs (2026-09-23, the owner: a website-only PR ran
// every job). The app lanes — Rust on macOS and Linux, browser E2E, and the
// dependency audit — prove nothing about the site's pages, `docs/`, or a root
// Markdown file, so a change touching only those skips them. Quality (which
// builds and checks the site too) and the secret scan always run. The site's
// own manifest and lockfile stay app-scope: the dependency audit scans them.
//
// GitHub counts a job skipped by its `if:` as passing a required check, so
// any doubt — no base commit, an empty or failed diff, a manual run — means
// "the app changed": a broken scope can only run too much, never too little.
//
//   bun scripts/ci-scope.ts <base-sha> <head-sha>   → prints `app=true|false`

const SITE_ONLY = [/^site\//, /^docs\//, /^[^/]+\.md$/];
/** Under site/, but read by the dependency audit (review of #67). */
const AUDITED = /^site\/(package\.json|bun\.lock|bunfig\.toml)$/;

/** True unless every changed path is website or documentation only. */
export function appChanged(paths: readonly string[]): boolean {
  if (paths.length === 0) return true;
  return !paths.every((path) => !AUDITED.test(path) && SITE_ONLY.some((pattern) => pattern.test(path)));
}

/** Runs `git diff --name-only`; null when it fails. */
export type DiffRunner = (range: string) => string[] | null;

const gitDiff: DiffRunner = (range) => {
  const diff = Bun.spawnSync(["git", "diff", "--name-only", range]);
  return diff.exitCode === 0 ? diff.stdout.toString().split("\n").filter(Boolean) : null;
};

const SHA = /^[0-9a-f]{40}$/;

/** The whole decision: any doubt about the range runs every lane. */
export function scopeFor(
  base: string,
  head: string,
  diff: DiffRunner = gitDiff,
): { app: boolean; paths: string[] | null } {
  if (!SHA.test(base) || /^0+$/.test(base) || !SHA.test(head)) return { app: true, paths: null };
  const paths = diff(`${base}...${head}`);
  return { app: paths === null ? true : appChanged(paths), paths };
}

if (import.meta.main) {
  const [base = "", head = ""] = process.argv.slice(2);
  const { app, paths } = scopeFor(base, head);
  console.log(`app=${app}`);
  console.error(
    paths === null
      ? "ci-scope: no usable base/head — running every lane"
      : `ci-scope: ${paths.length} changed path(s); app lanes ${app ? "run" : "skip (site/docs only)"}`,
  );
}
