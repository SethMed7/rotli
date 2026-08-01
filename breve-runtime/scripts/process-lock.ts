/**
 * Cross-process lock directories for the managed Breve runtime.
 *
 * `mkdir` is the atomic claim. The owner record makes locks recoverable after a
 * crash without letting a second live process steal them. Release is
 * token-checked so an old owner can never remove a newer owner's lock.
 */
import {
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

type LockOwner = {
  pid: number;
  token: string;
  acquiredAt: string;
};

export type ProcessLock = {
  path: string;
  release: () => void;
};

export type ProcessLockOptions = {
  pid?: number;
  now?: () => number;
  isAlive?: (pid: number) => boolean;
  initializationGraceMs?: number;
};

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

export function safeLockKey(value: string): string {
  const key = value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!key) throw new Error("Breve lock key is empty");
  return key.slice(0, 180);
}

export function processIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === "EPERM";
  }
}

function readOwner(path: string): LockOwner | null {
  try {
    const value = JSON.parse(readFileSync(join(path, "owner.json"), "utf8")) as Partial<LockOwner>;
    return Number.isInteger(value.pid) && typeof value.token === "string" && typeof value.acquiredAt === "string"
      ? value as LockOwner
      : null;
  } catch {
    return null;
  }
}

/** Try once. A missing owner record is treated as a live initialization race
 * for a short grace period instead of being removed underneath its creator. */
export function tryAcquireProcessLock(
  root: string,
  key: string,
  options: ProcessLockOptions = {},
): ProcessLock | null {
  const locks = join(root, "locks");
  const path = join(locks, `${safeLockKey(key)}.lock`);
  const pid = options.pid ?? process.pid;
  const now = options.now ?? Date.now;
  const isAlive = options.isAlive ?? processIsAlive;
  const initializationGraceMs = options.initializationGraceMs ?? 2_000;
  mkdirSync(locks, { recursive: true });

  for (let attempt = 0; attempt < 3; attempt++) {
    const token = randomUUID();
    let created = false;
    try {
      mkdirSync(path);
      created = true;
      const owner: LockOwner = { pid, token, acquiredAt: new Date(now()).toISOString() };
      writeFileSync(join(path, "owner.json"), `${JSON.stringify(owner)}\n`, { flag: "wx" });
      let released = false;
      return {
        path,
        release: () => {
          if (released) return;
          released = true;
          const current = readOwner(path);
          if (current?.token !== token) return;
          try { rmSync(path, { recursive: true, force: true }); } catch {}
        },
      };
    } catch (error) {
      if (errorCode(error) !== "EEXIST") {
        // A failed owner write may leave the directory behind. Only this
        // process could have created it in this attempt, so remove it safely.
        if (created) try { rmSync(path, { recursive: true, force: true }); } catch {}
        throw error;
      }
    }

    const owner = readOwner(path);
    if (owner && isAlive(owner.pid)) return null;
    if (!owner) {
      try {
        if (now() - statSync(path).mtimeMs < initializationGraceMs) return null;
      } catch {
        continue;
      }
    }
    try { rmSync(path, { recursive: true, force: true }); } catch {}
  }
  return null;
}

export async function acquireProcessLock(
  root: string,
  key: string,
  options: ProcessLockOptions & { waitMs?: number; pollMs?: number } = {},
): Promise<ProcessLock | null> {
  const waitMs = Math.max(0, options.waitMs ?? 0);
  const pollMs = Math.max(10, options.pollMs ?? 100);
  const deadline = Date.now() + waitMs;
  // both exits are inside the body: the lock, or the deadline.
  for (;;) {
    const lock = tryAcquireProcessLock(root, key, options);
    if (lock) return lock;
    if (Date.now() >= deadline) return null;
    await Bun.sleep(Math.min(pollMs, Math.max(1, deadline - Date.now())));
  }
}
