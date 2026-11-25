import { expect, test } from "bun:test";

import { STANDALONE_IDENTIFIER } from "../lib/appIdentity";
import { pickVaultFolderAs } from "./service";

const HOST = "com.example.host";
const REFUSAL = "Host words for a vault.";

function deps(picked: string | null, isVault: boolean) {
  const inspected: string[] = [];
  return {
    inspected,
    deps: {
      pick: async () => picked,
      inspect: async (path: string) => {
        inspected.push(path);
        return { kind: isVault ? "memex" : "markdown" };
      },
      refusal: REFUSAL,
    },
  };
}

test("a host build refuses a picked folder Rotli already uses, before anything opens it", async () => {
  const { deps: d, inspected } = deps("/synthetic/vault", true);
  await expect(pickVaultFolderAs(HOST, "Choose", d)).rejects.toThrow(REFUSAL);
  expect(inspected).toEqual(["/synthetic/vault"]);
});

test("a host build keeps a plain folder and a cancelled panel", async () => {
  expect(await pickVaultFolderAs(HOST, "Choose", deps("/synthetic/plain", false).deps)).toBe(
    "/synthetic/plain",
  );
  const cancelled = deps(null, true);
  expect(await pickVaultFolderAs(HOST, "Choose", cancelled.deps)).toBeNull();
  expect(cancelled.inspected).toEqual([]);
});

test("the standalone build opens any vault and never inspects here", async () => {
  const { deps: d, inspected } = deps("/synthetic/vault", true);
  expect(await pickVaultFolderAs(STANDALONE_IDENTIFIER, "Choose", d)).toBe("/synthetic/vault");
  expect(inspected).toEqual([]);
});
