// The main.json race repro (perf audit 2026-07-30, correctness #3): two
// back-to-back writes whose completions land out of order. Without the
// sequence guard the FIRST (stale) completion reported last and the caller
// believed the old tree was the saved one.

import { describe, expect, test } from "bun:test";

import {
  createRevisionedTrackedWrite,
  createTrackedWrite,
  isRevisionConflict,
  recoverRevisionConflict,
} from "./trackedWrite";

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (e: Error) => void } {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createTrackedWrite", () => {
  test("manifest writes are serialized so an older payload cannot land after a newer one", async () => {
    const gates = [deferred(), deferred()];
    const started: string[] = [];
    const write = createTrackedWrite((payload) => {
      started.push(payload);
      return gates[started.length - 1]!.promise;
    });

    write("old-tree", () => {});
    write("new-tree", () => {});

    expect(started).toEqual(["old-tree"]);
    gates[0]!.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(started).toEqual(["old-tree", "new-tree"]);
    gates[1]!.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });

  test("a stale completion never reports over the newest call", async () => {
    const gates = [deferred(), deferred()];
    const started: string[] = [];
    const reports: Array<{ payload: string; ok: boolean }> = [];
    const write = createTrackedWrite((payload) => {
      started.push(payload);
      return gates[started.length - 1]!.promise;
    });
    write("old-tree", (ok) => reports.push({ payload: "old-tree", ok }));
    write("new-tree", (ok) => reports.push({ payload: "new-tree", ok }));
    // The old write lands first but no longer reports success once a newer
    // payload is queued. Only then may the newer write begin.
    gates[0]!.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(reports).toEqual([]);
    gates[1]!.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(reports).toEqual([{ payload: "new-tree", ok: true }]);
  });

  test("a stale FAILURE stays silent too — only the latest outcome surfaces", async () => {
    const gates = [deferred(), deferred()];
    let calls = 0;
    const reports: Array<{ ok: boolean; error?: unknown }> = [];
    const write = createTrackedWrite(() => gates[calls++]!.promise);
    write("a", (ok, error) => reports.push({ ok, error }));
    write("b", (ok, error) => reports.push({ ok, error }));
    gates[0]!.reject(new Error("stale disk error"));
    await new Promise((r) => setTimeout(r, 0));
    // A rejected stale promise stays silent and does not poison the queue.
    gates[1]!.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(reports).toEqual([{ ok: true, error: undefined }]);
  });

  test("the latest call's failure DOES surface with its error", async () => {
    const write = createTrackedWrite(() => Promise.reject(new Error("read-only volume")));
    const reports: Array<{ ok: boolean; message: string }> = [];
    write("tree", (ok, error) =>
      reports.push({ ok, message: error instanceof Error ? error.message : String(error) }),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(reports).toEqual([{ ok: false, message: "read-only volume" }]);
  });
});

describe("createRevisionedTrackedWrite", () => {
  test("each queued payload uses the revision returned by the preceding write", async () => {
    const calls: Array<{ payload: string; revision: string }> = [];
    const writer = createRevisionedTrackedWrite(async (payload, revision) => {
      calls.push({ payload, revision });
      return `r${calls.length + 1}`;
    });
    writer.setRevision("r1");

    writer.write("first", () => {});
    writer.write("second", () => {});
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls).toEqual([
      { payload: "first", revision: "r1" },
      { payload: "second", revision: "r2" },
    ]);
  });

  test("refuses to invent a revision before hydration", async () => {
    let called = false;
    const reports: Array<{ ok: boolean; message: string }> = [];
    const writer = createRevisionedTrackedWrite(async () => {
      called = true;
      return "r2";
    });
    writer.write("tree", (ok, error) =>
      reports.push({ ok, message: error instanceof Error ? error.message : String(error) }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(called).toBe(false);
    expect(reports).toEqual([
      { ok: false, message: "The vault projection has no revision. Reload it before editing." },
    ]);
  });

  test("remembers the contents that sit at its revision", async () => {
    const writer = createRevisionedTrackedWrite(async () => "r2");
    writer.setRevision("r1", "hydrated");
    expect(writer.synced()).toBe("hydrated");
    writer.write("edited", () => {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(writer.synced()).toBe("edited");
  });
});

describe("revision conflict recovery", () => {
  const conflict = new Error(
    "revision conflict: expected r1, found r9; the file changed after it was opened",
  );

  test("recognizes the host and the browser vault wording, and nothing else", () => {
    expect(isRevisionConflict(conflict)).toBe(true);
    expect(isRevisionConflict(new Error("revision conflict on main: expected 3, found 4"))).toBe(true);
    expect(isRevisionConflict(new Error("disk full"))).toBe(false);
    expect(isRevisionConflict("revision conflict")).toBe(false);
  });

  test("a wedged writer saves again after one quiet re-read", async () => {
    let disk = { contents: "cli", revision: "r9" };
    const writer = createRevisionedTrackedWrite(async (payload, expected) => {
      if (expected !== disk.revision) throw conflict;
      disk = { contents: payload, revision: `${disk.revision}+` };
      return disk.revision;
    });
    writer.setRevision("r1", "base");

    const failures: unknown[] = [];
    writer.write("mine", (ok, error) => !ok && failures.push(error));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(failures).toEqual([conflict]);

    const outcome = await recoverRevisionConflict({
      writer,
      read: async () => disk,
      current: () => true,
      merge: (base, remote) => `${base}|${remote}|mine`,
    });
    expect(outcome).toEqual({ remote: "cli", merged: "base|cli|mine" });

    const reports: boolean[] = [];
    writer.write(outcome?.merged ?? "", (ok) => reports.push(ok));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reports).toEqual([true]);
    expect(disk.contents).toBe("base|cli|mine");
  });

  test("a newer edit owns the outcome — the older recovery adopts nothing", async () => {
    const writer = createRevisionedTrackedWrite(async () => "r2");
    writer.setRevision("r1", "base");
    const outcome = await recoverRevisionConflict({
      writer,
      read: async () => ({ contents: "cli", revision: "r9" }),
      current: () => false,
      merge: () => "never",
    });
    expect(outcome).toBeNull();
    expect(writer.synced()).toBe("base");
  });
});
