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

  test("a marked read counts against the file's allowlist, both ways", () => {
    const source =
      "fn cfg() {\n    // raw read: app config outside any vault\n    let t = fs::read_to_string(p);\n}\n";
    expect(vaultReadFailures([file("src-tauri/src/app.rs", source)], { "app.rs": 1 })).toEqual([]);
    expect(vaultReadFailures([file("src-tauri/src/app.rs", source)], {})[0]).toContain("grants 0");
    expect(vaultReadFailures([file("src-tauri/src/app.rs", source)], { "app.rs": 2 })[0]).toContain(
      "lower it",
    );
    expect(rawReads("fn f() {\n    // raw read:\n    fs::read(p);\n}\n")[0]?.marked).toBe(false);
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
