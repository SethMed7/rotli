import { expect, test } from "bun:test";

import type { BrowserContext, Route } from "@playwright/test";

import { fakeHelperVault, PORT, TOKEN } from "../../e2e/web/fake-helper";

test("the in-memory Helper refuses a JSON office request above 24 MiB", async () => {
  let intercept!: (route: Route) => Promise<void>;
  const context = {
    route: async (_pattern: string, handler: (route: Route) => Promise<void>) => {
      intercept = handler;
    },
  } as unknown as BrowserContext;
  await fakeHelperVault().install(context);
  let response = { status: 0, body: "" };
  const request = {
    method: () => "POST",
    url: () => `http://127.0.0.1:${PORT}/rpc`,
    headers: () => ({ authorization: `Bearer ${TOKEN}`, origin: "http://localhost:1437" }),
    postDataBuffer: () => Buffer.alloc(24 * 1024 * 1024 + 1),
    postDataJSON: () => ({ cmd: "vault_write", args: { path: "storage/large.xlsx", base64: "AA==" } }),
  };
  const route = {
    request: () => request,
    fulfill: async ({ status, body }: { status: number; body: string }) => {
      response = { status, body };
    },
  } as unknown as Route;
  await intercept(route);
  expect(response).toEqual({ status: 413, body: JSON.stringify({ error: "request too large" }) });
});
