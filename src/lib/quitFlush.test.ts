// The quit-flush registry (#4 follow-up): every registered flusher runs, and a
// rejecting flusher never blocks the rest (or the ack — quit must not hang).

import { describe, expect, test } from "bun:test";
import { onQuitFlush, runQuitFlushers } from "./quitFlush";

describe("runQuitFlushers", () => {
  test("runs every registered flusher and settles even when one throws", async () => {
    const ran: string[] = [];
    onQuitFlush(() => {
      ran.push("sync");
    });
    onQuitFlush(async () => {
      ran.push("async");
    });
    onQuitFlush(() => {
      ran.push("thrower");
      throw new Error("disk full");
    });
    onQuitFlush(async () => {
      ran.push("rejector");
      return Promise.reject(new Error("read-only root"));
    });
    // resolves — a failed flush is a skipped flush, never a hung quit
    await runQuitFlushers();
    expect(ran.sort()).toEqual(["async", "rejector", "sync", "thrower"]);
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
    onQuitFlush(async () => {
      await new Promise((r) => setTimeout(r, 30));
      landed = true;
    });
    await runQuitFlushers();
    expect(landed).toBe(true);
  });
});
