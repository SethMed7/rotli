export const MAX_FRAME_BYTES = 256_000;
const DEVICE_WAIT_MS = 25_000;
const CLOUD_WAIT_MS = 30_000;
const MAX_DEVICE_WAITERS = 256;
const MAX_CLOUD_REQUESTS = 256;

type TokenRole = "client" | "device";

interface RelayToken {
  pairId: string;
  role: TokenRole;
  value: string;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

interface DeviceWaiter {
  clientToken: string;
  deviceToken: string;
  frame: Deferred<Response>;
  timer: ReturnType<typeof setTimeout>;
}

interface CloudRequest {
  deviceToken: string;
  response: Deferred<Response>;
  timer: ReturnType<typeof setTimeout>;
}

interface RelayOptions {
  cloudWaitMs?: number;
  deviceWaitMs?: number;
  maxCloudRequests?: number;
  maxDeviceWaiters?: number;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function bearer(request: Request, role: TokenRole): RelayToken | null {
  const value = request.headers.get("authorization");
  const token = value?.startsWith("Bearer ") ? value.slice(7).trim() : "";
  const match = /^rotli_(client|device)_([0-9a-f]{32})_([0-9a-f]{64})$/.exec(token);
  if (!match || match[1] !== role) return null;
  return { role, pairId: match[2]!, value: token };
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function rejectsBrowserOrigin(request: Request): boolean {
  // MCP clients call server-to-server. Reject browser-originated credentialed
  // requests instead of making the public endpoint a CORS surface.
  return request.headers.has("origin");
}

function acceptsJson(request: Request): boolean {
  return request.headers.get("content-type")?.split(";", 1)[0]?.trim() === "application/json";
}

async function frame(request: Request): Promise<unknown> {
  const rawLength = request.headers.get("content-length");
  if (rawLength !== null) {
    const declared = Number(rawLength);
    if (!Number.isSafeInteger(declared) || declared < 0) throw new Error("invalid content length");
    if (declared > MAX_FRAME_BYTES) throw new Error("frame too large");
  }
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_FRAME_BYTES) throw new Error("frame too large");
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function createRelay(options: RelayOptions = {}) {
  const deviceWaitMs = options.deviceWaitMs ?? DEVICE_WAIT_MS;
  const cloudWaitMs = options.cloudWaitMs ?? CLOUD_WAIT_MS;
  const maxDeviceWaiters = options.maxDeviceWaiters ?? MAX_DEVICE_WAITERS;
  const maxCloudRequests = options.maxCloudRequests ?? MAX_CLOUD_REQUESTS;
  const devices = new Map<string, DeviceWaiter>();
  const cloud = new Map<string, CloudRequest>();

  const fetch = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true });
    }
    if (rejectsBrowserOrigin(request)) return json({ error: "browser origins are not accepted" }, 403);

    if (request.method === "POST" && url.pathname === "/device/poll") {
      const device = bearer(request, "device");
      if (!device) return json({ error: "unauthorized" }, 401);
      if (!acceptsJson(request)) return json({ error: "application/json required" }, 415);
      let body: unknown;
      try {
        body = await frame(request);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "invalid frame" }, 400);
      }
      const clientValue = (body as { clientToken?: unknown }).clientToken;
      if (typeof clientValue !== "string") return json({ error: "client token required" }, 400);
      const clientRequest = new Request(request.url, {
        headers: { authorization: `Bearer ${clientValue}` },
      });
      const client = bearer(clientRequest, "client");
      if (!client || client.pairId !== device.pairId) return json({ error: "invalid client token" }, 400);

      const previous = devices.get(device.pairId);
      if (previous && previous.deviceToken !== device.value)
        return json({ error: "pair already active" }, 409);
      if (!previous && devices.size >= maxDeviceWaiters) {
        return json({ error: "relay connection capacity reached" }, 503);
      }
      if (previous) {
        clearTimeout(previous.timer);
        previous.frame.resolve(new Response(null, { status: 409 }));
      }
      const next = deferred<Response>();
      const timer = setTimeout(() => {
        if (devices.get(device.pairId)?.frame === next) devices.delete(device.pairId);
        next.resolve(new Response(null, { status: 204 }));
      }, deviceWaitMs);
      devices.set(device.pairId, {
        clientToken: client.value,
        deviceToken: device.value,
        frame: next,
        timer,
      });
      return next.promise;
    }

    if (request.method === "POST" && url.pathname === "/mcp") {
      const client = bearer(request, "client");
      if (!client) return json({ error: "unauthorized" }, 401);
      if (!acceptsJson(request)) return json({ error: "application/json required" }, 415);
      const device = devices.get(client.pairId);
      if (!device) {
        return json({ error: "Rotli is not connected; open Rotli and connect Remote agents." }, 503);
      }
      if (device.clientToken !== client.value) return json({ error: "unauthorized" }, 401);
      if (cloud.size >= maxCloudRequests) return json({ error: "relay request capacity reached" }, 503);
      let requestFrame: unknown;
      try {
        requestFrame = await frame(request);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "invalid frame" }, 400);
      }
      devices.delete(client.pairId);
      clearTimeout(device.timer);
      const requestId = crypto.randomUUID();
      const response = deferred<Response>();
      const timer = setTimeout(() => {
        cloud.delete(requestId);
        response.resolve(json({ error: "Rotli did not answer before the request expired." }, 504));
      }, cloudWaitMs);
      cloud.set(requestId, { deviceToken: device.deviceToken, response, timer });
      device.frame.resolve(json({ requestId, request: requestFrame }));
      return response.promise;
    }

    if (request.method === "POST" && url.pathname === "/device/respond") {
      const device = bearer(request, "device");
      if (!device) return json({ error: "unauthorized" }, 401);
      if (!acceptsJson(request)) return json({ error: "application/json required" }, 415);
      let responseFrame: unknown;
      try {
        responseFrame = await frame(request);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "invalid frame" }, 400);
      }
      const envelope = responseFrame as { requestId?: unknown; response?: unknown };
      const requestId = typeof envelope.requestId === "string" ? envelope.requestId : "";
      const pending = cloud.get(requestId);
      if (!pending || pending.deviceToken !== device.value) return json({ error: "request not found" }, 404);
      cloud.delete(requestId);
      clearTimeout(pending.timer);
      pending.response.resolve(
        envelope.response === null || envelope.response === undefined
          ? new Response(null, { status: 202 })
          : json(envelope.response),
      );
      return json({ accepted: true });
    }

    return json({ error: "not found" }, 404);
  };

  return { fetch };
}

if (import.meta.main) {
  const relay = createRelay();
  Bun.serve({
    port: Number(process.env.PORT ?? 3000),
    maxRequestBodySize: MAX_FRAME_BYTES,
    fetch: relay.fetch,
  });
}
