import { afterEach, expect, test } from "bun:test";

import { useVaultConnection } from "../state/vaultConnection";
import { helperVaultDir } from "./vaultBinding";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  useVaultConnection.getState().setConnection({ status: "unbound" });
});
for (const [status, message, gate] of [
  [401, "Rotli Helper refused the pairing token — pair again.", "helper-refused"],
  [409, "Rotli Helper isn't serving a vault yet — choose one first.", "helper-no-vault"],
  [404, "unknown command", "helper-outdated"],
  [409, "vault changed: another folder", "vault-mismatch"],
  [409, "revision conflict", "connected"],
] as const)
  test(`mid-session ${message} has the right gate and retains the draft`, async () => {
    let fail = false;
    let probes = 0;
    globalThis.fetch = (async (_url, init) => {
      const cmd = typeof init?.body === "string" ? JSON.parse(init.body).cmd : "health";
      if (cmd === "health") return Response.json({ ok: true });
      if (cmd === "vault_info") {
        probes += 1;
        if (status === 401 || status === 404) return Response.json({ error: message }, { status });
        return Response.json({
          result:
            status === 409 && gate === "helper-no-vault"
              ? null
              : { id: "hv_other", name: "Other", empty: false },
        });
      }
      if (cmd === "vault_walk")
        return Response.json({ result: [{ path: "a.md", kind: "file", lastModified: 1, size: 4 }] });
      if (fail) return Response.json({ error: message }, { status });
      return Response.json({ result: null });
    }) as typeof fetch;
    useVaultConnection.getState().setConnection({ status: "connected", via: "helper", name: "Example" });
    const dir = helperVaultDir({ port: 1439, token: "synthetic-token" }, "hv_example");
    await dir.stat("a.md");
    fail = true;
    await expect(dir.writeText("a.md", "synthetic unsaved draft")).rejects.toThrow(message);
    expect(useVaultConnection.getState().connection.status).toBe(gate);
    expect(probes).toBe(gate === "connected" ? 0 : 1);
    if (gate !== "connected")
      expect(dir.pendingOps()).toMatchObject([{ kind: "write", text: "synthetic unsaved draft" }]);
    else expect(dir.pendingOps()).toEqual([]);
  });
