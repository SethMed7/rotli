import { describe, expect, test } from "bun:test";

import { createRelay } from "./server";

const PAIR_A = "a".repeat(32);
const PAIR_B = "b".repeat(32);
const CLIENT_A = `rotli_client_${PAIR_A}_${"1".repeat(64)}`;
const CLIENT_A_WRONG = `rotli_client_${PAIR_A}_${"9".repeat(64)}`;
const DEVICE_A = `rotli_device_${PAIR_A}_${"2".repeat(64)}`;
const CLIENT_B = `rotli_client_${PAIR_B}_${"3".repeat(64)}`;
const DEVICE_B = `rotli_device_${PAIR_B}_${"4".repeat(64)}`;

function request(
  path: string,
  token?: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(`https://relay.test${path}`, {
    method: "POST",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function poll(pathToken = DEVICE_A, clientToken = CLIENT_A): Request {
  return request("/device/poll", pathToken, { device: "rotli-workspace", clientToken });
}

describe("Rotli MCP relay", () => {
  test("requires exact role-bound credentials and rejects browser origins", async () => {
    const relay = createRelay({ deviceWaitMs: 5 });
    expect((await relay.fetch(request("/mcp", undefined, {}))).status).toBe(401);
    expect((await relay.fetch(request("/mcp", `rotli_${"a".repeat(64)}`, {}))).status).toBe(401);
    expect((await relay.fetch(request("/mcp", DEVICE_A, {}))).status).toBe(401);
    expect((await relay.fetch(poll(CLIENT_A))).status).toBe(401);
    expect(
      (await relay.fetch(request("/mcp", CLIENT_A, {}, { origin: "https://hostile.test" }))).status,
    ).toBe(403);
    expect((await relay.fetch(request("/mcp", CLIENT_A))).status).toBe(415);
    expect((await relay.fetch(request("/mcp", CLIENT_A, {}))).status).toBe(503);
  });

  test("passes one frame only between the matching client and device roles", async () => {
    const relay = createRelay({ cloudWaitMs: 50, deviceWaitMs: 50 });
    const devicePoll = relay.fetch(poll());
    await Promise.resolve();
    expect((await relay.fetch(request("/mcp", CLIENT_B, { method: "tools/list" }))).status).toBe(503);
    expect((await relay.fetch(request("/mcp", CLIENT_A_WRONG, { method: "tools/list" }))).status).toBe(401);

    const cloudResponse = relay.fetch(
      request("/mcp", CLIENT_A, { jsonrpc: "2.0", id: 1, method: "tools/list" }),
    );
    const delivered = await devicePoll;
    const envelope = (await delivered.json()) as { requestId: string; request: { method: string } };
    expect(envelope.request.method).toBe("tools/list");

    expect(
      (
        await relay.fetch(
          request("/device/respond", DEVICE_B, { requestId: envelope.requestId, response: {} }),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await relay.fetch(
          request("/device/respond", DEVICE_A, {
            requestId: envelope.requestId,
            response: { jsonrpc: "2.0", id: 1, result: { tools: [] } },
          }),
        )
      ).status,
    ).toBe(200);
    expect((await cloudResponse).status).toBe(200);
  });

  test("bounds live device waiters and expires unanswered cloud frames", async () => {
    const relay = createRelay({ cloudWaitMs: 5, deviceWaitMs: 10, maxDeviceWaiters: 1 });
    const devicePoll = relay.fetch(poll());
    await Promise.resolve();
    expect((await relay.fetch(poll(DEVICE_B, CLIENT_B))).status).toBe(503);

    const cloudResponse = relay.fetch(request("/mcp", CLIENT_A, { jsonrpc: "2.0", id: 2, method: "ping" }));
    expect((await devicePoll).status).toBe(200);
    expect((await cloudResponse).status).toBe(504);
  });
});
