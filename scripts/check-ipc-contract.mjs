import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const rust = readFileSync(join(root, "src-tauri/src/lib.rs"), "utf8");
const handlerBlock = rust.match(/\.invoke_handler\(tauri::generate_handler!\[([\s\S]*?)\]\)/)?.[1];

if (!handlerBlock) {
  console.error("IPC contract check failed: could not find Tauri generate_handler! registry");
  process.exit(1);
}

const registered = new Set(
  handlerBlock
    .split(",")
    .map((entry) => entry.replace(/\/\/.*$/gm, "").trim())
    .filter(Boolean)
    .map((entry) => entry.split("::").at(-1)),
);

const sourceFiles = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.tsx?$/.test(name)) sourceFiles.push(path);
  }
}
walk(join(root, "src"));

const calls = new Map();
const callPattern = /\b(?:invoke|corpusInvoke|aiInvoke|memexInvoke)\s*(?:<[^;\n(]+>)?\s*\(\s*["']([a-zA-Z0-9_]+)["']/g;
for (const file of sourceFiles) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(callPattern)) {
    const command = match[1];
    const locations = calls.get(command) ?? [];
    locations.push(relative(root, file));
    calls.set(command, locations);
  }
}

const missing = [...calls.entries()]
  .filter(([command]) => !registered.has(command))
  .map(([command, files]) => `${command} (${[...new Set(files)].join(", ")})`);

if (missing.length) {
  console.error(`IPC contract check failed — frontend commands missing Rust handlers:\n${missing.map((line) => `  - ${line}`).join("\n")}`);
  process.exit(1);
}

console.log(`check:ipc ok — ${calls.size} frontend commands resolve to ${registered.size} registered Rust handlers`);
