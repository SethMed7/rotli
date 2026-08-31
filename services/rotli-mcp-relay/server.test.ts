import { describe, expect, test } from "bun:test";

import {
  createRelay,
  MAX_CLOUD_FRAME_BYTES,
  MAX_DEVICE_FRAME_BYTES,
  MAX_MCP_RESPONSE_BYTES,
  serveRelay,
} from "./server";

const PAIR_A = "a".repeat(32);
const PAIR_B = "b".repeat(32);
const CLIENT_A = `rotli_client_${PAIR_A}_${"1".repeat(64)}`;
const CLIENT_A_WRONG = `rotli_client_${PAIR_A}_${"9".repeat(64)}`;
const DEVICE_A = `rotli_device_${PAIR_A}_${"2".repeat(64)}`;
const DEVICE_A_WRONG = `rotli_device_${PAIR_A}_${"8".repeat(64)}`;
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

  test("refuses a second device secret for an active pair", async () => {
    const relay = createRelay({ deviceWaitMs: 5 });
    const activePoll = relay.fetch(poll());
    await Promise.resolve();
    expect((await relay.fetch(poll(DEVICE_A_WRONG, CLIENT_A))).status).toBe(409);
    expect((await activePoll).status).toBe(204);
  });

  test("bounds all outstanding cloud requests without consuming another device", async () => {
    const relay = createRelay({ cloudWaitMs: 500, deviceWaitMs: 500, maxCloudRequests: 1 });
    const pollA = relay.fetch(poll());
    const pollB = relay.fetch(poll(DEVICE_B, CLIENT_B));
    await new Promise((resolve) => setTimeout(resolve, 1));

    const cloudA = relay.fetch(request("/mcp", CLIENT_A, { jsonrpc: "2.0", id: 1, method: "ping" }));
    await new Promise((resolve) => setTimeout(resolve, 1));
    const envelope = (await (await pollA).json()) as { requestId: string };
    expect(
      (await relay.fetch(request("/mcp", CLIENT_B, { jsonrpc: "2.0", id: 2, method: "ping" }))).status,
    ).toBe(503);
    expect(
      (
        await relay.fetch(
          request("/device/respond", DEVICE_A, {
            requestId: envelope.requestId,
            response: { jsonrpc: "2.0", id: 1, result: {} },
          }),
        )
      ).status,
    ).toBe(200);
    expect((await cloudA).status).toBe(200);

    const cloudB = relay.fetch(request("/mcp", CLIENT_B, { jsonrpc: "2.0", id: 2, method: "ping" }));
    await new Promise((resolve) => setTimeout(resolve, 1));
    const envelopeB = (await (await pollB).json()) as { requestId: string };
    expect(
      (
        await relay.fetch(
          request("/device/respond", DEVICE_B, {
            requestId: envelopeB.requestId,
            response: { jsonrpc: "2.0", id: 2, result: {} },
          }),
        )
      ).status,
    ).toBe(200);
    expect((await cloudB).status).toBe(200);
  });

  test("keeps cloud requests at 256 KB and accepts a bounded 512 KB MCP response envelope", async () => {
    const relay = createRelay();
    expect(
      (
        await relay.fetch(
          request("/device/poll", DEVICE_A, {
            clientToken: CLIENT_A,
            padding: "x".repeat(MAX_CLOUD_FRAME_BYTES),
          }),
        )
      ).status,
    ).toBe(400);

    const devicePoll = relay.fetch(poll());
    await new Promise((resolve) => setTimeout(resolve, 1));
    const cloudResponse = relay.fetch(request("/mcp", CLIENT_A, { jsonrpc: "2.0", id: 9, method: "ping" }));
    const envelope = (await (await devicePoll).json()) as { requestId: string };
    expect(
      (
        await relay.fetch(
          request("/device/respond", DEVICE_A, {
            requestId: envelope.requestId,
            response: {
              jsonrpc: "2.0",
              id: 9,
              result: { padding: "x".repeat(MAX_MCP_RESPONSE_BYTES - 128) },
            },
          }),
        )
      ).status,
    ).toBe(200);
    expect((await cloudResponse).status).toBe(200);
    expect(
      (
        await relay.fetch(
          request("/device/respond", DEVICE_A, {
            requestId: "not-pending",
            response: { padding: "x".repeat(MAX_MCP_RESPONSE_BYTES) },
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await relay.fetch(
          request("/device/respond", DEVICE_A, { padding: "x".repeat(MAX_DEVICE_FRAME_BYTES) }),
        )
      ).status,
    ).toBe(400);
  });

  test("enforces path-specific caps in the handler and the outer Bun allocation cap", async () => {
    const server = serveRelay({ hostname: "127.0.0.1", port: 0 });
    try {
      const cloudResponse = await fetch(`http://127.0.0.1:${server.port}/device/poll`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${DEVICE_A}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ clientToken: CLIENT_A, padding: "x".repeat(MAX_CLOUD_FRAME_BYTES) }),
      });
      expect(cloudResponse.status).toBe(400);
      const deviceResponse = await fetch(`http://127.0.0.1:${server.port}/device/respond`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${DEVICE_A}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ padding: "x".repeat(MAX_DEVICE_FRAME_BYTES) }),
      });
      expect(deviceResponse.status).toBe(413);
    } finally {
      await server.stop(true);
    }
  });
});
