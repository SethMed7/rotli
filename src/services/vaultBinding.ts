// Rotli Web: which vault THIS browser opens, and whether it can open it right
// now. The binding lives in the browser's own device store (never the vault):
// a remembered folder handle for Chromium's live folder, or the helper vault's
// id and name for browsers that reach the vault through Rotli Helper.
//
// The rule (2026-09-22, the owner): a vault is required, and a boot that
// can't reach the bound vault shows a reconnect screen. It never falls back to
// a different store, so a note can't land anywhere but the vault.
//
// Privacy: every call here is local — IndexedDB, the File System Access API,
// or Rotli Helper on 127.0.0.1. Nothing goes to the network.

import { type VaultStore, deviceVaultStore } from "../lib/browserVault";
import { FsaVaultDir } from "../lib/fsaVaultDir";
import { HelperHttpError, helperHealth, helperRpc, helperUnreachable } from "../lib/helperClient";
import type { HelperLink } from "../lib/helperPairing";
import { HelperVaultDir, type PendingOp } from "../lib/helperVaultDir";
import { type VaultConnection, useVaultConnection } from "../state/vaultConnection";
import { type VaultDir, freeSiblingPath } from "./vaultDir";
import {
  type FolderSupport,
  browserFolderSupportSync,
  disconnectFolderVault,
  folderVaultStatus,
  vaultFolderId,
} from "./webVaultFolder";

const BINDING_KEY = "vault-binding";
const PENDING_KEY = "vault-pending";
/** Operations a replay couldn't finish yet, per vault: their own key, so the
 * next page's unload (which rewrites PENDING_KEY) can never drop them. */
const keptKey = (vaultId: string) => `vault-pending:kept:${vaultId}`;

async function readRecord(store: VaultStore, key: string): Promise<PendingRecord | null> {
  try {
    const raw = await store.get(key);
    const record = raw ? (JSON.parse(raw) as PendingRecord) : null;
    return record && Array.isArray(record.ops) ? record : null;
  } catch {
    return null;
  }
}

export interface HelperBinding {
  kind: "helper";
  vaultId: string;
  vaultName: string;
}

/** What `vault_info` answers: the served folder's name, its helper-minted id,
 * and whether it is empty (an empty folder becomes a new vault). */
export interface HelperVaultInfo {
  name: string;
  id: string;
  empty: boolean;
}

export async function loadHelperBinding(): Promise<HelperBinding | null> {
  try {
    const raw = await deviceVaultStore().get(BINDING_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") return null;
    const b = parsed as Partial<HelperBinding>;
    return b.kind === "helper" && typeof b.vaultId === "string" && typeof b.vaultName === "string"
      ? { kind: "helper", vaultId: b.vaultId, vaultName: b.vaultName }
      : null;
  } catch {
    return null;
  }
}

export async function saveHelperBinding(info: HelperVaultInfo): Promise<void> {
  const binding: HelperBinding = { kind: "helper", vaultId: info.id, vaultName: info.name };
  await deviceVaultStore().set(BINDING_KEY, JSON.stringify(binding));
}

export async function clearHelperBinding(): Promise<void> {
  await deviceVaultStore().delete(BINDING_KEY);
}

/** Close the vault in this browser and go back to setup. The vault itself is
 * untouched; the browser forgets which folder it opens (and reloads). */
export async function leaveVault(): Promise<void> {
  await clearHelperBinding();
  await disconnectFolderVault();
}

// ── deciding ──────────────────────────────────────────────────────────────────

/** What asking the helper found. */
export type HelperProbe =
  | { kind: "offline" }
  | { kind: "refused" }
  | { kind: "outdated" }
  | { kind: "serving"; info: HelperVaultInfo | null };

/** A browser that can't reach any folder: Safari (no folder API, and it won't
 * call a loopback helper from https) and every phone. Pure. */
export function unsupportedBrowser(support: FolderSupport, userAgent: string): string | null {
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)) return "this phone or tablet";
  if (support.kind === "import-only" && support.browser === "Safari") return "Safari";
  return null;
}

/** The connection a helper binding has, from what the helper said. Pure. */
export function helperConnection(binding: HelperBinding | null, probe: HelperProbe): VaultConnection {
  const name = binding?.vaultName ?? null;
  if (probe.kind === "offline") return { status: "helper-offline", name };
  if (probe.kind === "refused") return { status: "helper-refused", name };
  if (probe.kind === "outdated") return { status: "helper-outdated", name };
  const info = probe.info;
  if (!info) return { status: "helper-no-vault" };
  if (binding && binding.vaultId !== info.id) {
    return { status: "vault-mismatch", expected: binding.vaultName, served: info.name };
  }
  // paired and serving, but this browser hasn't said "use this one" yet
  if (!binding) return { status: "unbound" };
  return { status: "connected", via: "helper", name: info.name };
}

/** Ask the helper whether it's there, takes our token, and what it serves. */
export async function probeHelper(link: HelperLink): Promise<HelperProbe> {
  try {
    const health = await helperHealth(link.port);
    if (!health.ok) return { kind: "offline" };
  } catch {
    return { kind: "offline" };
  }
  try {
    const info = await helperRpc<HelperVaultInfo | null>(link, "vault_info", {}, { timeoutMs: 5_000 });
    return { kind: "serving", info };
  } catch (error) {
    if (error instanceof HelperHttpError && error.status === 401) return { kind: "refused" };
    // a helper from before the vault verbs answers "unknown command"
    if (error instanceof HelperHttpError && error.status === 404) return { kind: "outdated" };
    return { kind: "offline" };
  }
}

export interface ResolvedVault {
  connection: VaultConnection;
  /** The vault's files when connected; null means "show setup". */
  dir: VaultDir | null;
  /** A stable id for this vault on this browser (never its folder name, which
   * two vaults can share): keys per-vault bookkeeping like the unsaved journal. */
  identity?: string;
}

/** The whole boot decision. Resolves before the first render; a helper that
 * isn't running fails fast (a refused loopback connection is immediate). */
export async function resolveVault(link: HelperLink | null): Promise<ResolvedVault> {
  const support = browserFolderSupportSync();
  const binding = await loadHelperBinding();
  if (binding || support.kind !== "live") {
    const unsupported = binding ? null : unsupportedBrowser(support, navigator.userAgent);
    if (unsupported) return { connection: { status: "unsupported", browser: unsupported }, dir: null };
    if (!link) {
      return {
        connection: binding ? { status: "helper-refused", name: binding.vaultName } : { status: "unbound" },
        dir: null,
      };
    }
    const connection = helperConnection(binding, await probeHelper(link));
    if (connection.status !== "connected" || !binding) return { connection, dir: null };
    const dir = helperVaultDir(link, binding.vaultId);
    await replayPendingOps(dir, binding.vaultId);
    watchPendingOps(dir, binding.vaultId);
    return { connection, dir, identity: `helper:${binding.vaultId}` };
  }
  const status = await folderVaultStatus();
  if (status.kind === "granted") {
    return {
      connection: { status: "connected", via: "folder", name: status.name },
      dir: new FsaVaultDir(status.handle),
      identity: `folder:${await vaultFolderId()}`,
    };
  }
  if (status.kind === "prompt")
    return { connection: { status: "needs-permission", name: status.name }, dir: null };
  return { connection: { status: "unbound" }, dir: null };
}

// ── the helper vault ──────────────────────────────────────────────────────────

/** The one call deadline per verb: a walk or a batch read of a big vault gets
 * longer; the picker none (a person is choosing). */
function deadlineFor(cmd: string): number | undefined {
  if (cmd === "vault_choose") return undefined;
  return cmd === "vault_walk" || cmd === "vault_read_many" ? 60_000 : 20_000;
}

/** "vault changed": the helper was pointed at another folder while this page
 * had one open. Nothing was touched; boot again, into setup. */
function vaultChanged(error: unknown): boolean {
  return (
    error instanceof HelperHttpError && error.status === 409 && error.message.startsWith("vault changed")
  );
}

export function helperVaultDir(link: HelperLink, vaultId: string): HelperVaultDir {
  // every verb names the vault this page bound to; the helper refuses a mismatch
  const call = (cmd: string, args: Record<string, unknown>) =>
    helperRpc(link, cmd, { ...args, vaultId }, { timeoutMs: deadlineFor(cmd) }).catch((error: unknown) => {
      if (vaultChanged(error) && typeof window !== "undefined") window.location.reload();
      throw error;
    });
  const dir = new HelperVaultDir(call, {
    ping: async () => (await helperHealth(link.port)).ok === true,
    unreachable: helperUnreachable,
    onReconnecting: (reconnecting) => useVaultConnection.getState().setReconnecting(reconnecting),
  });
  if (typeof document !== "undefined") {
    // back to the front: another app may have changed the vault meanwhile
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) dir.invalidate();
    });
  }
  return dir;
}

/** Ask the helper to open the folder picker on this computer, then bind this
 * browser to what the user chose. "cancelled" when they closed the picker. */
export async function chooseHelperVault(link: HelperLink): Promise<HelperVaultInfo | "cancelled"> {
  const info = await helperRpc<HelperVaultInfo | null>(link, "vault_choose", {});
  if (!info) return "cancelled";
  await saveHelperBinding(info);
  return info;
}

// ── writes that outlive the tab ───────────────────────────────────────────────

interface PendingRecord {
  vaultId: string;
  ops: readonly PendingOp[];
}

/** On page hide, whatever the helper hasn't acknowledged (an outage is on)
 * is kept on this device, so a closed tab doesn't lose the last edits. */
function watchPendingOps(dir: HelperVaultDir, vaultId: string): void {
  if (typeof window === "undefined") return;
  window.addEventListener("pagehide", () => {
    const ops = dir.pendingOps();
    const store = deviceVaultStore();
    if (ops.length === 0) void store.delete(PENDING_KEY).catch(() => {});
    else
      void store.set(PENDING_KEY, JSON.stringify({ vaultId, ops } satisfies PendingRecord)).catch(() => {});
  });
}

/** Replay edits a previous tab couldn't deliver, each against the revision
 * it started from. A file that changed meanwhile is never overwritten: the
 * edit lands beside it as an unsaved copy. Resolves the count replayed. */
export async function replayPendingOps(
  dir: Pick<VaultDir, "writeText" | "writeBytes" | "mkdir" | "move" | "remove" | "stat" | "exists">,
  vaultId: string,
  store = deviceVaultStore(),
): Promise<number> {
  const kept = await readRecord(store, keptKey(vaultId));
  const last = await readRecord(store, PENDING_KEY);
  // another vault's unload record waits for that vault; never replayed here
  const lastHere = last?.vaultId === vaultId ? last : null;
  const ops = [...(kept?.ops ?? []), ...(lastHere?.ops ?? [])];
  if (ops.length === 0) return 0;
  let replayed = 0;
  const retained: PendingOp[] = [];
  for (const op of ops) {
    try {
      if (op.kind === "write") {
        const now = await dir.stat(op.path);
        const current = now ? `${now.lastModified}:${now.size}` : "0";
        const target = current === op.base ? op.path : await freeSiblingPath(dir, op.path, "unsaved copy");
        if (op.text !== undefined) await dir.writeText(target, op.text);
        else if (op.base64 !== undefined) {
          await dir.writeBytes(
            target,
            Uint8Array.from(atob(op.base64), (c) => c.charCodeAt(0)),
          );
        }
      } else if (op.kind === "mkdir") await dir.mkdir(op.path);
      else if (op.kind === "move") await dir.move(op.from, op.to);
      else {
        // a delete decided against an older version never removes a newer one
        const now = op.base ? await dir.stat(op.path) : null;
        if (!op.base || !now || `${now.lastModified}:${now.size}` === op.base) await dir.remove(op.path);
      }
      replayed += 1;
    } catch (error) {
      // kept for the next boot, never dropped: nothing is forgotten silently
      retained.push(op);
      console.warn("rotli: a saved-while-offline change couldn't be replayed yet", error);
    }
  }
  if (lastHere) await store.delete(PENDING_KEY);
  if (retained.length === 0) await store.delete(keptKey(vaultId));
  else await store.set(keptKey(vaultId), JSON.stringify({ vaultId, ops: retained } satisfies PendingRecord));
  return replayed;
}
