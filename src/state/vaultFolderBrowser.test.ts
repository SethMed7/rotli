import { describe, expect, test } from "bun:test";

import {
  completeVaultFolderRequest,
  requestVaultFolder,
  useVaultFolderBrowserStore,
} from "./vaultFolderBrowser";

const request = () =>
  requestVaultFolder({
    title: "Choose a vault",
    description: "Pick one folder.",
    actionLabel: "Choose",
    requireEmpty: false,
  });

describe("vault folder browser request ownership", () => {
  test("a newer request settles the previous caller as cancelled", async () => {
    const first = request();
    const second = request();
    expect(await first).toBeNull();
    const pending = useVaultFolderBrowserStore.getState().pending;
    expect(pending).not.toBeNull();
    completeVaultFolderRequest(pending!.id, "/Users/example/Desktop/memex");
    expect(await second).toBe("/Users/example/Desktop/memex");
  });

  test("a stale completion cannot settle the active caller", async () => {
    const active = request();
    const pending = useVaultFolderBrowserStore.getState().pending!;
    completeVaultFolderRequest(pending.id - 1, "/wrong");
    expect(useVaultFolderBrowserStore.getState().pending?.id).toBe(pending.id);
    completeVaultFolderRequest(pending.id, null);
    expect(await active).toBeNull();
  });
});
