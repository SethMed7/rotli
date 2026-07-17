import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import {
  acquireProcessLock,
  safeLockKey,
  tryAcquireProcessLock,
} from "../scripts/processLock";

const root = () => mkdtempSync(join(tmpdir(), "breve-lock-"));

describe("Breve cross-process locks", () => {
  test("only one live owner can hold a key", () => {
    const dir = root();
    const first = tryAcquireProcessLock(dir, "scheduler", { pid: 101, isAlive: (pid) => pid === 101 });
    const second = tryAcquireProcessLock(dir, "scheduler", { pid: 202, isAlive: (pid) => pid === 101 });

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    first!.release();
    expect(tryAcquireProcessLock(dir, "scheduler", { pid: 202, isAlive: () => true })).not.toBeNull();
  });

  test("recovers a lock whose owner died", () => {
    const dir = root();
    const stale = tryAcquireProcessLock(dir, "job-watchers", { pid: 101, isAlive: () => true });
    expect(stale).not.toBeNull();

    const recovered = tryAcquireProcessLock(dir, "job-watchers", { pid: 202, isAlive: () => false });
    expect(recovered).not.toBeNull();
    const owner = JSON.parse(readFileSync(join(recovered!.path, "owner.json"), "utf8"));
    expect(owner.pid).toBe(202);

    stale!.release();
    expect(readFileSync(join(recovered!.path, "owner.json"), "utf8")).toContain('"pid":202');
    recovered!.release();
  });

  test("does not steal a directory while its owner record is initializing", () => {
    const dir = root();
    const path = join(dir, "locks", "scheduler.lock");
    mkdirSync(path, { recursive: true });
    expect(tryAcquireProcessLock(dir, "scheduler", { pid: 202, isAlive: () => false })).toBeNull();
    writeFileSync(join(path, "owner.json"), '{"pid":101,"token":"x","acquiredAt":"2026-07-13T00:00:00.000Z"}\n');
  });

  test("waits for a held lock and acquires after release", async () => {
    const dir = root();
    const first = tryAcquireProcessLock(dir, "delivery-brief", { pid: process.pid });
    setTimeout(() => first!.release(), 25);
    const second = await acquireProcessLock(dir, "delivery-brief", { waitMs: 250, pollMs: 10 });
    expect(second).not.toBeNull();
    second!.release();
  });

  test("sanitizes filesystem lock keys", () => {
    expect(safeLockKey("morning/2026-07-13 signal")).toBe("morning-2026-07-13-signal");
    expect(() => safeLockKey("///")).toThrow("empty");
  });

  test("serializes real OS processes and recovers after a crashed owner", async () => {
    const dir = root();
    const moduleUrl = pathToFileURL(join(import.meta.dir, "../scripts/processLock.ts")).href;
    const worker = `
      import { tryAcquireProcessLock } from ${JSON.stringify(moduleUrl)};
      const lock = tryAcquireProcessLock(process.env.LOCK_ROOT, "integration");
      if (!lock) { console.log("busy"); process.exit(0); }
      console.log("acquired");
      await Bun.sleep(Number(process.env.HOLD_MS ?? 0));
      lock.release();
    `;
    const spawn = (holdMs: number) => Bun.spawn([process.execPath, "-e", worker], {
      env: { ...process.env, LOCK_ROOT: dir, HOLD_MS: String(holdMs) },
      stdout: "pipe",
      stderr: "pipe",
    });

    const owner = spawn(5_000);
    const ownerFile = join(dir, "locks", "integration.lock", "owner.json");
    for (let i = 0; i < 100 && !(await Bun.file(ownerFile).exists()); i++) await Bun.sleep(10);
    expect(await Bun.file(ownerFile).exists()).toBe(true);

    try {
      const contender = spawn(0);
      expect((await new Response(contender.stdout).text()).trim()).toBe("busy");
      expect(await contender.exited).toBe(0);

      owner.kill("SIGKILL");
      await owner.exited;
      const recovered = spawn(0);
      expect((await new Response(recovered.stdout).text()).trim()).toBe("acquired");
      expect(await recovered.exited).toBe(0);
    } finally {
      try { owner.kill("SIGKILL"); } catch {}
    }
  });
});
