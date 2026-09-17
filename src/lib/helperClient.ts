// Rotli Helper, the wire: the page's only outbound calls, to a loopback port
// on the user's own computer with the pairing token as a bearer credential.
// Nothing here is reachable in the Mac app (the shell's CSP is ipc-only); on
// the web the site's policy opens connect-src to 127.0.0.1 alone.

import { type HelperLink, helperBaseUrl } from "./helperPairing";

export interface HelperHealth {
  ok: boolean;
  name: string;
  version: string;
}

const HEALTH_TIMEOUT_MS = 2_500;

/** Is a helper listening on this port? No credential travels. */
export async function helperHealth(port: number): Promise<HelperHealth> {
  const response = await fetch(`${helperBaseUrl(port)}/health`, {
    method: "GET",
    signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`helper answered ${response.status}`);
  return (await response.json()) as HelperHealth;
}

/** A non-2xx answer, with its status kept so the pairing layer can tell a
 * refused token (401) from a tool error. */
export class HelperHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "HelperHttpError";
  }
}

/** One command to the helper. A non-2xx answer becomes an Error carrying the
 * helper's own message, so the chat shows the tool's words, not a status. */
export async function helperRpc<T>(link: HelperLink, cmd: string, args: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${helperBaseUrl(link.port)}/rpc`, {
    method: "POST",
    headers: { authorization: `Bearer ${link.token}`, "content-type": "application/json" },
    body: JSON.stringify({ cmd, args }),
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    const message =
      body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : response.status === 401
          ? "Rotli Helper refused the pairing token — pair again."
          : `Rotli Helper answered ${response.status}`;
    throw new HelperHttpError(message, response.status);
  }
  if (body && typeof body === "object" && "result" in body) return (body as { result: T }).result;
  return body as T;
}
