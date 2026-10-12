// A fake Rotli Helper on the page's loopback route, for browsers without the
// folder API (Zen, Firefox). It keeps the served folder in memory with the
// real helper's rules (src-tauri/src/helper_vault.rs): every file is BYTES
// (an office package survives a round trip), a write or delete is gated by
// `expectedContent` (the desktop's fnv1a64 of the bytes on disk, "0" when
// missing) or `expectedRevision` (`${mtimeMs}:${size}`), a replace with no
// gate is refused, and a move never clobbers. The Rust suite
// (helper_vault_tests.rs) proves the real helper's file handling.

import { type BrowserContext, expect, type Page } from "@playwright/test";

import { bytesRevision } from "../../src/lib/contentRevision";
import { APP, vaultGate } from "./support";

export const PORT = 43120;
export const TOKEN = "fixture-token-with-at-least-twenty-four-chars";
const HELPER_MAX_REQUEST_BYTES = 24 * 1024 * 1024;

interface Served {
  name: string;
  id: string;
}

/** One served file: its exact bytes, and its text for Markdown assertions. */
export interface ServedFile {
  bytes: Buffer;
  mtime: number;
  readonly text: string;
}

function served(bytes: Buffer, mtime: number): ServedFile {
  return {
    bytes,
    mtime,
    get text() {
      return bytes.toString("utf8");
    },
  };
}

function refusal(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

/** The helper's side, shared by every page of the context. */
export function fakeHelperVault() {
  const files = new Map<string, ServedFile>();
  const dirs = new Set<string>();
  let clock = 1_700_000_000_000;
  const state = {
    down: false,
    refused: false,
    /** How long /health is held, as a browser holds a request while it asks
     * whether the page may reach apps on this device (Firefox, Zen). */
    healthDelayMs: 0,
    served: null as Served | null,
    chooses: { name: "notes", id: "hv_notes" } as Served,
    /** vault_info advertises that cli_complete runs in the served vault;
     * false is a helper from before that (it serves files, can't chat them). */
    binding: true,
  };
  /** Every authenticated call, in order, for assertions on the wire. */
  const calls: { cmd: string; args: Record<string, unknown> }[] = [];
  const parent = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
  const mkdirs = (path: string) => {
    for (let dir = path; dir; dir = parent(dir)) dirs.add(dir);
  };
  const stat = (path: string) => {
    const file = files.get(path);
    if (file) return { lastModified: file.mtime, size: file.bytes.length };
    return dirs.has(path) ? { lastModified: 0, size: 0 } : null;
  };
  /** The real helper's stale_revision: null when the gate holds. */
  const stale = (path: string, args: Record<string, unknown>): string | null => {
    const file = files.get(path);
    if (typeof args.expectedContent === "string") {
      const current = file ? bytesRevision(new Uint8Array(file.bytes)) : "0";
      return current === args.expectedContent ? null : current;
    }
    if (typeof args.expectedRevision === "string") {
      const current = file ? `${file.mtime}:${file.bytes.length}` : "0";
      return current === args.expectedRevision ? null : current;
    }
    return file ? "ungated" : null;
  };
  /** Put bytes in the served folder behind the page's back (another app). */
  const writeBehind = (path: string, bytes: Buffer) => {
    mkdirs(parent(path));
    files.set(path, served(bytes, (clock += 1000)));
  };
  const verbs: Record<string, (args: Record<string, unknown>) => unknown> = {
    chat_models: () => [],
    cli_detect: () => ({ installed: true, version: "2.1.0 (Claude Code)", authenticated: true }),
    cli_complete: () => "Hello from the helper's vault.",
    cli_cancel: () => null,
    vault_info: () =>
      state.served
        ? {
            ...state.served,
            empty: files.size === 0 && [...dirs].every((d) => d === ".rotli"),
            ...(state.binding ? { completionVaultBinding: true } : {}),
          }
        : null,
    vault_choose: () => {
      state.served = state.chooses;
      return verbs.vault_info!({});
    },
    vault_walk: () => [
      ...[...dirs].map((path) => ({ path, kind: "directory", lastModified: 0, size: 0 })),
      ...[...files.keys()].map((path) => ({ path, kind: "file", ...stat(path) })),
    ],
    vault_stat: (a) => stat(String(a.path)),
    vault_read: (a) => {
      const file = files.get(String(a.path));
      if (!file) throw refusal(404, `no such file: ${String(a.path)}`);
      return a.encoding === "base64" ? file.bytes.toString("base64") : file.text;
    },
    vault_read_many: (a) => ({
      files: Object.fromEntries((a.paths as string[]).map((p) => [p, files.get(p)?.text ?? null])),
      more: [],
    }),
    vault_write: (a) => {
      const path = String(a.path);
      const found = stale(path, a);
      if (found) throw refusal(409, `revision conflict: the file changed on disk (${found})`);
      mkdirs(parent(path));
      const bytes =
        typeof a.text === "string" ? Buffer.from(a.text, "utf8") : Buffer.from(String(a.base64), "base64");
      files.set(path, served(bytes, (clock += 1000)));
      return stat(path);
    },
    vault_mkdir: (a) => mkdirs(String(a.path)) ?? null,
    vault_move: (a) => {
      const from = files.get(String(a.from));
      if (!from) throw refusal(404, "no such file");
      if (files.has(String(a.to)) && String(a.to).toLowerCase() !== String(a.from).toLowerCase())
        throw refusal(409, `${String(a.to)} already exists`);
      mkdirs(parent(String(a.to)));
      files.delete(String(a.from));
      files.set(String(a.to), from);
      return null;
    },
    vault_remove: (a) => {
      const path = String(a.path);
      if (typeof a.expectedContent === "string" && !files.has(path))
        throw refusal(409, `revision conflict on ${path}: expected a file`);
      if (files.has(path)) {
        const found = stale(path, a);
        if (found) throw refusal(409, `revision conflict: the file changed on disk (${found})`);
      }
      files.delete(path);
      dirs.delete(path);
      return null;
    },
  };
  const install = (context: BrowserContext) =>
    context.route(`http://127.0.0.1:${PORT}/**`, async (route) => {
      const request = route.request();
      const cors = {
        "access-control-allow-origin": request.headers()["origin"] ?? "*",
        "access-control-allow-headers": "authorization, content-type",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "content-type": "application/json",
      };
      if (state.down) return route.abort("connectionrefused");
      if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      if (new URL(request.url()).pathname === "/health") {
        if (state.healthDelayMs) await new Promise((resolve) => setTimeout(resolve, state.healthDelayMs));
        const health = { ok: true, name: "rotli-helper", version: "1.3.0" };
        return route.fulfill({ status: 200, headers: cors, body: JSON.stringify(health) });
      }
      if (state.refused || request.headers()["authorization"] !== `Bearer ${TOKEN}`) {
        return route.fulfill({ status: 401, headers: cors, body: JSON.stringify({ error: "unauthorized" }) });
      }
      if ((request.postDataBuffer()?.byteLength ?? 0) > HELPER_MAX_REQUEST_BYTES)
        return route.fulfill({
          status: 413,
          headers: cors,
          body: JSON.stringify({ error: "request too large" }),
        });
      const { cmd, args } = request.postDataJSON() as { cmd: string; args: Record<string, unknown> };
      calls.push({ cmd, args: args ?? {} });
      if (cmd.startsWith("vault_") && cmd !== "vault_info" && cmd !== "vault_choose" && !state.served)
        return route.fulfill({
          status: 409,
          headers: cors,
          body: JSON.stringify({ error: "Rotli Helper isn't serving a vault yet — choose one first." }),
        });
      const verb = verbs[cmd];
      if (!verb)
        return route.fulfill({
          status: 404,
          headers: cors,
          body: JSON.stringify({ error: "unknown command" }),
        });
      try {
        return await route.fulfill({
          status: 200,
          headers: cors,
          body: JSON.stringify({ result: verb(args ?? {}) ?? null }),
        });
      } catch (error) {
        const status = (error as { status?: number }).status ?? 500;
        return route.fulfill({
          status,
          headers: cors,
          body: JSON.stringify({ error: (error as Error).message }),
        });
      }
    });
  return { files, state, calls, install, writeBehind };
}

/** A browser without the File System Access API, like Zen or Firefox. */
export async function withoutFolderApi(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    Reflect.deleteProperty(window as unknown as Record<string, unknown>, "showDirectoryPicker");
  });
}

/** Setup end to end: paste the code, choose the folder, and land on the
 * note it opens (Welcome, for the empty folder a new vault seeds). */
export async function connectThroughHelper(page: Page, opens = "Welcome to Rotli"): Promise<void> {
  await page.goto(APP);
  await expect(vaultGate(page)).toHaveText("Set up Rotli Helper");
  await page.getByLabel("Or paste the pairing code the installer printed:").fill(`${PORT}:${TOKEN}`);
  await page.getByRole("button", { name: "Pair" }).click();
  await expect(vaultGate(page)).toHaveText("Rotli Helper is paired");
  await page.locator(".setup-button.primary", { hasText: "Continue" }).click();
  await expect(vaultGate(page)).toHaveText("Choose your vault");
  await page.locator(".setup-button.primary", { hasText: "Choose folder…" }).click();
  // a reload plus Welcome seeding: allow a loaded runner its time
  await expect(page.getByRole("tab", { selected: true })).toContainText(opens, {
    timeout: 15_000,
  });
}
