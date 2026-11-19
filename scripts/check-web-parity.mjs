// Every native IPC command needs an explicit Rotli Web disposition. This is an
// inventory guard, not proof that a browser can reproduce native behavior.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const STATUSES = new Set(["web", "notice", "mac-only"]);

/** Parse the explicit registry, refusing unfamiliar syntax instead of silently
 * omitting an entry. Namespace prefixes are Rust details, not wire names. */
export function registeredCommands(source) {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const blocks = [
    ...stripped.matchAll(/\.invoke_handler\(\s*tauri::generate_handler!\s*\[([\s\S]*?)\]\s*\)/g),
  ];
  if (blocks.length !== 1) throw new Error("expected exactly one Tauri generate_handler! registry");
  const entries = blocks[0][1].split(",").map((entry) => entry.trim());
  if (entries.at(-1) === "") entries.pop();
  if (!entries.length || entries.some((entry) => !/^(?:[a-zA-Z_]\w*::)*[a-zA-Z_]\w*$/.test(entry)))
    throw new Error("unrecognized or empty Tauri registry entry; update the parity parser explicitly");
  const names = entries.map((entry) => entry.split("::").at(-1));
  if (new Set(names).size !== names.length) throw new Error("duplicate native command in Tauri registry");
  return names;
}

const text = (value) => typeof value === "string" && value.trim().length > 0;
const strings = (value) => Array.isArray(value) && value.length > 0 && value.every(text);
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** Coverage and schema validation. Each command must occur literally once;
 * there are no prefix/default classifications to absorb a future command. */
export function parityViolations(commands, inventory, fileExists) {
  if (!record(inventory) || inventory.version !== 1 || !Array.isArray(inventory.groups))
    return ["expected a version-1 web command inventory with groups"];
  const failures = [];
  const registered = new Set(commands);
  const classified = new Set();
  const ids = new Set();
  for (const group of inventory.groups) {
    if (!record(group)) {
      failures.push("inventory group must be an object");
      continue;
    }
    const id = group.id;
    if (!text(id) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) failures.push("invalid inventory group id");
    if (ids.has(id)) failures.push(`duplicate inventory group: ${id}`);
    ids.add(id);
    if (!STATUSES.has(group.status)) failures.push(`${id}: status must be web, notice, or mac-only`);
    if (!text(group.reason)) failures.push(`${id}: explain the existing web behavior or native boundary`);
    for (const field of ["sources", "tests"]) {
      if (!strings(group[field])) {
        failures.push(`${id}: ${field} must name at least one existing repository file`);
        continue;
      }
      for (const path of group[field]) {
        if (
          !/^(?:src|src-tauri|e2e)\//.test(path) ||
          /[\\#]/.test(path) ||
          path.split("/").some((part) => !part || part === "." || part === "..") ||
          !fileExists(path)
        )
          failures.push(`${id}: invalid or missing ${field} file: ${path}`);
      }
    }
    if (!strings(group.commands)) {
      failures.push(`${id}: commands must be a nonempty list of literal native command names`);
      continue;
    }
    for (const command of group.commands) {
      if (classified.has(command)) failures.push(`duplicate command classification: ${command}`);
      classified.add(command);
      if (!registered.has(command)) failures.push(`stale or unknown command classification: ${command}`);
    }
  }
  for (const command of registered) {
    if (!classified.has(command)) failures.push(`unclassified native command: ${command}`);
  }
  return failures;
}

if (import.meta.main) {
  const root = process.env.ROTLI_CHECK_ROOT ?? process.cwd();
  try {
    const commands = registeredCommands(readFileSync(join(root, "src-tauri/src/lib.rs"), "utf8"));
    const inventory = JSON.parse(readFileSync(join(root, "scripts/web-command-parity.json"), "utf8"));
    const failures = parityViolations(
      commands,
      inventory,
      (path) => existsSync(join(root, path)) && statSync(join(root, path)).isFile(),
    );
    if (failures.length) throw new Error(failures.join("\n  - "));
    const counts = { web: 0, notice: 0, "mac-only": 0 };
    for (const group of inventory.groups) counts[group.status] += group.commands.length;
    console.log(
      `check:web-parity ok — ${commands.length} native commands classified (${counts.web} web, ${counts.notice} notice, ${counts["mac-only"]} Mac-only); source and test references exist`,
    );
  } catch (error) {
    console.error(`check:web-parity failed:\n  - ${error.message}`);
    process.exit(1);
  }
}
