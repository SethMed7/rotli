// Redacted local scan. Only reviewable source files are copied; ignored vaults,
// credentials, browser profiles and dependency trees are never scanned/uploaded.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, lstatSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
const arguments_ = process.argv.slice(2);
if (arguments_.some((value) => value !== "--history")) throw new Error("Use --history or no arguments");
const version = spawnSync("gitleaks", ["version"], { encoding: "utf8" });
if (version.status !== 0) throw new Error("Install gitleaks 8.30.1 to run the redacted source/history scan");
if (version.stdout.trim() !== "8.30.1") throw new Error("This scan requires reviewed gitleaks 8.30.1");
const history = arguments_.includes("--history");
let scanRoot = process.cwd();
try {
  if (!history) {
    scanRoot = mkdtempSync(join(tmpdir(), "rotli-source-secrets-"));
    const paths = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
      encoding: "utf8",
    })
      .split("\0")
      .filter(Boolean);
    for (const path of new Set(paths)) {
      let stat;
      try {
        stat = lstatSync(path);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;
      const destination = join(scanRoot, path);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(path, destination);
    }
  }
  const result = spawnSync(
    "gitleaks",
    [
      history ? "git" : "dir",
      ...(history ? ["--log-opts=--all"] : []),
      "--redact=100",
      "--no-banner",
      "--log-level=error",
      scanRoot,
    ],
    { stdio: "inherit" },
  );
  console.log(
    `Redacted ${history ? "Git history" : "reviewable source"} secret scan: ${result.status === 0 ? "passed" : "findings or scanner failure; review required"}`,
  );
  process.exitCode = result.status ?? 1;
} finally {
  if (!history && scanRoot !== process.cwd()) rmSync(scanRoot, { recursive: true, force: true });
}
