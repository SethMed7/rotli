import { expect, test } from "bun:test";

import { deviceVaultStore } from "../lib/browserVault";
import { registerWebHelperVaultId } from "../lib/webAiSeam";
import { useHelperLink } from "../state/helperLink";
import { useVaultConnection } from "../state/vaultConnection";
import { bridgeFor } from "./helperLink";

test("a Helper-road chat completion carries the page's bound vault id", async () => {
  const previousFetch = globalThis.fetch;
  const requests: Array<{ cmd: string; args: Record<string, unknown> }> = [];
  globalThis.fetch = async (_input, init) => {
    requests.push(JSON.parse(typeof init?.body === "string" ? init.body : ""));
    return new Response(JSON.stringify({ result: "reply" }), { status: 200 });
  };
  try {
    await deviceVaultStore().set(
      "vault-binding",
      JSON.stringify({
        kind: "helper",
        vaultId: "vault-a",
        vaultName: "A",
      }),
    );
    registerWebHelperVaultId("vault-a");
    useHelperLink.getState().setCompletionVaultBinding(true);
    useVaultConnection.getState().setConnection({ status: "connected", via: "helper", name: "A" });
    await bridgeFor({ port: 43111, token: "synthetic-token" })("cli_complete", {
      requestId: "chat-1",
      provider: "synthetic",
      model: "synthetic",
      prompt: "hello",
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.args.vaultId).toBe("vault-a");

    await deviceVaultStore().set(
      "vault-binding",
      JSON.stringify({ kind: "helper", vaultId: "vault-b", vaultName: "B" }),
    );
    await bridgeFor({ port: 43111, token: "synthetic-token" })("cli_complete", {
      requestId: "chat-still-a",
      provider: "synthetic",
      model: "synthetic",
      prompt: "hello",
    });
    expect(requests[1]?.args.vaultId).toBe("vault-a");

    registerWebHelperVaultId(null);
    useVaultConnection.getState().setConnection({ status: "connected", via: "folder", name: "Folder" });
    await bridgeFor({ port: 43111, token: "synthetic-token" })("cli_complete", {
      requestId: "chat-2",
      provider: "synthetic",
      model: "synthetic",
      prompt: "hello",
    });
    expect(requests[2]?.args.vaultId).toBeUndefined();
    expect(requests[2]?.args.vaultRoad).toBe("folder");
  } finally {
    registerWebHelperVaultId(null);
    useHelperLink.getState().setCompletionVaultBinding(false);
    await deviceVaultStore().delete("vault-binding");
    useVaultConnection.getState().setConnection({ status: "unbound" });
    globalThis.fetch = previousFetch;
  }
});

test("an older Helper cannot receive a Helper-road completion", async () => {
  registerWebHelperVaultId("vault-a");
  useHelperLink.getState().setCompletionVaultBinding(false);
  try {
    await expect(
      bridgeFor({ port: 43111, token: "synthetic-token" })("cli_complete", { prompt: "private" }),
    ).rejects.toThrow(/Update Rotli Helper/);
  } finally {
    registerWebHelperVaultId(null);
  }
});

test("a completion vault mismatch returns the page to setup", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    if (init?.method === undefined || init.method === "GET")
      return new Response(JSON.stringify({ ok: true, name: "rotli-helper", version: "synthetic" }), {
        status: 200,
      });
    const request = JSON.parse(typeof init?.body === "string" ? init.body : "");
    if (request.cmd === "cli_complete")
      return new Response(JSON.stringify({ error: "vault changed: another folder" }), { status: 409 });
    if (request.cmd === "vault_info")
      return new Response(JSON.stringify({ result: { id: "vault-b", name: "B", empty: false } }), {
        status: 200,
      });
    throw new Error(`unexpected command: ${request.cmd}`);
  };
  try {
    await deviceVaultStore().set(
      "vault-binding",
      JSON.stringify({ kind: "helper", vaultId: "vault-a", vaultName: "A" }),
    );
    registerWebHelperVaultId("vault-a");
    useVaultConnection.getState().setConnection({ status: "connected", via: "helper", name: "A" });
    await deviceVaultStore().set(
      "vault-binding",
      JSON.stringify({ kind: "helper", vaultId: "vault-b", vaultName: "B" }),
    );
    useHelperLink.getState().setCompletionVaultBinding(true);
    await expect(
      bridgeFor({ port: 43111, token: "synthetic-token" })("cli_complete", {
        requestId: "chat-3",
        provider: "synthetic",
        model: "synthetic",
        prompt: "hello",
      }),
    ).rejects.toThrow(/vault changed/);
    expect(useVaultConnection.getState().connection).toEqual({
      status: "vault-mismatch",
      expected: "A",
      served: "B",
    });
  } finally {
    registerWebHelperVaultId(null);
    useHelperLink.getState().setCompletionVaultBinding(false);
    await deviceVaultStore().delete("vault-binding");
    useVaultConnection.getState().setConnection({ status: "unbound" });
    globalThis.fetch = previousFetch;
  }
});
