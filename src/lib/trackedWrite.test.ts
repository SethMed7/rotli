// The main.json race repro (perf audit 2026-07-30, correctness #3): two
// back-to-back writes whose completions land out of order. Without the
// sequence guard the FIRST (stale) completion reported last and the caller
// believed the old tree was the saved one.

import { describe, expect, test } from "bun:test";

import { createTrackedWrite } from "./trackedWrite";

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
    // completions land out of order: the NEWER write settles first
    gates[1]!.resolve();
    await Promise.resolve();
    gates[0]!.resolve();
    await Promise.resolve();
    expect(reports).toEqual([{ payload: "new-tree", ok: true }]);
  });

  test("a stale FAILURE stays silent too — only the latest outcome surfaces", async () => {
    const gates = [deferred(), deferred()];
    let calls = 0;
    const reports: Array<{ ok: boolean; error?: unknown }> = [];
    const write = createTrackedWrite(() => gates[calls++]!.promise);
    write("a", (ok, error) => reports.push({ ok, error }));
    write("b", (ok, error) => reports.push({ ok, error }));
    gates[1]!.resolve();
    await Promise.resolve();
    gates[0]!.reject(new Error("stale disk error"));
    // a rejected stale promise must not surface (nor go unhandled)
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
