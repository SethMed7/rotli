// pointerDrag — the shared drag-session mechanics every pointer drag rides
// (remediation Batch 4). Bun tests run without a DOM (test-setup.ts installs
// listener-only stand-ins), so these tests swap in a recording window stub —
// the exact surface the session touches — and drive the full lifecycle by
// dispatching synthetic pointer/keyboard events at the captured listeners.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { DragGhost } from "./dragGhost";
import { type PointerDragOptions, createPointerDragSession } from "./pointerDrag";

interface Listener {
  fn: (e: unknown) => void;
  capture: boolean;
  once: boolean;
}

const g = globalThis as unknown as { window: unknown };
let savedWindow: unknown;
let listeners: Map<string, Listener[]>;

const captureOf = (opts: unknown): boolean =>
  opts === true ||
  (typeof opts === "object" && opts !== null && (opts as { capture?: boolean }).capture === true);

beforeEach(() => {
  savedWindow = g.window;
  listeners = new Map();
  g.window = {
    addEventListener: (type: string, fn: (e: unknown) => void, opts?: unknown) => {
      const list = listeners.get(type) ?? [];
      list.push({
        fn,
        capture: captureOf(opts),
        once: typeof opts === "object" && opts !== null && (opts as { once?: boolean }).once === true,
      });
      listeners.set(type, list);
    },
    removeEventListener: (type: string, fn: (e: unknown) => void, opts?: unknown) => {
      const capture = captureOf(opts);
      const list = listeners.get(type) ?? [];
      const i = list.findIndex((l) => l.fn === fn && l.capture === capture);
      if (i >= 0) list.splice(i, 1);
    },
  };
});

afterEach(() => {
  g.window = savedWindow;
});

/** Fire every listener registered for `type` (once-listeners self-remove, like the DOM). */
function dispatch(type: string, e: unknown): void {
  for (const l of [...(listeners.get(type) ?? [])]) {
    if (l.once) {
      const list = listeners.get(type) ?? [];
      const i = list.indexOf(l);
      if (i >= 0) list.splice(i, 1);
    }
    l.fn(e);
  }
}

const press = (x = 100, y = 100, button = 0): ReactPointerEvent =>
  ({ button, clientX: x, clientY: y }) as unknown as ReactPointerEvent;

const move = (x: number, y: number) => dispatch("pointermove", { clientX: x, clientY: y });
const up = () => dispatch("pointerup", {});

function escEvent(): {
  key: string;
  preventDefault: () => void;
  stopPropagation: () => void;
  prevented: boolean;
  stopped: boolean;
} {
  const e = {
    key: "Escape",
    prevented: false,
    stopped: false,
    preventDefault() {
      e.prevented = true;
    },
    stopPropagation() {
      e.stopped = true;
    },
  };
  return e;
}

/** A ghost + callback recorder capturing the whole lifecycle in call order. */
function recorder(extra?: Partial<PointerDragOptions>) {
  const calls: string[] = [];
  const ghosts: { created: [number, number]; moves: [number, number][]; destroys: number }[] = [];
  const opts: PointerDragOptions = {
    ghost: (x, y) => {
      const rec = { created: [x, y] as [number, number], moves: [] as [number, number][], destroys: 0 };
      ghosts.push(rec);
      calls.push(`ghost@${x},${y}`);
      const ghost: DragGhost = {
        move: (nx, ny) => {
          rec.moves.push([nx, ny]);
          calls.push(`ghostMove@${nx},${ny}`);
        },
        destroy: () => {
          rec.destroys += 1;
          calls.push("ghostDestroy");
        },
      };
      return ghost;
    },
    onStart: (x, y) => calls.push(`start@${x},${y}`),
    onMove: (x, y) => calls.push(`move@${x},${y}`),
    onDrop: () => calls.push("drop"),
    onEnd: () => calls.push("end"),
    ...extra,
  };
  return { calls, ghosts, opts };
}

const listenerCount = () => [...listeners.values()].reduce((n, list) => n + list.length, 0);

describe("createPointerDragSession", () => {
  test("non-left button registers nothing", () => {
    const { opts } = recorder();
    createPointerDragSession(press(0, 0, 2), opts);
    expect(listenerCount()).toBe(0);
  });

  test("press registers the 4 window listeners; keydown is capture-phase", () => {
    const { opts } = recorder();
    createPointerDragSession(press(), opts);
    expect(listeners.get("pointermove")?.length).toBe(1);
    expect(listeners.get("pointerup")?.length).toBe(1);
    expect(listeners.get("pointercancel")?.length).toBe(1);
    expect(listeners.get("keydown")?.length).toBe(1);
    expect(listeners.get("keydown")?.[0]?.capture).toBe(true);
    up();
  });

  test("a plain click (travel under the Manhattan threshold) never starts: no ghost, no onStart/onDrop, but onEnd + full teardown", () => {
    const { calls, ghosts, opts } = recorder();
    createPointerDragSession(press(100, 100), opts);
    move(102, 102); // |2| + |2| = 4 < 5
    up();
    expect(ghosts.length).toBe(0);
    expect(calls).toEqual(["end"]);
    expect(listenerCount()).toBe(0);
  });

  test("crossing the threshold paints the ghost at that move, fires onStart once, then ghost-move + onMove every move", () => {
    const { calls, opts } = recorder();
    createPointerDragSession(press(100, 100), opts);
    move(103, 102); // sum 5 → starts
    move(120, 90);
    expect(calls).toEqual([
      "ghost@103,102",
      "start@103,102",
      "ghostMove@103,102",
      "move@103,102",
      "ghostMove@120,90",
      "move@120,90",
    ]);
    up();
  });

  test("drop after a real drag: onDrop runs BEFORE ghost destroy + onEnd (commits may read state onEnd clears)", () => {
    const { calls, ghosts, opts } = recorder();
    createPointerDragSession(press(0, 0), opts);
    move(10, 0);
    up();
    expect(calls.slice(-3)).toEqual(["drop", "ghostDestroy", "end"]);
    expect(ghosts[0]?.destroys).toBe(1);
    expect(listenerCount()).toBe(0);
  });

  test("Esc mid-drag cancels: event swallowed, ghost destroyed, no onDrop, onEnd fires, listeners gone", () => {
    const { calls, ghosts, opts } = recorder();
    createPointerDragSession(press(0, 0), opts);
    move(10, 0);
    const esc = escEvent();
    dispatch("keydown", esc);
    expect(esc.prevented).toBe(true);
    expect(esc.stopped).toBe(true);
    expect(ghosts[0]?.destroys).toBe(1);
    expect(calls).not.toContain("drop");
    expect(calls.at(-1)).toBe("end");
    expect(listenerCount()).toBe(0);
  });

  test("pointercancel mid-drag tears down without a drop", () => {
    const { calls, ghosts, opts } = recorder();
    createPointerDragSession(press(0, 0), opts);
    move(10, 0);
    dispatch("pointercancel", {});
    expect(ghosts[0]?.destroys).toBe(1);
    expect(calls).not.toContain("drop");
    expect(calls.at(-1)).toBe("end");
    expect(listenerCount()).toBe(0);
  });

  test("thresholdPx tunes the Manhattan start distance", () => {
    const { ghosts, opts } = recorder({ thresholdPx: 10 });
    createPointerDragSession(press(0, 0), opts);
    move(5, 4); // sum 9 < 10
    expect(ghosts.length).toBe(0);
    move(5, 5); // sum 10 → starts
    expect(ghosts.length).toBe(1);
    up();
  });

  test("passedThreshold override wins (tabDrag's either-axis feel)", () => {
    const { ghosts, opts } = recorder({
      passedThreshold: (dx, dy) => Math.abs(dx) >= 5 || Math.abs(dy) >= 5,
    });
    createPointerDragSession(press(0, 0), opts);
    move(2, 2); // Manhattan 4 AND both axes < 5 → idle either way
    expect(ghosts.length).toBe(0);
    move(0, 5); // Manhattan 5 would also start, but the axis test is what fires
    expect(ghosts.length).toBe(1);
    up();
  });

  test("swallowClick: a real drag arms a capture-once click swallower; the trailing click is eaten", () => {
    const { opts } = recorder({ swallowClick: true });
    createPointerDragSession(press(0, 0), opts);
    move(10, 0);
    up();
    const armed = listeners.get("click") ?? [];
    expect(armed.length).toBe(1);
    expect(armed[0]?.capture).toBe(true);
    expect(armed[0]?.once).toBe(true);
    const click = escEvent(); // reuse the prevented/stopped recorder shape
    dispatch("click", click);
    expect(click.prevented).toBe(true);
    expect(click.stopped).toBe(true);
    expect(listeners.get("click")?.length ?? 0).toBe(0); // once → self-removed
  });

  test("swallowClick: a plain click (no drag) arms nothing", () => {
    const { opts } = recorder({ swallowClick: true });
    createPointerDragSession(press(0, 0), opts);
    up();
    expect(listeners.get("click")?.length ?? 0).toBe(0);
  });

  test("no swallowClick: nothing is armed even after a real drag", () => {
    const { opts } = recorder();
    createPointerDragSession(press(0, 0), opts);
    move(10, 0);
    up();
    expect(listeners.get("click")?.length ?? 0).toBe(0);
  });

  test("two overlapping sessions tear down independently (Esc reaches both; each destroys only its own ghost)", () => {
    const a = recorder();
    const b = recorder();
    createPointerDragSession(press(0, 0), a.opts);
    createPointerDragSession(press(0, 0), b.opts);
    move(10, 0); // both start
    expect(a.ghosts.length).toBe(1);
    expect(b.ghosts.length).toBe(1);
    dispatch("keydown", escEvent());
    expect(a.ghosts[0]?.destroys).toBe(1);
    expect(b.ghosts[0]?.destroys).toBe(1);
    expect(listenerCount()).toBe(0);
  });
});
