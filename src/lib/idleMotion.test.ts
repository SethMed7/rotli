import { describe, expect, test } from "bun:test";

import { IDLE_ATTRIBUTE, IDLE_HIDDEN, attachIdleMotion } from "./idleMotion";

/** A document stand-in — `bun test` has no real DOM (test-setup.ts installs the
 * smallest possible globals), so the visibility wiring is exercised directly. */
function fakeDoc(hidden = false) {
  const attributes = new Map<string, string>();
  const listeners = new Map<string, Array<() => void>>();
  return {
    hidden,
    attributes,
    documentElement: {
      setAttribute: (name: string, value: string) => void attributes.set(name, value),
      removeAttribute: (name: string) => void attributes.delete(name),
    },
    addEventListener: (type: string, handler: () => void) => {
      listeners.set(type, [...(listeners.get(type) ?? []), handler]);
    },
    removeEventListener: (type: string, handler: () => void) => {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((entry) => entry !== handler),
      );
    },
    fire: (type: string) => {
      for (const handler of listeners.get(type) ?? []) handler();
    },
    listenerCount: (type: string) => (listeners.get(type) ?? []).length,
  };
}

describe("attachIdleMotion", () => {
  test("stamps nothing while the window is visible", () => {
    const doc = fakeDoc(false);
    attachIdleMotion(doc);
    expect(doc.attributes.get(IDLE_ATTRIBUTE)).toBeUndefined();
  });

  test("stamps immediately when attached while already hidden", () => {
    const doc = fakeDoc(true);
    attachIdleMotion(doc);
    expect(doc.attributes.get(IDLE_ATTRIBUTE)).toBe(IDLE_HIDDEN);
  });

  test("follows visibility both ways", () => {
    const doc = fakeDoc(false);
    attachIdleMotion(doc);

    doc.hidden = true;
    doc.fire("visibilitychange");
    expect(doc.attributes.get(IDLE_ATTRIBUTE)).toBe(IDLE_HIDDEN);

    doc.hidden = false;
    doc.fire("visibilitychange");
    expect(doc.attributes.get(IDLE_ATTRIBUTE)).toBeUndefined();
  });

  test("detach removes the listener and stops responding", () => {
    const doc = fakeDoc(false);
    const detach = attachIdleMotion(doc);
    expect(doc.listenerCount("visibilitychange")).toBe(1);

    detach();
    expect(doc.listenerCount("visibilitychange")).toBe(0);

    doc.hidden = true;
    doc.fire("visibilitychange");
    expect(doc.attributes.get(IDLE_ATTRIBUTE)).toBeUndefined();
  });

  test("no document, no crash — detach stays callable", () => {
    const detach = attachIdleMotion(undefined as never);
    expect(() => detach()).not.toThrow();
  });
});
