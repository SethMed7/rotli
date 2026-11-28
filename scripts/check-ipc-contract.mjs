import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.env.ROTLI_CHECK_ROOT ?? process.cwd();

function fail(heading, lines) {
  console.error([`IPC contract check failed — ${heading}`, ...lines.map((line) => `  - ${line}`)].join("\n"));
  process.exit(1);
}

function walk(dir, pattern, found = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, pattern, found);
    else if (pattern.test(name)) found.push(path);
  }
  return found;
}

/** Rust with comments dropped and string contents emptied, so that neither can
 *  pass for code or cut a match short. */
function rustCode(source) {
  return source.replace(
    /\/\/[^\n]*|\/\*[\s\S]*?\*\/|r(#*)"[\s\S]*?"\1|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[^'\n]+|[^'\\\n])'/gu,
    (token) => (token.startsWith("/") ? " " : token.startsWith("'") ? "' '" : '""'),
  );
}

const rustFiles = walk(join(root, "src-tauri/src"), /\.rs$/).map((file) => ({
  file: relative(root, file),
  code: rustCode(readFileSync(file, "utf8")),
}));

// Rotli streams to the webview only through EventChannel, which keeps every
// message small. No other file may name Tauri's channel types.
const CHANNEL_HOME = "src-tauri/src/event_channel.rs";
const channelUsers = rustFiles
  .filter(
    ({ file, code }) =>
      file !== CHANNEL_HOME && /\b(?:Channel|JavaScriptChannelId|InvokeResponseBody)\b/.test(code),
  )
  .map(({ file }) => file);
if (channelUsers.length) {
  fail(`stream to the webview through EventChannel (${CHANNEL_HOME}), never Tauri's channel:`, channelUsers);
}

// Tauri keeps only the last handler a builder is given, so a second one would
// replace the list this check reads.
const handlers = rustFiles.flatMap(({ file, code }) =>
  Array.from(code.matchAll(/\binvoke_handler\s*\(/g), () => file),
);
if (handlers.length !== 1) {
  fail("expected exactly one .invoke_handler( in src-tauri/src, found:", [
    String(handlers.length),
    ...handlers,
  ]);
}

const lib = rustCode(readFileSync(join(root, "src-tauri/src/lib.rs"), "utf8"));
const handlerBlock = lib.match(/\.invoke_handler\(tauri::generate_handler!\[([\s\S]*?)\]\)/)?.[1];

if (!handlerBlock) {
  console.error("IPC contract check failed: could not find Tauri generate_handler! registry");
  process.exit(1);
}

const entries = handlerBlock
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);
const unreadable = entries.filter((entry) => !/^(\w+::)*\w+$/.test(entry));
if (unreadable.length) {
  fail("cannot read a command name from these generate_handler! entries (plain paths only):", unreadable);
}
const registered = new Set(entries.map((entry) => entry.split("::").at(-1)));

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

// A host build reads this list to scope Rotli's commands to Rotli's webviews
// (docs/architecture/host-seams.md, "Scoping Rotli's commands"). Once it does,
// Tauri refuses every command the list lacks, Rotli's own windows included.
const LIST = "src-tauri/app-commands.json";

const renamed = rustFiles.filter(({ code }) => /#\[[^\]]*\bcommand\([^\]]*\brename\s*=/.test(code));
if (renamed.length) {
  fail(
    `a #[command(rename = …)] renames a command, so ${LIST} would name the wrong one:`,
    renamed.map(({ file }) => file),
  );
}

let published;
try {
  published = JSON.parse(readFileSync(join(root, LIST), "utf8"));
} catch (error) {
  fail(`cannot read ${LIST}:`, [error.message]);
}
if (published.version !== 1) fail(`${LIST}:`, ['"version" must be 1']);

// Every label a capability names is published, and a host grants each published
// label every app command. So a capability is read in full or refused.
// Tauri reads `capabilities/**/*`: .json and .toml (.json5 with a feature),
// holding one capability or a list. Only one JSON capability a file is read here.
const labels = new Map();
const capabilityDir = join(root, "src-tauri/capabilities");
for (const file of walk(capabilityDir, /\.(json5?|toml)$/)) {
  const name = relative(capabilityDir, file);
  const capability = name.endsWith(".json") ? JSON.parse(readFileSync(file, "utf8")) : null;
  if (typeof capability?.identifier !== "string") {
    fail("capabilities:", [`${name} is not one JSON capability, the only shape this check reads`]);
  }
  // by webview label, never by window: a window-wide grant reaches every child
  // webview, guest pages included
  if (capability.windows) fail("grant by webview label, never by window:", [`${name} targets windows`]);
  if (capability.remote) fail("a published label gets every command:", [`${name} grants remote pages`]);
  for (const label of capability.webviews ?? []) labels.set(label, name);
}

// A capability written inline in a Tauri config would be granted without
// reaching the list. Rotli writes none.
for (const name of readdirSync(join(root, "src-tauri"))) {
  if (!/^tauri(\..+)?\.conf\.json$/.test(name)) continue;
  const config = JSON.parse(readFileSync(join(root, "src-tauri", name), "utf8"));
  if (config.app?.security?.capabilities?.some((entry) => typeof entry !== "string")) {
    fail("capabilities belong in src-tauri/capabilities/:", [`${name} writes a capability inline`]);
  }
}

// Tauri reads a label as a glob pattern, and `*` here would hand every command
// to every local webview. Exact labels and Rotli's folder windows only.
const FOLDER_WINDOWS = "finder_*";
const broad = (label) => label !== FOLDER_WINDOWS && !/^[\w:/-]+$/.test(label);
const tooBroad = [
  ...Array.from(labels)
    .filter(([label]) => broad(label))
    .map(([label, name]) => `${label} in ${name}`),
  ...[published.webviews ?? []]
    .flat()
    .filter(broad)
    .map((label) => `${label} in app-commands.json`),
];
if (tooBroad.length) {
  fail(`only exact labels and ${FOLDER_WINDOWS} may be granted every command:`, tooBroad);
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
matchList("webviews", new Set(labels.keys()), "listed but in no capability");

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
