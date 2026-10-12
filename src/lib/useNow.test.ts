import { expect, test } from "bun:test";

import { NOW_TICK_MS, createNowClock } from "./useNow";

/** A visibility-aware document (a real EventTarget) plus a hand-cranked
 * interval table. `listening` reports whether the clock still watches it. */
function fakeEnv(hidden = false) {
  let listeners = 0;
  const doc = Object.assign(new EventTarget(), { hidden });
  const add = doc.addEventListener.bind(doc);
  const remove = doc.removeEventListener.bind(doc);
  doc.addEventListener = (type: string, fn: EventListenerOrEventListenerObject | null) => (
    listeners++,
    add(type, fn)
  );
  doc.removeEventListener = (type: string, fn: EventListenerOrEventListenerObject | null) => (
    listeners--,
    remove(type, fn)
  );
  const timers = new Map<number, () => void>();
  let clock = 1_000;
  let id = 0;
  return {
    env: {
      doc,
      setInterval: (fn: () => void, ms: number) => {
        expect(ms).toBe(NOW_TICK_MS);
        timers.set(++id, fn);
        return id;
      },
      clearInterval: (id: number) => void timers.delete(id),
    },
    timers,
    listening: () => listeners > 0,
    now: () => clock,
    advance: (ms: number) => {
      clock += ms;
      for (const fn of [...timers.values()]) fn();
    },
    setHidden: (value: boolean) => {
      doc.hidden = value;
      doc.dispatchEvent(new Event("visibilitychange"));
    },
  };
}

test("a visible window ticks the shared clock", () => {
  const fake = fakeEnv();
  const store = createNowClock(() => fake.env, fake.now);
  let calls = 0;
  const off = store.subscribe(() => calls++);
  expect(fake.timers.size).toBe(1);
  fake.advance(NOW_TICK_MS);
  expect(calls).toBe(1);
  expect(store.getSnapshot()).toBe(1_000 + NOW_TICK_MS);
  off();
  expect(fake.timers.size).toBe(0);
  expect(fake.listening()).toBe(false);
});

test("a hidden window holds no interval, and showing it refreshes once and re-arms", () => {
  const fake = fakeEnv();
  const store = createNowClock(() => fake.env, fake.now);
  let calls = 0;
  store.subscribe(() => calls++);
  fake.setHidden(true);
  expect(fake.timers.size).toBe(0);
  expect(calls).toBe(0);
  fake.advance(5 * NOW_TICK_MS);
  fake.setHidden(false);
  expect(calls).toBe(1);
  expect(store.getSnapshot()).toBe(1_000 + 5 * NOW_TICK_MS);
  expect(fake.timers.size).toBe(1);
});

test("subscribing while hidden arms nothing until the window is shown", () => {
  const fake = fakeEnv(true);
  const store = createNowClock(() => fake.env, fake.now);
  const off = store.subscribe(() => {});
  expect(fake.timers.size).toBe(0);
  fake.setHidden(false);
  expect(fake.timers.size).toBe(1);
  off();
  expect(fake.timers.size).toBe(0);
});
