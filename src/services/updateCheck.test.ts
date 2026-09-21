import { describe, expect, test } from "bun:test";

import { UPDATE_CHECK_EVERY_MS, UPDATE_CHECK_LAUNCH_DELAY_MS, createRoutineUpdateCheck } from "./updateCheck";

/** A hand-cranked clock + timer, so the routine is proven without waiting. */
function harness(options: {
  enabled?: boolean;
  feed?: () => Promise<{ available: boolean; version?: string }>;
}) {
  let now = 0;
  let enabled = options.enabled ?? true;
  let visible = true;
  const timers: { at: number; fn: () => void }[] = [];
  const seen: Array<{ available: boolean; version: string | null }> = [];
  let calls = 0;
  const routine = createRoutineUpdateCheck({
    now: () => now,
    enabled: () => enabled,
    visible: () => visible,
    check: async () => {
      calls += 1;
      return (options.feed ?? (async () => ({ available: false })))();
    },
    report: (available, version) => seen.push({ available, version }),
    setTimer: (fn, ms) => {
      const timer = { at: now + ms, fn };
      timers.push(timer);
      return () => {
        const i = timers.indexOf(timer);
        if (i >= 0) timers.splice(i, 1);
      };
    },
  });
  const advance = async (ms: number) => {
    now += ms;
    for (const timer of timers.filter((t) => t.at <= now)) {
      timers.splice(timers.indexOf(timer), 1);
      timer.fn();
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return {
    routine,
    advance,
    seen,
    calls: () => calls,
    timers,
    setEnabled: (on: boolean) => (enabled = on),
    setVisible: (on: boolean) => (visible = on),
  };
}

describe("the routine update check", () => {
  test("asks once shortly after launch, then a few times a day — never in a tight loop", async () => {
    const h = harness({ feed: async () => ({ available: true, version: "1.4.0" }) });
    h.routine.start();
    expect(h.calls()).toBe(0);
    await h.advance(UPDATE_CHECK_LAUNCH_DELAY_MS);
    expect(h.calls()).toBe(1);
    expect(h.seen).toEqual([{ available: true, version: "1.4.0" }]);
    await h.advance(UPDATE_CHECK_EVERY_MS - 1);
    expect(h.calls()).toBe(1);
    await h.advance(1);
    expect(h.calls()).toBe(2);
    expect(h.timers).toHaveLength(1);
  });

  test("turned off, it never touches the network; turned back on, the next wake asks", async () => {
    const h = harness({ enabled: false });
    h.routine.start();
    await h.advance(UPDATE_CHECK_LAUNCH_DELAY_MS + UPDATE_CHECK_EVERY_MS);
    expect(h.calls()).toBe(0);
    h.setEnabled(true);
    await h.routine.wake();
    expect(h.calls()).toBe(1);
  });

  test("waking the window only asks again once the interval has passed (a Mac asleep stalls timers)", async () => {
    const h = harness({});
    h.routine.start();
    await h.advance(UPDATE_CHECK_LAUNCH_DELAY_MS);
    await h.routine.wake();
    expect(h.calls()).toBe(1);
    h.timers.length = 0; // the sleeping Mac never fired the timer
    await h.advance(UPDATE_CHECK_EVERY_MS);
    await h.routine.wake();
    expect(h.calls()).toBe(2);
  });

  test("a hidden window waits for its next wake instead of checking in the background", async () => {
    const h = harness({});
    h.setVisible(false);
    h.routine.start();
    await h.advance(UPDATE_CHECK_LAUNCH_DELAY_MS);
    expect(h.calls()).toBe(0);
    h.setVisible(true);
    await h.routine.wake();
    expect(h.calls()).toBe(1);
  });

  test("being offline is ordinary: a failed check reports nothing and the routine carries on", async () => {
    let fail = true;
    const h = harness({
      feed: async () => {
        if (fail) throw new Error("offline");
        return { available: true, version: "1.4.0" };
      },
    });
    h.routine.start();
    await h.advance(UPDATE_CHECK_LAUNCH_DELAY_MS);
    expect(h.seen).toEqual([]);
    fail = false;
    await h.advance(UPDATE_CHECK_EVERY_MS);
    expect(h.seen).toEqual([{ available: true, version: "1.4.0" }]);
  });

  test("stop clears the pending timer", async () => {
    const h = harness({});
    h.routine.start();
    h.routine.stop();
    expect(h.timers).toHaveLength(0);
  });
});
