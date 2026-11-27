// check:ipc also owns src-tauri/app-commands.json, the list a host build reads
// to scope Rotli's commands to Rotli's webviews (docs/architecture/
// host-seams.md). A list that drifts from the handler either breaks Rotli
// under the host or leaves a command out of its review.
import { describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repo = join(import.meta.dir, "..");
const checker = join(import.meta.dir, "check-ipc-contract.mjs");
const LIB = "src-tauri/src/lib.rs";
const LIST = "src-tauri/app-commands.json";

type AppCommands = { version: number; commands: string[]; webviews: string[] };

/** The real tree, copied so a test can break one file of it. */
function tree(): string {
  const root = mkdtempSync(join(tmpdir(), "rotli-ipc-"));
  mkdirSync(join(root, "src-tauri"));
  symlinkSync(join(repo, "src"), join(root, "src"));
  for (const path of ["src-tauri/src", "src-tauri/capabilities", LIST]) {
    cpSync(join(repo, path), join(root, path), { recursive: true });
  }
  return root;
}

function edit(root: string, path: string, change: (source: string) => string) {
  const target = join(root, path);
  const before = readFileSync(target, "utf8");
  const after = change(before);
  expect(after).not.toBe(before);
  writeFileSync(target, after);
}

function editList(root: string, change: (list: AppCommands) => void) {
  edit(root, LIST, (source) => {
    const list = JSON.parse(source) as AppCommands;
    change(list);
    return JSON.stringify(list);
  });
}

function check(root: string) {
  const proc = Bun.spawnSync([process.execPath, checker], {
    env: { ...process.env, ROTLI_CHECK_ROOT: root },
  });
  rmSync(root, { recursive: true, force: true });
  return { code: proc.exitCode, out: proc.stdout.toString() + proc.stderr.toString() };
}

describe("check:ipc — the published command list", () => {
  test("the tree as committed passes", () => {
    const r = check(tree());
    expect(r.out).toContain("check:ipc ok");
    expect(r.code).toBe(0);
  });

  test("a command added to the handler but not the list fails", () => {
    const root = tree();
    edit(root, LIB, (s) =>
      s.replace("generate_handler![", "generate_handler![\n            corpus::corpus_fake_command,"),
    );
    const r = check(root);
    expect(r.code).toBe(1);
    expect(r.out).toContain("missing from app-commands.json: corpus_fake_command");
  });

  test("a command removed from the handler but still listed fails", () => {
    const root = tree();
    edit(root, LIB, (s) => s.replace(/\n\s*corpus::corpus_read,/, ""));
    const r = check(root);
    expect(r.code).toBe(1);
    expect(r.out).toContain("listed but not registered: corpus_read");
  });

  test("an unsorted or repeated list fails", () => {
    const unsorted = tree();
    editList(unsorted, (list) => list.commands.reverse());
    expect(check(unsorted).out).toContain("commands must be sorted, each once");

    const repeated = tree();
    editList(repeated, (list) => list.commands.splice(0, 0, list.commands[0] ?? ""));
    expect(check(repeated).out).toContain("commands must be sorted, each once");
  });

  test("an unknown version or a missing list fails", () => {
    const versioned = tree();
    editList(versioned, (list) => (list.version = 2));
    expect(check(versioned).out).toContain('"version" must be 1');

    const missing = tree();
    rmSync(join(missing, LIST));
    const r = check(missing);
    expect(r.code).toBe(1);
    expect(r.out).toContain("cannot read src-tauri/app-commands.json");
  });

  test("the webviews must be exactly the ones Rotli's capabilities name", () => {
    const dropped = tree();
    editList(dropped, (list) => (list.webviews = list.webviews.filter((l) => l !== "finder_*")));
    expect(check(dropped).out).toContain("missing from app-commands.json: finder_*");

    const extra = tree();
    editList(extra, (list) => (list.webviews = [...list.webviews, "zz_guest"]));
    expect(check(extra).out).toContain("listed but in no capability: zz_guest");
  });

  // A window-wide grant reaches every child webview of that window, a guest
  // page included, so the list cannot be trusted to name webviews alone.
  test("a capability that targets windows fails", () => {
    const root = tree();
    edit(root, "src-tauri/capabilities/folder-windows.json", (s) => s.replace('"webviews"', '"windows"'));
    const r = check(root);
    expect(r.code).toBe(1);
    expect(r.out).toContain("folder-windows.json targets windows");
  });

  test("a handler entry the checker cannot name fails closed", () => {
    const root = tree();
    edit(root, LIB, (s) =>
      s.replace(
        "generate_handler![",
        "generate_handler![\n            #[cfg(debug_assertions)]\n            summon,",
      ),
    );
    const r = check(root);
    expect(r.code).toBe(1);
    expect(r.out).toContain("cannot read a command name");
  });

  test("a comment with a comma inside the handler is not a command", () => {
    const root = tree();
    edit(root, LIB, (s) =>
      s.replace("generate_handler![", "generate_handler![\n            // first, then these"),
    );
    expect(check(root).code).toBe(0);
  });

  // `#[command(rename = "…")]` would register a name the handler list cannot show
  test("a renamed command fails", () => {
    const root = tree();
    edit(root, LIB, (s) => `${s}\n#[tauri::command(rename = "other_name")]\nfn renamed() {}\n`);
    const r = check(root);
    expect(r.code).toBe(1);
    expect(r.out).toContain("renames a command");
  });
});
