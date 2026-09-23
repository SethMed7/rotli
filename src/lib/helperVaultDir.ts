// Rotli Helper behind the VaultDir port: the vault folder the user chose,
// served by the helper on this computer over loopback, for browsers without
// the File System Access API (Zen, Firefox, Brave with its flag off). Every
// note is a real file there; nothing is copied into the browser.
// Effectful adapter (scripts/source-ownership.ts LIB_EFFECTFUL_FILE_OWNERS).
//
// Two things a network hop changes, handled here so nothing above the port
// knows:
// - Round trips. The notes service stats and reads every Markdown file to
//   build its index; 900 notes would be 1,800 requests. One `vault_walk`
//   answers every list/stat/exists for a short window, and a missed read
//   fetches every unread note in one `vault_read_many`. Texts are cached by
//   revision, so an unchanged file is never read twice.
// - Outages. If the helper stops answering (quit, restarting, the computer
//   asleep), a call does not fail: it WAITS, the connection says so (the
//   overlay), and it retries when the helper answers again. A write stays
//   pending the whole time, so the editor's saved dot stays honest. Writes
//   replayed after an outage carry the revision they started from, and the
//   helper refuses them if the file changed on disk meanwhile.

import {
  type VaultDir,
  type VaultDirEntry,
  type VaultStat,
  baseName as nameOf,
  normalizeVaultPath as normalize,
  parentPath as parentOf,
} from "../services/vaultDir";

export type HelperCall = (cmd: string, args: Record<string, unknown>) => Promise<unknown>;

interface Entry {
  kind: "file" | "directory";
  lastModified: number;
  size: number;
}

interface WalkEntry extends Entry {
  path: string;
}

/** A mutation not yet acknowledged by the helper, kept so an outage that
 * outlives the tab can hand it to the next boot. */
export type PendingOp =
  | { kind: "write"; path: string; text?: string; base64?: string; base: string }
  | { kind: "mkdir"; path: string }
  | { kind: "move"; from: string; to: string }
  /** `base`: the revision the delete was decided against ("" for a folder). */
  | { kind: "remove"; path: string; base: string };

export interface HelperVaultDirOptions {
  /** Does the helper answer? Polled while an outage lasts. */
  ping: () => Promise<boolean>;
  /** True if `error` means "nothing answered" rather than a refusal. */
  unreachable: (error: unknown) => boolean;
  /** The overlay's switch: true while calls wait for the helper. */
  onReconnecting?: (reconnecting: boolean) => void;
  /** Every mutation acknowledged: nothing is pending any more. */
  onDrained?: () => void;
  /** How long one walk answers list/stat/exists (default 2 s). */
  freshMs?: number;
  /** How often an outage re-asks (default 1.5 s). */
  retryMs?: number;
}

/** Paths per `vault_read_many`: the helper budgets the bytes, this the count. */
const READ_BATCH = 400;
/** Text files the index reads; everything else is read on demand. */
const PREFETCHED = /\.(md|markdown)$/i;

function revisionOf(entry: Entry | undefined): string {
  return entry?.kind === "file" ? `${entry.lastModified}:${entry.size}` : "0";
}

/** The desktop app's content revision (`fsutil::revision`): FNV-1a 64 over the
 * UTF-8 bytes. Sent with a write whose text this tab knows, so the helper's
 * gate compares content, not a millisecond stamp two edits can share. */
export function contentRevision(text: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function isConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { status?: unknown }).status === 409 &&
    /revision conflict/i.test(String((error as { message?: unknown }).message))
  );
}

export class HelperVaultDir implements VaultDir {
  private entries = new Map<string, Entry>();
  private walkedAt = 0;
  private walking: Promise<void> | null = null;
  /** Bumped by every local mutation: a walk that raced one is discarded. */
  private mutations = 0;
  private readonly texts = new Map<string, { revision: string; text: string }>();
  private chain: Promise<unknown> = Promise.resolve();
  private readonly pending: PendingOp[] = [];
  private outage: Promise<void> | null = null;

  constructor(
    private readonly call: HelperCall,
    private readonly options: HelperVaultDirOptions,
  ) {}

  /** Writes the helper has not acknowledged yet, oldest first. */
  pendingOps(): readonly PendingOp[] {
    return [...this.pending];
  }

  /** Forget the walk (the page came back to the front; another app may have
   * changed the vault). The next list or stat asks again. */
  invalidate(): void {
    this.walkedAt = 0;
  }

  // ── transport ──────────────────────────────────────────────────────────────

  /** Wait until the helper answers again; one shared wait per outage. */
  private waitForHelper(): Promise<void> {
    this.outage ??= (async () => {
      this.options.onReconnecting?.(true);
      const every = this.options.retryMs ?? 1_500;
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, every));
        if (await this.options.ping().catch(() => false)) break;
      }
      this.options.onReconnecting?.(false);
    })().finally(() => {
      this.outage = null;
    });
    return this.outage;
  }

  /** One call that outlasts an outage: it waits, then asks again. */
  private async request<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
    for (;;) {
      try {
        return (await this.call(cmd, args)) as T;
      } catch (error) {
        if (!this.options.unreachable(error)) throw error;
        await this.waitForHelper();
      }
    }
  }

  /** Mutations run one at a time, in order; each stays pending through an
   * outage and is retried with `retry = true` once the helper answers. */
  private mutate<T>(op: PendingOp, send: (retry: boolean) => Promise<T>): Promise<T> {
    this.pending.push(op);
    this.mutations += 1;
    const run = this.chain.then(async () => {
      let retry = false;
      for (;;) {
        try {
          return await send(retry);
        } catch (error) {
          if (!this.options.unreachable(error)) throw error;
          retry = true;
          await this.waitForHelper();
        }
      }
    });
    const settle = () => {
      // the acknowledgement counts too: a walk out while it landed is stale
      this.mutations += 1;
      const at = this.pending.indexOf(op);
      if (at >= 0) this.pending.splice(at, 1);
      if (this.pending.length === 0) this.options.onDrained?.();
    };
    run.then(settle, settle);
    this.chain = run.catch(() => undefined);
    return run;
  }

  // ── the cached view ────────────────────────────────────────────────────────

  private async fresh(): Promise<void> {
    if (this.walkedAt > 0 && Date.now() - this.walkedAt < (this.options.freshMs ?? 2_000)) return;
    this.walking ??= this.walk().finally(() => {
      this.walking = null;
    });
    await this.walking;
  }

  private async walk(): Promise<void> {
    const before = this.mutations;
    const listed = await this.request<WalkEntry[]>("vault_walk", { path: "" });
    // a local write landed while the walk was out: its view may predate it
    if (this.mutations !== before) return this.walk();
    const next = new Map<string, Entry>();
    for (const e of listed) next.set(e.path, { kind: e.kind, lastModified: e.lastModified, size: e.size });
    this.entries = next;
    this.walkedAt = Date.now();
  }

  private noteFile(path: string, stat: VaultStat, text?: string): void {
    for (let dir = parentOf(path); dir; dir = parentOf(dir)) {
      if (!this.entries.has(dir))
        this.entries.set(dir, { kind: "directory", lastModified: stat.lastModified, size: 0 });
    }
    const entry: Entry = { kind: "file", lastModified: stat.lastModified, size: stat.size };
    this.entries.set(path, entry);
    if (text === undefined) this.texts.delete(path);
    else this.texts.set(path, { revision: revisionOf(entry), text });
  }

  // ── VaultDir ───────────────────────────────────────────────────────────────

  async list(path: string): Promise<VaultDirEntry[]> {
    await this.fresh();
    const dir = normalize(path);
    const out: VaultDirEntry[] = [];
    for (const [key, entry] of this.entries) {
      if (key !== dir && parentOf(key) === dir) out.push({ name: nameOf(key), kind: entry.kind });
    }
    return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  async exists(path: string): Promise<boolean> {
    const key = normalize(path);
    if (!key) return true;
    await this.fresh();
    return this.entries.has(key);
  }

  async stat(path: string): Promise<VaultStat | null> {
    const key = normalize(path);
    if (!key) return { lastModified: 0, size: 0 };
    await this.fresh();
    const entry = this.entries.get(key);
    return entry ? { lastModified: entry.lastModified, size: entry.size } : null;
  }

  async readText(path: string): Promise<string> {
    const key = normalize(path);
    await this.fresh();
    const entry = this.entries.get(key);
    const cached = this.texts.get(key);
    if (entry?.kind === "file" && cached?.revision === revisionOf(entry)) return cached.text;
    if (entry?.kind === "file" && PREFETCHED.test(key)) {
      await this.prefetch(key);
      const read = this.texts.get(key);
      if (read?.revision === revisionOf(entry)) return read.text;
    }
    const text = await this.request<string>("vault_read", { path: key });
    if (entry?.kind === "file") this.texts.set(key, { revision: revisionOf(entry), text });
    return text;
  }

  /** Every unread note, in as few calls as the helper's budget allows —
   * `first` leads so the caller's own file is in the first answer. */
  private async prefetch(first: string): Promise<void> {
    const wanted = [first];
    for (const [key, entry] of this.entries) {
      if (key === first || entry.kind !== "file" || !PREFETCHED.test(key)) continue;
      if (this.texts.get(key)?.revision !== revisionOf(entry)) wanted.push(key);
    }
    let queue = wanted;
    while (queue.length > 0) {
      const batch = queue.slice(0, READ_BATCH);
      const answer = await this.request<{ files: Record<string, string | null>; more: string[] }>(
        "vault_read_many",
        { paths: batch },
      );
      for (const [key, text] of Object.entries(answer.files)) {
        const entry = this.entries.get(key);
        if (text !== null && entry?.kind === "file")
          this.texts.set(key, { revision: revisionOf(entry), text });
      }
      queue = [...answer.more, ...queue.slice(READ_BATCH)];
      if (answer.more.length === batch.length) break; // nothing fit: read on demand instead
    }
  }

  async readBytes(path: string): Promise<Uint8Array> {
    return fromBase64(
      await this.request<string>("vault_read", { path: normalize(path), encoding: "base64" }),
    );
  }

  writeText(path: string, text: string): Promise<void> {
    return this.write(normalize(path), { text }, text);
  }

  writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    return this.write(normalize(path), { base64: toBase64(bytes) });
  }

  /** Every write is revision-gated: the helper refuses it when the file on
   * disk isn't the one this tab last saw (Rotli for Mac, or another tab,
   * wrote it meanwhile), so nothing is overwritten silently. The revision is
   * read when the write is SENT, after earlier writes in the queue landed. */
  private async write(key: string, body: { text?: string; base64?: string }, text?: string): Promise<void> {
    if (!key) throw new Error("a file needs a name");
    const op: PendingOp = { kind: "write", path: key, base: revisionOf(this.entries.get(key)), ...body };
    let base: string | null = null;
    await this.mutate(op, async (retry) => {
      if (base === null && this.walkedAt === 0) await this.fresh();
      base ??= revisionOf(this.entries.get(key));
      op.base = base;
      // the text this tab last saw in the file, when it knows it
      const seen = this.texts.get(key);
      const gate =
        seen && seen.revision === base
          ? { expectedContent: contentRevision(seen.text) }
          : { expectedRevision: base };
      let stat: VaultStat;
      try {
        stat = (await this.call("vault_write", { path: key, ...body, ...gate })) as VaultStat;
      } catch (error) {
        // a retried write whose first attempt DID land (the answer was lost):
        // the file already holds exactly these bytes, which is success
        const landed =
          retry &&
          isConflict(error) &&
          text !== undefined &&
          (await this.request<string>("vault_read", { path: key })) === text;
        if (!landed) {
          // the file changed on disk: the next list/stat must see it
          if (isConflict(error)) this.invalidate();
          throw error;
        }
        stat = await this.request<VaultStat>("vault_stat", { path: key });
      }
      this.noteFile(key, stat, text);
    });
  }

  async mkdir(path: string): Promise<void> {
    const key = normalize(path);
    if (!key) return;
    await this.mutate({ kind: "mkdir", path: key }, () => this.call("vault_mkdir", { path: key }));
    for (let dir = key; dir; dir = parentOf(dir)) {
      if (!this.entries.has(dir))
        this.entries.set(dir, { kind: "directory", lastModified: Date.now(), size: 0 });
    }
  }

  async move(from: string, to: string): Promise<void> {
    const source = normalize(from);
    const target = normalize(to);
    if (source === target) return;
    await this.mutate({ kind: "move", from: source, to: target }, () =>
      this.call("vault_move", { from: source, to: target }),
    );
    const entry = this.entries.get(source);
    const text = this.texts.get(source);
    this.entries.delete(source);
    this.texts.delete(source);
    if (entry) this.noteFile(target, entry, text?.text);
  }

  /** A file is removed only if it is still the version this tab saw — a note
   * the desktop app changed meanwhile is kept (409). Folders aren't gated. */
  async remove(path: string): Promise<void> {
    const key = normalize(path);
    // decide against what is really there, never against an empty cache
    if (!this.entries.has(key)) await this.fresh();
    const entry = this.entries.get(key);
    if (!entry) return; // nothing there: the port's "missing is a no-op"
    const base = entry.kind === "file" ? revisionOf(entry) : "";
    const seen = this.texts.get(key);
    const gate =
      entry.kind !== "file"
        ? { directory: true } // a folder removal never deletes a file that took its name
        : seen && seen.revision === base
          ? { expectedContent: contentRevision(seen.text) }
          : { expectedRevision: base };
    await this.mutate({ kind: "remove", path: key, base }, () =>
      this.call("vault_remove", { path: key, ...gate }).catch((error: unknown) => {
        if (isConflict(error)) this.invalidate();
        throw error;
      }),
    );
    this.entries.delete(key);
    this.texts.delete(key);
  }
}
