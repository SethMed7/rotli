// App chords over an Excalidraw board (2026-10-08). Excalidraw answers every
// chord it knows on its own container and stops it there, so the dispatcher
// takes modifier chords over a canvas in the capture phase — except the few
// the canvas keeps. The press below replays the browser's order: window
// capture listeners, then the canvas (a stand-in that stops what it handles),
// then window bubble listeners.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { attachDispatcher, registerAction } from "./registry";

type Listener = (event: KeyboardEvent) => void;

class FakeElement {
  constructor(
    readonly inCanvas: boolean,
    readonly tagName = "DIV",
  ) {}
  readonly isContentEditable = false;
  closest(): FakeElement | null {
    return this.inCanvas ? this : null;
  }
}

const g = globalThis as unknown as { HTMLElement?: unknown; window: Record<string, unknown> };
const savedHTMLElement = g.HTMLElement;
const savedAdd = g.window.addEventListener;
const savedRemove = g.window.removeEventListener;
let capture: Listener[] = [];
let bubble: Listener[] = [];
let detach: (() => void) | null = null;
const ran: string[] = [];

beforeAll(() => {
  g.HTMLElement = FakeElement;
  g.window.addEventListener = (_type: string, fn: Listener, opts?: { capture?: boolean }) => {
    (opts?.capture ? capture : bubble).push(fn);
  };
  g.window.removeEventListener = (_type: string, fn: Listener, opts?: { capture?: boolean }) => {
    if (opts?.capture) capture = capture.filter((l) => l !== fn);
    else bubble = bubble.filter((l) => l !== fn);
  };
  attachDispatcher("main")(); // drop any dispatcher another file left attached
  detach = attachDispatcher("main");
  for (const [id, chord] of [
    // an app chord the canvas also claims stands in as ⌘F19 (⌘K in the app):
    // the registry is shared module state across files in one run
    ["t.palette", "Meta+F19"],
    ["t.splitRight", "Meta+D"],
    ["t.secure", "Meta+Shift+L"],
    ["t.bare", "F18"],
  ] as const) {
    registerAction({ id, title: id, defaultChord: chord, run: () => ran.push(id) });
  }
});

afterEach(() => {
  ran.length = 0;
});

afterAll(() => {
  detach?.();
  g.HTMLElement = savedHTMLElement;
  g.window.addEventListener = savedAdd;
  g.window.removeEventListener = savedRemove;
});

/** Press a key on `target`. `vendorCapture` is Excalidraw's own window-capture
 * listener (its palette and search), attached after the app's dispatcher. */
function press(
  code: string,
  mods: { meta?: boolean; shift?: boolean },
  target: FakeElement,
  canvasStops: boolean,
): { canvasRan: boolean; vendorCaptureRan: boolean } {
  let stopped = false;
  let immediate = false;
  let prevented = false;
  const event = {
    code,
    metaKey: mods.meta ?? false,
    shiftKey: mods.shift ?? false,
    ctrlKey: false,
    altKey: false,
    repeat: false,
    target,
    get defaultPrevented() {
      return prevented;
    },
    preventDefault: () => {
      prevented = true;
    },
    stopPropagation: () => {
      stopped = true;
    },
    stopImmediatePropagation: () => {
      stopped = true;
      immediate = true;
    },
  } as unknown as KeyboardEvent;
  let vendorCaptureRan = false;
  for (const listener of [...capture, () => (vendorCaptureRan = true)]) {
    if (immediate) break;
    listener(event);
  }
  let canvasRan = false;
  if (!stopped && target.inCanvas) {
    canvasRan = true;
    if (canvasStops) event.stopPropagation();
  }
  if (!stopped) for (const listener of bubble) listener(event);
  return { canvasRan, vendorCaptureRan };
}

const onCanvas = new FakeElement(true);
const offCanvas = new FakeElement(false);

describe("app chords over a board", () => {
  test("an app chord the canvas also knows (⌘K) runs the app action, and only it", () => {
    const result = press("F19", { meta: true }, onCanvas, true);
    expect(ran).toEqual(["t.palette"]);
    expect(result).toEqual({ canvasRan: false, vendorCaptureRan: false });
  });

  test("a chord the canvas keeps (⌘D duplicate) reaches the canvas, not the app", () => {
    const result = press("KeyD", { meta: true }, onCanvas, true);
    expect(ran).toEqual([]);
    expect(result.canvasRan).toBe(true);
  });

  test("a kept chord with Shift matches however its modifiers are spelled (⌘⇧L lock)", () => {
    press("KeyL", { meta: true, shift: true }, onCanvas, true);
    expect(ran).toEqual([]);
  });

  test("bare keys stay the canvas's first: one it handles never reaches the app", () => {
    expect(press("F18", {}, onCanvas, true).canvasRan).toBe(true);
    expect(ran).toEqual([]);
    press("F18", {}, onCanvas, false);
    expect(ran).toEqual(["t.bare"]);
  });

  test("off the canvas an app chord runs exactly once, in the bubble phase", () => {
    press("F19", { meta: true }, offCanvas, false);
    expect(ran).toEqual(["t.palette"]);
  });
});
