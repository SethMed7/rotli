// Local twin of the proposed-commit scanner: inspect this worktree's proposed
// additions, including untracked files, without printing their contents.
import { execFileSync, spawnSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
const version = spawnSync("gitleaks", ["version"], { encoding: "utf8" });
if (version.status !== 0 || version.stdout.trim() !== "8.30.1")
  throw new Error("Install Gitleaks 8.30.1; the required secret scan cannot be skipped");
const diff = execFileSync("git", ["diff", "--no-ext-diff", "--unified=0", "HEAD"], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
const inputs = [diff];
const paths = execFileSync("git", ["ls-files", "-z", "--others", "--exclude-standard"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
for (const path of paths) {
  if (!lstatSync(path).isFile()) continue;
  const bytes = readFileSync(path);
  if (!bytes.includes(0)) inputs.push(bytes.toString("utf8"));
}
const result = spawnSync("gitleaks", ["stdin", "--redact=100", "--no-banner", "--log-level=error"], {
  input: inputs.join("\n"),
  stdio: ["pipe", "inherit", "inherit"],
});
process.exitCode = result.status ?? 1;
console.log(
  result.status === 0
    ? "Proposed worktree secret scan passed"
    : "Proposed worktree secret scan requires review",
);
