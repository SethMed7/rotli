import { expect, test } from "bun:test";

import { chatDropAt, registerChatDrop } from "./chatDrop";

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
