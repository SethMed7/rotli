#!/usr/bin/env bun
// Run today's save-state explorer against an older commit, so a "before" can
// be re-run by anyone (ninth review of pull request 267: the shims behind an
// earlier "all eight runs failed" were deleted, so nobody could reproduce it).
//
//   bun scripts/explore-at.ts <commit> [--full] [--scenario "<name>"]…
//
// It rebuilds <commit> in a temporary folder outside the repository (git
// archive), links node_modules, copies in the current explorer and the fake
// disk it drives (src/editor/saveExplorer*.ts, writeLane.fixtures.ts), applies
// the compatibility shims recorded for that commit in
// scripts/fixtures/explorer-shims.json (each one says what it stands in for),
// runs the named scenarios (all, by default), prints every distinct failure
// with its shortest schedule, and removes the folder. Exit 0 either way: the
// point is what it prints.

import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const root = join(import.meta.dir, "..");
const args = process.argv.slice(2);
const commit = args.find(
  (arg) => !arg.startsWith("--") && !args[args.indexOf(arg) - 1]?.startsWith("--scenario"),
);
if (!commit || !/^[0-9a-f]{7,40}$/.test(commit)) {
  console.error('usage: bun scripts/explore-at.ts <commit sha> [--full] [--scenario "<name>"]…');
  process.exit(2);
}
const full = args.includes("--full");
const scenarios = args.flatMap((arg, i) => (args[i - 1] === "--scenario" ? [arg] : []));

const shimsFile = join(root, "scripts/fixtures/explorer-shims.json");
const shims = JSON.parse(readFileSync(shimsFile, "utf8")) as Record<
  string,
  { about: string; append?: Record<string, string>; create?: Record<string, string> }
>;
const key = Object.keys(shims).find((prefix) => commit.startsWith(prefix) || prefix.startsWith(commit));

const run = (cmd: string, cmdArgs: string[], cwd: string, env: Record<string, string> = {}) =>
  spawnSync(cmd, cmdArgs, { cwd, encoding: "utf8", env: { ...process.env, ...env }, maxBuffer: 1 << 28 });

const dir = mkdtempSync(join(tmpdir(), "rotli-explore-at-"));
try {
  const archive = run("sh", ["-c", `git archive ${commit} | tar -x -C "${dir}"`], root);
  if (archive.status !== 0) throw new Error(`git archive ${commit} failed: ${archive.stderr}`);
  symlinkSync(join(root, "node_modules"), join(dir, "node_modules"));
  for (const file of [
    "src/editor/saveExplorer.fixtures.ts",
    "src/editor/saveExplorer.test.ts",
    "src/editor/saveExplorerSearch.fixtures.ts",
    "src/editor/saveExplorerClock.fixtures.ts",
    "src/editor/saveExplorerRules.fixtures.ts",
    "src/editor/writeLane.fixtures.ts",
  ])
    copyFileSync(join(root, file), join(dir, file));
  if (key) {
    console.log(`shims for ${key}: ${shims[key]!.about}`);
    for (const [file, text] of Object.entries(shims[key]!.create ?? {})) {
      spawnSync("mkdir", ["-p", dirname(join(dir, file))]);
      writeFileSync(join(dir, file), text);
    }
    for (const [file, text] of Object.entries(shims[key]!.append ?? {}))
      appendFileSync(join(dir, file), text);
  } else console.log(`no shims recorded for ${commit}: running the explorer as it is`);
  const env: Record<string, string> = full ? { EXPLORE: "full" } : {};
  if (scenarios.length > 0) env.EXPLORE_ONLY = scenarios.join("|");
  const result = run("bun", ["test", "src/editor/saveExplorer.test.ts"], dir, env);
  const out = `${result.stdout}\n${result.stderr}`;
  const lines = out.split("\n");
  const seen = new Set<string>();
  for (const line of lines) {
    const text = line.replace(/^[\s+"-]*/, "");
    const summary =
      /^(.*): (\d+) schedules, depth (\d+), (\d+) ms$/.exec(text) ?? /^random walks: .*$/.exec(text);
    const failure = /^[\w ,'()-]+: I\d .*/.test(text) || /^walks \(seed \d+\): I\d .*/.test(text);
    const replay = text.startsWith("replay(scenario");
    if ((summary || failure || replay) && !seen.has(text)) {
      seen.add(text);
      console.log(replay ? `    ${text}` : text);
    }
  }
  const counts = lines.filter((line) => /^\s*\d+ (pass|fail)$/.test(line)).map((line) => line.trim());
  console.log(`${commit}: ${counts.join(", ") || "no results (see the explorer's own output)"}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
