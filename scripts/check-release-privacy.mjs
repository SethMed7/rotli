import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { bundlePrivacyFindings } from "./repository-privacy.mjs";

const input = process.argv[2];
if (!input || !input.endsWith(".app")) throw new Error("Pass the built release .app to inspect");
const repo = fileURLToPath(new URL("..", import.meta.url));
const config = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
if (JSON.stringify(config.bundle.resources) !== JSON.stringify({ "../breve-runtime/": "breve-runtime/" }))
  throw new Error("Bundle resource mappings changed; update the reviewed source manifest gate");
const tracked = execFileSync("git", ["ls-files", "-z", "--", "breve-runtime"], {
  cwd: repo,
  encoding: "utf8",
});
const resources = {
  prefix: "Contents/Resources/breve-runtime/",
  files: new Set(
    tracked
      .split("\0")
      .filter(Boolean)
      .map((path) => `Contents/Resources/${path}`),
  ),
};
const findings = bundlePrivacyFindings(resolve(input), homedir(), resources);
if (findings.length > 0) {
  console.error(`Release privacy inspection refused ${findings.length} finding(s):`);
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}
console.log(
  "Release privacy inspection passed: no prohibited files, embedded home paths, or external links.",
);
