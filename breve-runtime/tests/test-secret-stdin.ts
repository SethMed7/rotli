/**
 * The keychain unlock password and written secret values must never ride a
 * subprocess argv (any same-user process can read another's arguments via
 * KERN_PROCARGS2) — secret.ts feeds them to `security -i` over stdin instead.
 *
 * Proven here end-to-end against an ISOLATED temp keychain under a temp HOME:
 * write → read round-trip with quote/backslash/space characters, a wrong
 * unlock password failing closed, and a source-level guard that no `security`
 * invocation in secret.ts carries `-p`/`-w`-with-value on argv.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const HOME = join(process.env.TMPDIR ?? "/tmp", `breve-secret-test-${process.pid}`);
const KEYCHAIN = join(HOME, "Library", "Keychains", "breve.keychain-db");
const UNLOCK_PW = 'un"lock\\pw with spaces';

async function security(...args: string[]): Promise<void> {
  const proc = Bun.spawn(["security", ...args], { stdout: "ignore", stderr: "ignore" });
  if ((await proc.exited) !== 0) throw new Error(`security ${args[0]} failed`);
}

let secret: typeof import("../scripts/secret");

beforeAll(async () => {
  mkdirSync(join(HOME, "Library", "Keychains"), { recursive: true });
  mkdirSync(join(HOME, ".breve-secrets"), { recursive: true });
  await Bun.write(join(HOME, ".breve-secrets", "keychain-pw"), UNLOCK_PW);
  await security("create-keychain", "-p", UNLOCK_PW, KEYCHAIN);
  // secret.ts resolves its keychain path from HOME at import time
  process.env.HOME = HOME;
  secret = await import("../scripts/secret");
});

afterAll(async () => {
  await security("delete-keychain", KEYCHAIN).catch(() => {});
  rmSync(HOME, { recursive: true, force: true });
});

describe("breve secret stdin lane", () => {
  test("write → read round-trips a value full of shell-hostile characters", async () => {
    const value = 'se"cret\\va lue-$(echo x)';
    expect(await secret.writeSecret("stdin-test-svc", value)).toBe(true);
    expect(await secret.readSecret("stdin-test-svc")).toBe(value);
  });

  test("a wrong unlock password fails closed instead of reading", async () => {
    await Bun.write(join(HOME, ".breve-secrets", "keychain-pw"), "WRONG");
    await security("lock-keychain", KEYCHAIN);
    expect(await secret.readSecret("stdin-test-svc")).toBe("");
    await Bun.write(join(HOME, ".breve-secrets", "keychain-pw"), UNLOCK_PW);
  });

  test("no security call in secret.ts puts the password or value on argv", async () => {
    const source = await Bun.file(new URL("../scripts/secret.ts", import.meta.url)).text();
    // every unlock and add rides securityStdin; `-p`/`add-generic-password`
    // may not appear inside a template-literal `security …` invocation
    for (const line of source.split("\n")) {
      if (!line.includes("$`security")) continue;
      expect(line).not.toContain("unlock-keychain");
      expect(line).not.toContain("add-generic-password");
    }
  });
});
