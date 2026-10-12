import { expect, test } from "bun:test";

import { pauseRenderWhileHidden, pauseWhileHidden } from "./pauseWhileHidden";

function unit(active = true) {
  return {
    active,
    isActive() {
      return this.active;
    },
    activate() {
      this.active = true;
    },
    deactivate() {
      this.active = false;
    },
  };
}

function fakeObserver() {
  let report: (visible: boolean) => void = () => {};
  let stopped = false;
  return {
    observe: (_: Element, cb: (visible: boolean) => void) => {
      report = cb;
      return () => {
        stopped = true;
      };
    },
    report: (visible: boolean) => report(visible),
    stopped: () => stopped,
  };
}

test("a hidden editor stops rendering and resumes when shown", () => {
  const units = [unit(), unit()];
  const watch = fakeObserver();
  pauseWhileHidden({} as Element, () => units, watch.observe);
  watch.report(false);
  expect(units.map((u) => u.active)).toEqual([false, false]);
  watch.report(true);
  expect(units.map((u) => u.active)).toEqual([true, true]);
});

test("a unit Univer left inactive is never woken by the pause", () => {
  const units = [unit(true), unit(false)];
  const watch = fakeObserver();
  pauseWhileHidden({} as Element, () => units, watch.observe);
  watch.report(false);
  watch.report(true);
  expect(units.map((u) => u.active)).toEqual([true, false]);
});

test("release stops watching and resumes anything still paused", () => {
  const units = [unit()];
  const watch = fakeObserver();
  const { release } = pauseWhileHidden({} as Element, () => units, watch.observe);
  watch.report(false);
  release();
  expect(watch.stopped()).toBe(true);
  expect(units[0]?.active).toBe(true);
});

test("a render unit created while hidden is paused at once, and only once", () => {
  const watch = fakeObserver();
  let onCreated: () => void = () => {};
  const made: { active: boolean; deactivations: number }[] = [];
  const all = new Map<string, unknown>();
  const renderUnit = () => {
    const state = { active: true, deactivations: 0 };
    made.push(state);
    return {
      activated$: { subscribe: (next: (v: boolean) => void) => (next(state.active), { unsubscribe() {} }) },
      activate: () => void (state.active = true),
      deactivate: () => void ((state.active = false), state.deactivations++),
    };
  };
  all.set("doc", renderUnit());
  const manager = {
    getRenderAll: () => all as Map<string, ReturnType<typeof renderUnit>>,
    created$: { subscribe: (next: () => void) => ((onCreated = next), { unsubscribe() {} }) },
  };
  const release = pauseRenderWhileHidden({} as Element, manager, watch.observe);
  watch.report(false);
  all.set("late", renderUnit());
  onCreated();
  onCreated();
  expect(made.map((m) => m.active)).toEqual([false, false]);
  expect(made.map((m) => m.deactivations)).toEqual([1, 1]);
  watch.report(true);
  expect(made.map((m) => m.active)).toEqual([true, true]);
  release();
});
