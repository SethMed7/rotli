import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.env.ROTLI_CHECK_ROOT ?? process.cwd();
const rust = readFileSync(join(root, "src-tauri/src/lib.rs"), "utf8");
const handlerBlock = rust.match(/\.invoke_handler\(tauri::generate_handler!\[([\s\S]*?)\]\)/)?.[1];

if (!handlerBlock) {
  console.error("IPC contract check failed: could not find Tauri generate_handler! registry");
  process.exit(1);
}

function fail(heading, lines) {
  console.error([`IPC contract check failed — ${heading}`, ...lines.map((line) => `  - ${line}`)].join("\n"));
  process.exit(1);
}

// comments go first: a comma inside one must not split off a fake entry
const entries = handlerBlock
  .replace(/\/\/.*$/gm, "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);
const unreadable = entries.filter((entry) => !/^(\w+::)*\w+$/.test(entry));
if (unreadable.length) {
  fail("cannot read a command name from these generate_handler! entries (plain paths only):", unreadable);
}
const registered = new Set(entries.map((entry) => entry.split("::").at(-1)));

// A host build reads this list to scope Rotli's commands to Rotli's webviews
// (docs/architecture/host-seams.md, "Scoping Rotli's commands"). Once it does,
// Tauri refuses every command the list lacks, Rotli's own windows included.
// It is checked first so that drift is reported as drift.
const LIST = "src-tauri/app-commands.json";

function walk(dir, pattern, found = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, pattern, found);
    else if (pattern.test(name)) found.push(path);
  }
  return found;
}

const renamed = walk(join(root, "src-tauri/src"), /\.rs$/).filter((file) =>
  /#\[(?:tauri::)?command\([^\]]*\brename\s*=/.test(readFileSync(file, "utf8")),
);
if (renamed.length) {
  fail(
    `a #[command(rename = …)] renames a command, so ${LIST} would name the wrong one:`,
    renamed.map((file) => relative(root, file)),
  );
}

let published;
try {
  published = JSON.parse(readFileSync(join(root, LIST), "utf8"));
} catch (error) {
  fail(`cannot read ${LIST}:`, [error.message]);
}
if (published.version !== 1) fail(`${LIST}:`, ['"version" must be 1']);

// Rotli grants by webview label, never by window: a window-wide grant reaches
// every child webview, guest pages included (check:security pins the same for
// the default capability).
const labels = new Set();
const capabilityDir = join(root, "src-tauri/capabilities");
for (const name of readdirSync(capabilityDir)) {
  if (!name.endsWith(".json")) fail("capabilities must be JSON files this check can read:", [name]);
  const capability = JSON.parse(readFileSync(join(capabilityDir, name), "utf8"));
  if (capability.windows) fail("grant by webview label, never by window:", [`${name} targets windows`]);
  for (const label of capability.webviews ?? []) labels.add(label);
}

/** The published `key` is exactly `actual`, sorted, each name once. */
function matchList(key, actual, absent) {
  const listed = published[key];
  if (!Array.isArray(listed)) fail(`${LIST}:`, [`"${key}" must be an array`]);
  const drift = [
    ...Array.from(actual)
      .filter((name) => !listed.includes(name))
      .map((name) => `missing from app-commands.json: ${name}`),
    ...listed.filter((name) => !actual.has(name)).map((name) => `${absent}: ${name}`),
  ];
  if (drift.length) fail(`${LIST} "${key}" has drifted:`, drift);
  const misplaced = listed.find((name, i) => i > 0 && !(listed[i - 1] < name));
  if (misplaced) fail(`${LIST}:`, [`${key} must be sorted, each once (see ${misplaced})`]);
}
matchList("commands", registered, "listed but not registered");
matchList("webviews", labels, "listed but in no capability");

const sourceFiles = walk(join(root, "src"), /\.tsx?$/);

const calls = new Map();
const callPattern =
  /\b(?:invoke|corpusInvoke|aiInvoke|memexInvoke)\s*(?:<[^;\n(]+>)?\s*\(\s*["']([a-zA-Z0-9_]+)["']/g;
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
  console.error(
    `IPC contract check failed — frontend commands missing Rust handlers:\n${missing.map((line) => `  - ${line}`).join("\n")}`,
  );
  process.exit(1);
}

// The reverse direction (quality-guards audit 2026-09-23 §3.1): a registered
// command nothing in src/ calls is webview-reachable surface with no user —
// memex_read read any vault file, secure notes included, for no caller until
// 2026-11-11. These are the ones registered with no caller when this check
// was added; the list may only shrink. Wire a new command up, or don't
// register it.
const UNCALLED_BASELINE = new Set([
  "corpus_add_folder",
  "corpus_forget_folder",
  "corpus_new_file_bytes",
  "corpus_set_field",
  "generate_image", // the AI host answers "unavailable" instead (src/ai/host.ts)
  "local_model_default",
  "local_queue_status",
]);
const uncalled = [...registered].filter((command) => !calls.has(command));
const newlyUncalled = uncalled.filter((command) => !UNCALLED_BASELINE.has(command));
const stale = [...UNCALLED_BASELINE].filter((command) => !uncalled.includes(command));
if (newlyUncalled.length || stale.length) {
  console.error(
    [
      ...(newlyUncalled.length
        ? [
            "IPC contract check failed — registered Rust commands nothing in src/ calls (remove the registration, or call it):",
            ...newlyUncalled.map((name) => `  - ${name}`),
          ]
        : []),
      ...(stale.length
        ? [
            "IPC contract check failed — UNCALLED_BASELINE lists commands that are now called or gone; delete them from the list:",
            ...stale.map((name) => `  - ${name}`),
          ]
        : []),
    ].join("\n"),
  );
  process.exit(1);
}

console.log(
  `check:ipc ok — ${calls.size} frontend commands resolve to ${registered.size} registered Rust handlers; ${uncalled.length} registered without a caller (baseline, may only shrink); ${LIST} matches the handler and the capabilities`,
);
