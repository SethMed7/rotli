// The rebind layer: overrides keyed by action id over the registry defaults.
// An entry present with null = explicitly UNBOUND (distinct from "no override,
// use the default"). resolveChord is the one place that distinction is read.

import { beforeEach, describe, expect, test } from "bun:test";

import { resolveChord, useBindingsStore } from "./bindings";

describe("resolveChord", () => {
  test("returns the default when the action has no override", () => {
    expect(resolveChord({}, "note.new", "Meta+N")).toBe("Meta+N");
  });

  test("returns the override when one is present", () => {
    expect(resolveChord({ "note.new": "Meta+Shift+N" }, "note.new", "Meta+N")).toBe("Meta+Shift+N");
  });

  test("treats an explicit null override as UNBOUND (not 'fall back to default')", () => {
    // the action id IS in overrides with value null → the chord is removed,
    // even though a default exists. This is the load-bearing distinction.
    expect(resolveChord({ "note.new": null }, "note.new", "Meta+N")).toBeNull();
  });

  test("passes a null default straight through when there is no override", () => {
    expect(resolveChord({}, "some.unbound.action", null)).toBeNull();
  });
});

describe("useBindingsStore", () => {
  beforeEach(() => {
    useBindingsStore.setState({ overrides: {} });
  });

  test("starts with no overrides", () => {
    expect(useBindingsStore.getState().overrides).toEqual({});
  });

  test("setOverride records a remap", () => {
    useBindingsStore.getState().setOverride("note.new", "Meta+Shift+N");
    expect(useBindingsStore.getState().overrides["note.new"]).toBe("Meta+Shift+N");
  });

  test("setOverride with null records an explicit unbind (key present, value null)", () => {
    useBindingsStore.getState().setOverride("note.new", null);
    const { overrides } = useBindingsStore.getState();
    expect("note.new" in overrides).toBe(true);
    expect(overrides["note.new"]).toBeNull();
    // and resolveChord honors it as unbound
    expect(resolveChord(overrides, "note.new", "Meta+N")).toBeNull();
  });

  test("setOverride merges without dropping earlier entries", () => {
    const store = useBindingsStore.getState();
    store.setOverride("a", "Meta+A");
    store.setOverride("b", "Meta+B");
    expect(useBindingsStore.getState().overrides).toEqual({ a: "Meta+A", b: "Meta+B" });
  });
});
