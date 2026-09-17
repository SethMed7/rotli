import { expect, test } from "bun:test";

import { DROP_OVER_ATTR, chatDropAt, DropCueMarker, chatDropTargetAt, registerChatDrop } from "./chatDrop";

function pane(id: string): Element {
  return { closest: () => ({ getAttribute: () => id }) } as unknown as Element;
}

test("a blind chat refuses an image before its attachment importer can run", () => {
  const attached: string[][] = [];
  let refused = 0;
  const stop = registerChatDrop(
    "blind",
    (paths) => attached.push([...paths]),
    false,
    () => refused++,
  );
  chatDropAt(pane("blind"))?.(["/synthetic/grid.png"]);
  expect(refused).toBe(1);
  expect(attached).toEqual([]);
  stop();
});

test("a vision chat receives the paths once; unmount and replacement do not leave stale targets", () => {
  let oldCalls = 0;
  const stopOld = registerChatDrop(
    "vision",
    () => oldCalls++,
    false,
    () => oldCalls++,
  );
  const attached: string[][] = [];
  const stop = registerChatDrop(
    "vision",
    (paths) => attached.push([...paths]),
    true,
    () => {
      throw new Error("vision images must attach");
    },
  );
  stopOld();
  chatDropAt(pane("vision"))?.(["/synthetic/grid.png"]);
  expect(attached).toEqual([["/synthetic/grid.png"]]);
  expect(oldCalls).toBe(0);
  stop();
  expect(chatDropAt(pane("vision"))).toBeNull();
});

test("the hover cue names what a drop would do, and only for a registered pane", () => {
  const stop = registerChatDrop(
    "seeing",
    () => {},
    true,
    () => {},
  );
  const stopBlind = registerChatDrop(
    "blind-pane",
    () => {},
    false,
    () => {},
  );
  expect(chatDropTargetAt(pane("seeing"))?.cue).toBe("attach");
  expect(chatDropTargetAt(pane("blind-pane"))?.cue).toBe("blind");
  expect(chatDropTargetAt(pane("never-registered"))).toBeNull();
  expect(chatDropTargetAt(null)).toBeNull();
  stop();
  stopBlind();
  expect(chatDropTargetAt(pane("seeing"))).toBeNull();
});

test("the cue marker writes once per change and moves between panes", () => {
  const host = (name: string) => {
    const attrs = new Map<string, string>();
    return {
      name,
      writes: 0,
      getAttribute: (key: string) => attrs.get(key) ?? null,
      setAttribute(key: string, value: string) {
        this.writes += 1;
        attrs.set(key, value);
      },
      removeAttribute: (key: string) => void attrs.delete(key),
    };
  };
  const a = host("a");
  const b = host("b");
  const marker = new DropCueMarker();
  marker.show(a, "attach");
  marker.show(a, "attach");
  marker.show(a, "attach");
  expect(a.writes).toBe(1);
  expect(a.getAttribute(DROP_OVER_ATTR)).toBe("attach");
  marker.show(a, "blind");
  expect(a.writes).toBe(2);
  marker.show(b, "web");
  expect(a.getAttribute(DROP_OVER_ATTR)).toBeNull();
  expect(b.getAttribute(DROP_OVER_ATTR)).toBe("web");
  marker.clear();
  expect(b.getAttribute(DROP_OVER_ATTR)).toBeNull();
  expect(marker.current).toBeNull();
});
