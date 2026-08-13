// The quit-flush registry (#4 follow-up): every registered flusher runs, and a
// rejecting flusher never blocks the rest, but prevents a successful quit ack.

import { describe, expect, test } from "bun:test";

import { onQuitFlush, runQuitFlushers } from "./quitFlush";

describe("runQuitFlushers", () => {
  test("runs every registered flusher and rejects when any save fails", async () => {
    const ran: string[] = [];
    const unregister = [
      onQuitFlush(() => {
        ran.push("sync");
      }),
    ];
    unregister.push(
      onQuitFlush(async () => {
        ran.push("async");
      }),
    );
    unregister.push(
      onQuitFlush(() => {
        ran.push("thrower");
        throw new Error("disk full");
      }),
    );
    unregister.push(
      onQuitFlush(async () => {
        ran.push("rejector");
        return Promise.reject(new Error("read-only root"));
      }),
    );
    await expect(runQuitFlushers()).rejects.toThrow("2 save operations failed");
    expect(ran.sort()).toEqual(["async", "rejector", "sync", "thrower"]);
    unregister.forEach((fn) => fn());
  });

  test("an unregistered flusher no longer runs — per-mount cleanup must not leak", async () => {
    const ran: string[] = [];
    const unregister = onQuitFlush(() => {
      ran.push("unmounted-board");
    });
    const keep = onQuitFlush(() => {
      ran.push("still-mounted");
    });
    unregister();
    await runQuitFlushers();
    keep();
    expect(ran).toEqual(["still-mounted"]);
  });

  test("holds the ack until a SLOW async flusher's write actually lands", async () => {
    // the data-safety contract behind the editor/persist registrations: the
    // returned promise must be awaited, not fire-and-forgotten
    let landed = false;
    const unregister = onQuitFlush(async () => {
      await new Promise((r) => setTimeout(r, 30));
      landed = true;
    });
    await runQuitFlushers();
    unregister();
    expect(landed).toBe(true);
  });
});
