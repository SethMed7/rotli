import { expect, test } from "bun:test";

import { refreshWhenVisible } from "./refreshWhenVisible";

function fakeDocument(hidden: boolean) {
  const listeners = new Set<() => void>();
  return {
    hidden,
    addEventListener: (_: "visibilitychange", fn: () => void) => listeners.add(fn),
    removeEventListener: (_: "visibilitychange", fn: () => void) => listeners.delete(fn),
    show() {
      this.hidden = false;
      for (const fn of listeners) fn();
    },
    listeners,
  };
}

test("a visible window refreshes at once", () => {
  const doc = fakeDocument(false);
  let runs = 0;
  const refresh = refreshWhenVisible(() => runs++, doc);
  refresh.run();
  expect(runs).toBe(1);
});

test("a hidden window folds every change into ONE refresh when it is shown", () => {
  const doc = fakeDocument(true);
  let runs = 0;
  const refresh = refreshWhenVisible(() => runs++, doc);
  for (let i = 0; i < 300; i++) refresh.run();
  expect(runs).toBe(0);
  doc.show();
  expect(runs).toBe(1);
  doc.show();
  expect(runs).toBe(1);
});

test("stop removes the visibility listener", () => {
  const doc = fakeDocument(true);
  const refresh = refreshWhenVisible(() => {}, doc);
  refresh.stop();
  expect(doc.listeners.size).toBe(0);
});
