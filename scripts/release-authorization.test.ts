import { expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const source = readFileSync(new URL("release.sh", import.meta.url), "utf8");
const sha = "a".repeat(40);

function attempt(arguments_: string[], owner = "SethMed7", conclusion = "failure") {
  const root = mkdtempSync(join(tmpdir(), "rotli-release-authorization-"));
  try {
    mkdirSync(join(root, "scripts"));
    mkdirSync(join(root, "bin"));
    writeFileSync(join(root, "scripts/release.sh"), source);
    const executable = (name: string, content: string) =>
      writeFileSync(join(root, "bin", name), content, { mode: 0o700 });
    executable(
      "git",
      `#!/bin/sh\ncase "$1" in\n status|fetch|merge-base) exit 0 ;;\n rev-parse) printf '%s\\n' '${sha}' ;;\n *) exit 1 ;;\nesac\n`,
    );
    executable(
      "gh",
      `#!/bin/sh\ncase "$1" in\n api) printf '%s\\n' '${owner}' ;;\n run) printf '%s\\n' '[{"headSha":"${sha}","status":"completed","conclusion":"${conclusion}","url":"https://github.com/SethMed7/rotli/actions/runs/1"}]' ;;\n *) exit 1 ;;\nesac\n`,
    );
    for (const name of ["bun", "codesign", "xcrun"])
      executable(name, "#!/bin/sh\ntouch signing-side-effect\nexit 97\n");
    const result = spawnSync("bash", [join(root, "scripts/release.sh"), ...arguments_], {
      cwd: root,
      encoding: "utf8",
      env: {
        PATH: `${join(root, "bin")}:${process.env.PATH}`,
        APPLE_SIGNING_IDENTITY: "synthetic-test-identity",
        ROTLI_UPDATER_KEY: join(root, "nonexistent.key"),
        ROTLI_RELEASE_ALLOW_RED: "1",
      },
    });
    return {
      status: result.status,
      output: result.stdout + result.stderr,
      touchedSigning: existsSync(join(root, "signing-side-effect")),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("signing and notarization require explicit authorization for the exact commit", () => {
  for (const args of [[], ["--publish"], [`--authorize=${"b".repeat(40)}`], ["--unknown"]]) {
    const result = attempt(args);
    expect(result.status).toBe(1);
    expect(result.touchedSigning).toBe(false);
  }
});

test("a non-owner cannot operate signing even with the correct source SHA", () => {
  const result = attempt([`--authorize=${sha}`], "contributor");
  expect(result.status).toBe(1);
  expect(result.output).toContain("only the repository owner");
  expect(result.touchedSigning).toBe(false);
});

test("red hosted CI refuses before signing even if the retired override is set", () => {
  const result = attempt([`--authorize=${sha}`]);
  expect(result.status).toBe(1);
  expect(result.output).toContain("refusing signing, notarization, and publication");
  expect(result.touchedSigning).toBe(false);
});

test("release shell parses and both notary logs stay out of the public artifact set", () => {
  execFileSync("bash", ["-n", "scripts/release.sh"]);
  expect(source).toContain('NOTARY_RECORDS="_review/release-notary/$SOURCE_COMMIT"');
  expect(source).toContain('notarize "$ZIP" app');
  expect(source).toContain('notarize "$DMG" dmg');
  expect(source).not.toContain('--artifact "$NOTARY_RECORDS');
  expect(source).toContain("export ROTLI_BUILD_CHANNEL=stable");
});
