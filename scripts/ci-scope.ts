// Which lanes a change needs (2026-09-23, the owner: a website-only PR ran
// every job). The app lanes — Rust on macOS and Linux, browser E2E, and the
// dependency audit — prove nothing about `site/`, `docs/`, or a root Markdown
// file, so a change touching only those skips them. Quality (which builds and
// checks the site too) and the secret scan always run.
//
// GitHub counts a job skipped by its `if:` as passing a required check, so
// any doubt — no base commit, an empty or failed diff, a manual run — means
// "the app changed": a broken scope can only run too much, never too little.
//
//   bun scripts/ci-scope.ts <base-sha> <head-sha>   → prints `app=true|false`

const SITE_ONLY = [/^site\//, /^docs\//, /^[^/]+\.md$/];

/** True unless every changed path is website or documentation only. */
export function appChanged(paths: readonly string[]): boolean {
  if (paths.length === 0) return true;
  return !paths.every((path) => SITE_ONLY.some((pattern) => pattern.test(path)));
}

function changedPaths(base: string, head: string): string[] | null {
  if (!/^[0-9a-f]{40}$/.test(base) || /^0+$/.test(base) || !/^[0-9a-f]{40}$/.test(head)) return null;
  const diff = Bun.spawnSync(["git", "diff", "--name-only", `${base}...${head}`]);
  if (diff.exitCode !== 0) return null;
  return diff.stdout.toString().split("\n").filter(Boolean);
}

if (import.meta.main) {
  const [base = "", head = ""] = process.argv.slice(2);
  const paths = changedPaths(base, head);
  const app = paths === null ? true : appChanged(paths);
  console.log(`app=${app}`);
  console.error(
    paths === null
      ? "ci-scope: no usable base/head — running every lane"
      : `ci-scope: ${paths.length} changed path(s); app lanes ${app ? "run" : "skip (site/docs only)"}`,
  );
}
