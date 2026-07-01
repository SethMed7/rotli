// dragGhost — the one floating ghost every pointer drag paints. Bun tests run
// without a DOM (test-setup.ts installs listener-only stand-ins), so these
// tests swap in a minimal document stub: just createElement + body.appendChild
// + Element.remove, the exact surface the helper touches.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createDragGhost } from "./dragGhost";

interface StubEl {
  className: string;
  textContent: string;
  style: Record<string, string>;
  remove(): void;
}

const g = globalThis as unknown as { document: unknown };
let savedDocument: unknown;
let body: StubEl[];

beforeEach(() => {
  savedDocument = g.document;
  body = [];
  g.document = {
    createElement: (): StubEl => {
      const el: StubEl = {
        className: "",
        textContent: "",
        style: {},
        remove() {
          const i = body.indexOf(el);
          if (i >= 0) body.splice(i, 1); // detached remove() is a no-op, like the DOM
        },
      };
      return el;
    },
    body: { appendChild: (el: StubEl) => body.push(el) },
  };
});

afterEach(() => {
  g.document = savedDocument;
});

describe("createDragGhost", () => {
  test("paints a .drag-ghost with the label at the pointer, attached to body", () => {
    createDragGhost("My note", 40, 60);
    expect(body.length).toBe(1);
    const el = body[0]!;
    expect(el.className).toBe("drag-ghost"); // pointer-events:none lives on this class
    expect(el.textContent).toBe("My note");
    expect(el.style.left).toBe("40px");
    expect(el.style.top).toBe("60px");
  });

  test("move follows the pointer", () => {
    const ghost = createDragGhost("x", 0, 0);
    ghost.move(120, 8);
    expect(body[0]!.style.left).toBe("120px");
    expect(body[0]!.style.top).toBe("8px");
  });

  test("destroy removes it; a second destroy (overlapping exit paths) is safe", () => {
    const ghost = createDragGhost("x", 0, 0);
    ghost.destroy();
    expect(body.length).toBe(0);
    expect(() => ghost.destroy()).not.toThrow();
  });

  test("two live ghosts never collide (Esc during one drag can't eat another's)", () => {
    const a = createDragGhost("a", 0, 0);
    createDragGhost("b", 0, 0);
    a.destroy();
    expect(body.map((e) => e.textContent)).toEqual(["b"]);
  });
});
