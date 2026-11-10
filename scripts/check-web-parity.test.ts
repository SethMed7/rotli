import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parityViolations, registeredCommands } from "./check-web-parity.mjs";

const registry = (entries: string) => `.invoke_handler(tauri::generate_handler![${entries}])`;
const group = () => ({
  id: "example-notes",
  status: "web",
  reason: "The connected folder implements the note action.",
  sources: ["src/example.ts"],
  tests: ["e2e/example.spec.ts"],
  commands: ["corpus_read"],
});
const inventory = () => ({ version: 1, groups: [group()] });
const commands = ["corpus_read"];
const exists = () => true;

const fixture = mkdtempSync(join(tmpdir(), "rotli-web-parity-"));
afterAll(() => rmSync(fixture, { recursive: true, force: true }));

describe("native command registry extraction", () => {
  test("reads namespaced commands and ignores comments rather than inventing commands", () => {
    expect(
      registeredCommands(registry("corpus::corpus_read, /* stale_name, */\n// old_name,\nopen_url,")),
    ).toEqual(["corpus_read", "open_url"]);
  });
  test("refuses missing, ambiguous, empty, dynamic, and duplicate registries", () => {
    for (const source of [
      "no handler",
      registry("corpus_read") + registry("open_url"),
      registry(""),
      registry("corpus_read,,open_url"),
      registry("new_commands!()"),
      registry("corpus_read,corpus::corpus_read"),
    ])
      expect(() => registeredCommands(source)).toThrow();
  });
});

describe("explicit web command dispositions", () => {
  test("accepts each existing disposition with its reason and evidence paths", () => {
    for (const status of ["web", "notice", "mac-only"]) {
      const value = inventory();
      value.groups[0]!.status = status;
      expect(parityViolations(commands, value, exists)).toEqual([]);
    }
  });
  test("a newly registered command fails until it has a literal decision", () => {
    expect(parityViolations([...commands, "new_native_command"], inventory(), exists)).toEqual([
      "unclassified native command: new_native_command",
    ]);
  });
  test("removed commands and prefix wildcards cannot remain in the inventory", () => {
    const value = inventory();
    value.groups[0]!.commands.push("removed_command", "corpus_*");
    expect(parityViolations(commands, value, exists)).toEqual([
      "stale or unknown command classification: removed_command",
      "stale or unknown command classification: corpus_*",
    ]);
  });
  test("one command cannot have conflicting dispositions, even in different groups", () => {
    const value = inventory();
    value.groups.push({ ...group(), id: "another-group", status: "mac-only" });
    expect(parityViolations(commands, value, exists)).toEqual([
      "duplicate command classification: corpus_read",
    ]);
  });
  test("duplicate groups and repeated commands within a group fail", () => {
    const value = inventory();
    value.groups.push(group());
    expect(parityViolations(commands, value, exists)).toContain("duplicate inventory group: example-notes");
    value.groups = [group()];
    value.groups[0]!.commands.push("corpus_read");
    expect(parityViolations(commands, value, exists)).toContain(
      "duplicate command classification: corpus_read",
    );
  });
  test("unknown schemas and malformed groups fail closed", () => {
    for (const value of [null, [], {}, { version: 2, groups: [] }, { version: 1, groups: null }])
      expect(parityViolations(commands, value, exists)).toHaveLength(1);
    expect(parityViolations(commands, { version: 1, groups: [null] }, exists)).toContain(
      "inventory group must be an object",
    );
    expect(parityViolations(commands, { version: 1, groups: [] }, exists)).toEqual([
      "unclassified native command: corpus_read",
    ]);
  });
  test("every group needs a valid name, disposition, explanation, and commands", () => {
    const value = inventory();
    Object.assign(value.groups[0]!, { id: "Invalid Group", status: "planned", reason: " ", commands: [] });
    expect(parityViolations(commands, value, exists)).toHaveLength(5);
  });
  test("sources and tests must exist and cannot escape the repository or name a whole tree", () => {
    for (const path of ["src/missing.ts", "../private.md", "src/../private.md", "src/", "src\\file.ts"])
      expect(
        parityViolations(
          commands,
          { version: 1, groups: [{ ...group(), sources: [path] }] },
          (file: string) => file.startsWith("e2e/"),
        ),
      ).toHaveLength(1);
    const value = inventory();
    Object.assign(value.groups[0]!, { sources: [], tests: null });
    expect(parityViolations(commands, value, exists)).toHaveLength(2);
  });
  test("the checked-in inventory covers the real registry and all its references exist", async () => {
    const rust = await Bun.file(new URL("../src-tauri/src/lib.rs", import.meta.url)).text();
    const value = await Bun.file(new URL("./web-command-parity.json", import.meta.url)).json();
    expect(
      parityViolations(registeredCommands(rust), value, (path: string) => Bun.file(path).size > 0),
    ).toEqual([]);
  });
});

test("the CLI rejects a new native handler and succeeds after its decision is added", () => {
  for (const path of ["src-tauri/src", "scripts", "src", "e2e"])
    mkdirSync(join(fixture, path), { recursive: true });
  writeFileSync(join(fixture, "src-tauri/src/lib.rs"), registry("corpus_read,new_native_command"));
  writeFileSync(join(fixture, "src/example.ts"), "export const example = true;\n");
  writeFileSync(join(fixture, "e2e/example.spec.ts"), "// Synthetic reference.\n");
  const path = join(fixture, "scripts/web-command-parity.json");
  writeFileSync(path, JSON.stringify(inventory()));
  const run = () =>
    Bun.spawnSync([process.execPath, join(import.meta.dir, "check-web-parity.mjs")], {
      env: { ...process.env, ROTLI_CHECK_ROOT: fixture },
      stdout: "pipe",
      stderr: "pipe",
    });
  const rejected = run();
  expect(rejected.exitCode).toBe(1);
  expect(rejected.stderr.toString()).toContain("unclassified native command: new_native_command");
  const value = JSON.parse(readFileSync(path, "utf8"));
  value.groups[0].commands.push("new_native_command");
  writeFileSync(path, JSON.stringify(value));
  const accepted = run();
  expect(accepted.exitCode).toBe(0);
  expect(accepted.stdout.toString()).toContain("2 native commands classified (2 web, 0 notice, 0 Mac-only)");
});
