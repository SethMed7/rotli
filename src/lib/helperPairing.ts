// Rotli Helper pairing, the pure part: the code the helper prints, the URL
// it lives at, and the commands the page may send it. The helper is a small
// program on the user's own computer; the page reaches it over loopback only.

/** The helper's default port; the pairing code carries the real one. */
export const HELPER_DEFAULT_PORT = 43111;

export interface HelperLink {
  port: number;
  token: string;
}

/** The AI commands the helper serves. Everything else stays in the Mac app. */
export const HELPER_COMMANDS: ReadonlySet<string> = new Set([
  "cli_detect",
  "cli_complete",
  "cli_cancel",
  "chat_models",
  "model_usage",
]);

/** `43111:token` as the helper prints it, or a `http://127.0.0.1:43111/#token`
 * link. Whitespace around it is forgiven; anything else is refused. */
export function parsePairingCode(raw: string): HelperLink | null {
  const text = raw.trim();
  const url = text.match(/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::(\d+))?\/?#?(?<token>[A-Za-z0-9._-]+)$/);
  const pair = text.match(/^(\d{2,5}):(?<token>[A-Za-z0-9._-]+)$/);
  const match = url ?? pair;
  if (!match) return null;
  const port = Number(match[1] ?? HELPER_DEFAULT_PORT);
  const token = match.groups?.token ?? "";
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  if (token.length < 24) return null;
  return { port, token };
}

/** Where the page talks to the helper: loopback, never a name. */
export function helperBaseUrl(port: number): string {
  return `http://127.0.0.1:${port}`;
}
