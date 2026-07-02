// The quit-flush registry (#4 follow-up): every registered flusher runs, and a
// rejecting flusher never blocks the rest (or the ack — quit must not hang).

import { describe, expect, it } from "bun:test";
import { onQuitFlush, runQuitFlushers } from "./quitFlush";

describe("runQuitFlushers", () => {
  it("runs every registered flusher and settles even when one throws", async () => {
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
});
