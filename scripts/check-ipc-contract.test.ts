// check:ipc also owns src-tauri/app-commands.json, the list a host build reads
// to scope Rotli's commands to Rotli's webviews (docs/architecture/
// host-seams.md). A list that drifts from the handler either breaks Rotli
// under the host or leaves a command out of its review.
import { describe, expect, test } from "bun:test";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

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
  const configs = readdirSync(join(repo, "src-tauri"))
    .filter((name) => /^tauri(\..+)?\.conf\.json$/.test(name))
    .map((name) => `src-tauri/${name}`);
  for (const path of ["src-tauri/src", "src-tauri/capabilities", LIST, ...configs]) {
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

function addCapability(root: string, file: string, content: unknown) {
  const target = join(root, "src-tauri/capabilities", file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(content));
}

const guest = (webviews: string[], more: object = {}) => ({
  identifier: "extra",
  webviews,
  permissions: ["core:event:default"],
  ...more,
});

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

  test("a comment that looks like a rename, or closes the handler, changes nothing", () => {
    const root = tree();
    edit(root, LIB, (s) =>
      s
        .replace(
          "generate_handler![",
          "generate_handler![\n            // ends here ])\n            /* a, b ]) */",
        )
        .concat(
          '\n/// #[tauri::command(rename = "x")]\n/* #[command(rename = "y")] */\nfn documented() {}\n',
        ),
    );
    const r = check(root);
    expect(r.out).toContain("check:ipc ok");
    expect(r.code).toBe(0);
  });

  // Tauri keeps the last handler set, so a second one would replace the list
  test("a second invoke_handler fails", () => {
    const root = tree();
    edit(
      root,
      LIB,
      (s) => `${s}\nfn later(b: B) -> B { b.invoke_handler(tauri::generate_handler![summon]) }\n`,
    );
    const r = check(root);
    expect(r.code).toBe(1);
    expect(r.out).toContain("exactly one .invoke_handler(");
  });

  // the gate that predates the list: a rewrite of this check once dropped it
  // with every other test still green (review of PR 338)
  test("a single-word command name fails, listed or not", () => {
    const root = tree();
    edit(root, LIB, (s) => s.replace("generate_handler![", "generate_handler![\n            singleword,"));
    editList(root, (list) => (list.commands = [...list.commands, "singleword"].sort()));
    const r = check(root);
    expect(r.code).toBe(1);
    expect(r.out).toContain("multi-segment snake_case:\n  - singleword");
  });
});

describe("check:ipc — the front end and the handler", () => {
  test("a command the front end calls but nothing registers fails", () => {
    const root = tree();
    edit(root, LIB, (s) => s.replace(/\n\s*corpus::corpus_read,/, ""));
    editList(root, (list) => (list.commands = list.commands.filter((c) => c !== "corpus_read")));
    const r = check(root);
    expect(r.code).toBe(1);
    expect(r.out).toContain("frontend commands missing Rust handlers");
  });

  test("a registered command nothing calls fails", () => {
    const root = tree();
    edit(root, LIB, (s) =>
      s.replace("generate_handler![", "generate_handler![\n            nobody_calls_this,"),
    );
    editList(root, (list) => (list.commands = [...list.commands, "nobody_calls_this"].sort()));
    const r = check(root);
    expect(r.code).toBe(1);
    expect(r.out).toContain("registered Rust commands nothing in src/ calls");
  });
});

describe("check:ipc — the rest of its refusals", () => {
  test("a handler that is not a generate_handler! list fails", () => {
    const root = tree();
    edit(root, LIB, (s) =>
      s.replace(".invoke_handler(tauri::generate_handler![", ".invoke_handler(handlers(generate!["),
    );
    const r = check(root);
    expect(r.code).toBe(1);
    expect(r.out).toContain("could not find Tauri generate_handler! registry");
  });

  test("a list that is not an array fails", () => {
    const root = tree();
    edit(root, LIST, (source) =>
      JSON.stringify({ ...(JSON.parse(source) as AppCommands), webviews: "main" }),
    );
    const r = check(root);
    expect(r.code).toBe(1);
    expect(r.out).toContain('"webviews" must be an array');
  });

  test("a Tauri channel named outside EventChannel fails, a comment doesn't", () => {
    const root = tree();
    edit(root, "src-tauri/src/chat.rs", (s) =>
      s.replace("on_token: crate::event_channel::EventChannel,", "on_token: tauri::ipc::Channel<String>,"),
    );
    const r = check(root);
    expect(r.code).toBe(1);
    expect(r.out).toContain("never Tauri's channel");
    expect(r.out).toContain("src-tauri/src/chat.rs");
    const clean = tree();
    edit(clean, "src-tauri/src/chat.rs", (s) => `// a tauri::ipc::Channel<String> in prose\n${s}`);
    expect(check(clean).code).toBe(0);
  });

  // the uncalled baseline may only shrink: a name that left it must be deleted
  test("an uncalled-baseline name that is now called fails", () => {
    const root = tree();
    rmSync(join(root, "src"));
    cpSync(join(repo, "src"), join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src/zzCaller.ts"), 'invoke("local_model_default");\n');
    const r = check(root);
    expect(r.code).toBe(1);
    expect(r.out).toContain("UNCALLED_BASELINE lists commands that are now called or gone");
  });
});

describe("check:ipc — which webviews the list may name", () => {
  // `*` in the list would hand every command to every local webview
  test("a wildcard label fails, whatever the capability is for", () => {
    const cases: [string, object][] = [
      ["*", {}],
      ["*", { remote: { urls: ["https://example.com"] } }],
      ["private-browser-*", {}],
      ["finder_?", {}],
      ["finder*", {}],
      ["[mq]ain", {}],
    ];
    for (const [label, more] of cases) {
      const root = tree();
      addCapability(root, "extra.json", guest([label], more));
      editList(root, (list) => (list.webviews = [...list.webviews, label].sort()));
      const r = check(root);
      expect(r.out).toContain("extra.json");
      expect(r.code).toBe(1);
    }
  });

  test("a wildcard typed straight into the list fails", () => {
    const root = tree();
    editList(root, (list) => (list.webviews = ["*", ...list.webviews]));
    const r = check(root);
    expect(r.code).toBe(1);
    expect(r.out).toContain("only exact labels and finder_*");
  });

  test("a capability for remote pages fails, even with an exact label", () => {
    const root = tree();
    addCapability(root, "extra.json", guest(["guest"], { remote: { urls: ["https://a.test"] } }));
    editList(root, (list) => (list.webviews = [...list.webviews, "guest"].sort()));
    const r = check(root);
    expect(r.out).toContain("extra.json grants remote pages");
    expect(r.code).toBe(1);
  });

  test("an unsorted webview list fails", () => {
    const root = tree();
    editList(root, (list) => list.webviews.reverse());
    expect(check(root).out).toContain("webviews must be sorted, each once");
  });

  // Tauri reads `capabilities/**/*`, in three JSON shapes and in TOML
  test("a capability file in a shape the check cannot read fails", () => {
    const wide = { identifier: "wide", windows: ["main"], permissions: [] };
    const cases: [string, unknown][] = [
      ["bundle.json", { capabilities: [wide] }],
      ["array.json", [wide]],
      ["wide.toml", wide],
      ["wide.json5", wide],
    ];
    for (const [file, content] of cases) {
      const root = tree();
      addCapability(root, file, content);
      const r = check(root);
      expect(r.out).toContain(`${file} is not one JSON capability`);
      expect(r.code).toBe(1);
    }
  });

  test("a capability in a nested folder is read; a file Tauri skips is ignored", () => {
    const nested = tree();
    addCapability(nested, "deep/er.json", { identifier: "deep", windows: ["main"] });
    expect(check(nested).out).toContain("deep/er.json targets windows");

    const stray = tree();
    addCapability(stray, ".DS_Store", "binary");
    expect(check(stray).code).toBe(0);
  });

  test("a capability written inline in a Tauri config fails", () => {
    for (const config of ["tauri.conf.json", "tauri.dev.conf.json"]) {
      const root = tree();
      edit(root, `src-tauri/${config}`, (source) => {
        const parsed = JSON.parse(source) as { app?: { security?: object } };
        parsed.app = {
          ...parsed.app,
          security: { ...parsed.app?.security, capabilities: [guest(["main"])] },
        } as { security?: object };
        return JSON.stringify(parsed);
      });
      const r = check(root);
      expect(r.out).toContain(`${config} writes a capability inline`);
      expect(r.code).toBe(1);
    }
  });
});
