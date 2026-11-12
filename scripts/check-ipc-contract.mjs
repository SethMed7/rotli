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

// Command naming: multi-segment snake_case (`corpus_read`, `local_model_start`,
// `open_url`). 90/90 already complied when adopted (2026-07-18) — this blocks a
// camelCase or bare single-word command from entering the registry. The stricter
// known-domain-prefix variant was rejected: a curated domain list is a
// maintenance knob that must be edited for every new domain (see
// docs/development/adding-things.md, "Considered and rejected").
const IPC_COMMAND_NAME = /^[a-z0-9]+(_[a-z0-9]+)+$/;
// Grandfathered pre-rule names only — never add to this list for new commands.
const IPC_NAME_GRANDFATHERED = new Set([
  "summon", // the ⌥. quick-chat summon; shipped single-word before this rule
]);
const misnamed = [...registered].filter(
  (command) => !IPC_COMMAND_NAME.test(command) && !IPC_NAME_GRANDFATHERED.has(command),
);
if (misnamed.length) {
  console.error(
    `IPC contract check failed — command names must be multi-segment snake_case:\n${misnamed.map((name) => `  - ${name}`).join("\n")}`,
  );
  process.exit(1);
}

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
  `check:ipc ok — ${calls.size} frontend commands resolve to ${registered.size} registered Rust handlers; ${uncalled.length} registered without a caller (baseline, may only shrink)`,
);
