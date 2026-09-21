import { afterEach, describe, expect, test } from "bun:test";

import { LEADER_TIMEOUT_MS, cancelLeader, enterLeader, leaderConsumes, useLeaderStore } from "./leader";

afterEach(() => cancelLeader());

function mode(id: "views" | "sidebar" = "views") {
  const picked: number[] = [];
  let ended = 0;
  enterLeader({ id, pick: (n) => picked.push(n), onEnd: () => (ended += 1) });
  return { picked, ended: () => ended };
}

describe("two-step hotkeys", () => {
  test("with no leader pending, every key passes through untouched", () => {
    expect(leaderConsumes("Meta+1")).toBe(false);
    expect(useLeaderStore.getState().mode).toBeNull();
  });

  test("the second step is ⌘number or the bare number, and it ends the mode", () => {
    const a = mode();
    expect(useLeaderStore.getState().mode).toBe("views");
    expect(leaderConsumes("Meta+3")).toBe(true);
    expect(a.picked).toEqual([3]);
    expect(a.ended()).toBe(1);
    expect(useLeaderStore.getState().mode).toBeNull();
    // the mode is over: ⌘3 is a tab jump again
    expect(leaderConsumes("Meta+3")).toBe(false);

    const b = mode("sidebar");
    expect(leaderConsumes("9")).toBe(true);
    expect(b.picked).toEqual([9]);
  });

  test("Esc cancels without picking, and is consumed so it cannot also hide the window", () => {
    const a = mode("sidebar");
    expect(leaderConsumes("Esc")).toBe(true);
    expect(a.picked).toEqual([]);
    expect(a.ended()).toBe(1);
  });

  test("any other chord abandons the mode and still does its own job", () => {
    const a = mode();
    expect(leaderConsumes("Meta+K")).toBe(false);
    expect(a.ended()).toBe(1);
    expect(leaderConsumes("Meta+1")).toBe(false);
  });

  test("⌘0 is not a slot", () => {
    const a = mode();
    expect(leaderConsumes("Meta+0")).toBe(false);
    expect(a.picked).toEqual([]);
  });

  test("a forgotten leader times out on its own", async () => {
    const a = mode();
    expect(LEADER_TIMEOUT_MS).toBeGreaterThanOrEqual(2000);
    cancelLeader();
    expect(a.ended()).toBe(1);
    enterLeader({ id: "views", pick: () => {} }, 5);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(useLeaderStore.getState().mode).toBeNull();
  });

  test("entering a second leader ends the first", () => {
    const a = mode("views");
    const b = mode("sidebar");
    expect(a.ended()).toBe(1);
    expect(useLeaderStore.getState().mode).toBe("sidebar");
    expect(leaderConsumes("Meta+2")).toBe(true);
    expect(b.picked).toEqual([2]);
    expect(a.picked).toEqual([]);
  });
});
