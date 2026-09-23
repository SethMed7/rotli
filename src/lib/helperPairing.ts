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
  // older helpers answer 404 "unknown command": the page keeps its built-in list
  "cli_models",
  "cli_complete",
  "cli_cancel",
  "chat_models",
  "model_usage",
]);

/** The vault's file verbs. Sent ONLY by the vault adapter (helperVaultDir.ts),
 * never through the AI seam: a model-driven command can't name a file. */
export const HELPER_VAULT_COMMANDS: ReadonlySet<string> = new Set([
  "vault_info",
  "vault_choose",
  "vault_walk",
  "vault_list",
  "vault_stat",
  "vault_read",
  "vault_read_many",
  "vault_write",
  "vault_mkdir",
  "vault_move",
  "vault_remove",
]);

/** The pairing code the installer hands the page in the URL FRAGMENT
 * (`#pair=43111:token`). A fragment is never sent to any server; the page
 * strips it from the address bar as soon as it has read it. */
export function pairingFromHash(hash: string): string | null {
  const match = hash.match(/^#pair=([^&]+)$/);
  if (!match?.[1]) return null;
  const code = decodeURIComponent(match[1]);
  return parsePairingCode(code) ? code : null;
}

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
