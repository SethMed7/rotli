import { describe, expect, test } from "bun:test";

import { productionLines, rawReads, testOnlyFiles, vaultReadFailures } from "./check-vault-reads.mjs";

const file = (path: string, source: string) => ({ path, source });

describe("check:vault-reads", () => {
  test("an unmarked raw read of a file's contents fails", () => {
    const failures = vaultReadFailures(
      [
        file(
          "src-tauri/src/organizer.rs",
          "fn snap(p: &Path) {\n    let t = std::fs::read_to_string(p);\n}\n",
        ),
      ],
      {},
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("organizer.rs:2");
  });

  test("every raw form is caught: fs::read, File::open, OpenOptions, tokio", () => {
    for (const call of [
      "fs::read(p)",
      "File::open(p)",
      "std::fs::OpenOptions::new()",
      "tokio::fs::read_to_string(p)",
    ]) {
      expect(rawReads(`fn f() {\n    let x = ${call};\n}\n`)).toHaveLength(1);
    }
    expect(rawReads("fn f() {\n    let x = fs::read_dir(p);\n}\n")).toHaveLength(0);
  });

  test("a marked read counts against the file's allowlist per category, both ways", () => {
    const source =
      "fn cfg() {\n    // raw read (outside-vault): app config outside any vault\n    let t = fs::read_to_string(p);\n}\n";
    const app = [file("src-tauri/src/app.rs", source)];
    expect(vaultReadFailures(app, { "app.rs": { "outside-vault": 1 } })).toEqual([]);
    expect(vaultReadFailures(app, {})[0]).toContain("grants 0");
    // the same count in another category is not a grant
    expect(vaultReadFailures(app, { "app.rs": { identity: 1 } })).toHaveLength(2);
    expect(vaultReadFailures(app, { "app.rs": { "outside-vault": 2 } })[0]).toContain("lower it");
  });

  // third review: only five reasons may keep a read raw; a content-bearing
  // sidecar ("Rotli's own vault sidecar") is no longer one
  test("a marker without one of the five categories is not a marker", () => {
    for (const marker of [
      "// raw read:",
      "// raw read: Rotli's own vault sidecar",
      "// raw read (sidecar): settings",
    ]) {
      expect(rawReads(`fn f() {\n    ${marker}\n    fs::read(p);\n}\n`)[0]?.marked).toBe(false);
    }
    expect(
      rawReads("fn f() {\n    // raw read (identity): memex.json\n    fs::read(p);\n}\n")[0]?.category,
    ).toBe("identity");
  });

  test("code built only for other platforms is out of scope", () => {
    const other = "#[cfg(not(unix))]\nfn open() {\n    fs::File::open(p);\n}\nfn mac() {}\n";
    expect(rawReads(other)).toEqual([]);
  });

  test("fsutil, test files, test modules, and test-only module files are out of scope", () => {
    const testModule = "fn f() {}\n#[cfg(test)]\nmod tests {\n    fn t() { fs::read(p); }\n}\n";
    expect(productionLines(testModule).join("\n")).not.toContain("fs::read");
    const parent = '#[cfg(test)]\n#[path = "evals.rs"]\nmod evals;\n';
    expect([...testOnlyFiles([parent])]).toEqual(["evals.rs"]);
    const read = "fn f() {\n    fs::read(p);\n}\n";
    expect(
      vaultReadFailures(
        [
          file("src-tauri/src/fsutil.rs", read),
          file("src-tauri/src/x_tests.rs", read),
          file("src-tauri/src/lib.rs", parent),
          file("src-tauri/src/evals.rs", read),
        ],
        {},
      ),
    ).toEqual([]);
  });
});
