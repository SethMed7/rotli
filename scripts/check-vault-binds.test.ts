import { describe, expect, test } from "bun:test";

import { bindCalls, CATEGORIES, SINKS, SOURCES, vaultBindFailures } from "./check-vault-binds.mjs";

const rust = (path: string, source: string) => ({ path, source });

describe("check:vault-binds", () => {
  test("a binding call with no reason fails, naming the function it sits in", () => {
    const source =
      "fn sneak(app: &AppHandle) {\n    let s = corpus::CorpusStore::open(corpus::resolve_corpus(app));\n}\n";
    const failures = vaultBindFailures([rust("src-tauri/src/lib.rs", source)], {});
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("lib.rs:2: CorpusStore::open(…) in fn sneak");
  });

  test("each kind of sink is found: a path, a method, Self:: in its type's file, a bare call in its module", () => {
    expect(bindCalls("fn a() {\n    x.allow_directory(&root, true);\n}\n", "lib.rs")[0].sink).toBe(
      ".allow_directory",
    );
    expect(bindCalls("fn a() {\n    Self::open_target(root)\n}\n", "workspace.rs")[0].sink).toBe(
      "Workspace::open_target",
    );
    expect(bindCalls("fn a() {\n    Self::open_target(root)\n}\n", "corpus.rs")).toHaveLength(0);
    expect(bindCalls("fn a() {\n    claim_for(id, &root)?;\n}\n", "app_identity.rs")[0].sink).toBe(
      "app_identity::claim_for",
    );
    expect(bindCalls("fn a() {\n    claim(window, position)\n}\n", "native_drag.rs")).toHaveLength(0);
    expect(bindCalls("fn a() {\n    self.relocate(id, &rel, &to)\n}\n", "corpus.rs")).toHaveLength(0);
    expect(
      bindCalls("fn a() {\n    crate::activate_vault_path_live(app, root, false)\n}\n", "vault_import.rs")[0]
        .sink,
    ).toBe("lib::activate_vault_path_live");
    expect(SINKS.every((sink) => /^(?:\.\w+|\w+::\w+)$/.test(sink))).toBe(true);
  });

  test("refused and delegated are checked, not only counted", () => {
    const refused = (body: string) =>
      bindCalls(
        `fn pick(app: &AppHandle, abs: &Path) {\n${body}    corpus::add_folder(app, abs) // vault bind (refused): above\n}\n`,
        "lib.rs",
      )[0];
    expect(refused("").problem).toContain("nothing in fn pick refuses");
    expect(refused("    // reject_privileged_root(app, abs)?;\n").problem).toContain(
      "nothing in fn pick refuses",
    );
    expect(refused("    reject_privileged_root(app, abs)?;\n").problem).toBeNull();
    const delegated = (name: string) =>
      bindCalls(
        `fn ${name}(root: PathBuf) {\n    CorpusStore::open(root) // vault bind (delegated): callers\n}\n`,
        "lib.rs",
      )[0].problem;
    expect(delegated("open_target")).toBeNull();
    expect(delegated("helper")).toContain("not in scripts/check-vault-binds.mjs SINKS or SOURCES");
  });

  test("a registry read is a source: unmarked it fails, live is checked, and refused may follow the read", () => {
    const write =
      'fn sneak(app: &AppHandle) {\n    fs::write(corpus::ensure_corpus_config(app).corpus.abs_path.join("x"), "");\n}\n';
    expect(vaultBindFailures([rust("src-tauri/src/lib.rs", write)], {})[0]).toContain(
      "corpus::ensure_corpus_config(…) in fn sneak",
    );
    const read = (body: string) =>
      bindCalls(
        `fn pick(app: &AppHandle) {\n    let p = corpus::resolve_corpus(app); // vault bind (live): open\n${body}}\n`,
        "lib.rs",
      )[0].problem;
    expect(read("")).toContain("marked live, but fn pick");
    expect(read("    let p = host_registry::live_root(app, DEFAULT_ROOT_ID, Some(p));\n")).toBeNull();
    const target = (body: string) =>
      bindCalls(
        `fn switch(app: &AppHandle) {\n    let c = corpus::ensure_corpus_config(app); // vault bind (refused): below\n${body}}\n`,
        "lib.rs",
      )[0].problem;
    expect(target("")).toContain("refuses the path it reads");
    expect(target("    reject_privileged_root(app, &c.corpus.abs_path)?;\n")).toBeNull();
    expect(SOURCES).toContain("corpus::read_corpus_config");
  });

  test("a marker covers only its own call: on the line, or in the comments right above", () => {
    const source =
      "fn launch() {\n    // vault bind (vetted): the vetted registry\n    let a = CorpusStore::open(x);\n    let b = CorpusStore::open(y);\n}\n";
    expect(bindCalls(source, "lib.rs").map((call) => call.category)).toEqual(["vetted", null]);
  });

  test("marked binds count against the file's grant per category, both ways, and tests are out of scope", () => {
    const source = "fn launch() {\n    CorpusStore::open(x) // vault bind (vetted): the vetted registry\n}\n";
    const files = [
      rust("src-tauri/src/lib.rs", source),
      rust("src-tauri/src/lib_tests.rs", "fn t() {\n    CorpusStore::open(x);\n}\n"),
    ];
    expect(vaultBindFailures(files, { "lib.rs": { vetted: 1 } })).toEqual([]);
    expect(vaultBindFailures(files, {})[0]).toContain("grants 0");
    expect(vaultBindFailures(files, { "lib.rs": { vetted: 2 } })[0]).toContain("lower it");
    expect(Object.keys(CATEGORIES)).toContain("standalone");
  });
});
