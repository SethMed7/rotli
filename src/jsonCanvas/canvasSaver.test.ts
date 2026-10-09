import { expect, test } from "bun:test";

import { CANVAS_CONFLICT, createCanvasSaver } from "./canvasSaver";
import type { CanvasDoc } from "./model";

const doc = (text: string): CanvasDoc => ({
  nodes: [{ id: "a", type: "text", text, x: 0, y: 0, width: 10, height: 10 }],
  edges: [],
});

/** A saver whose writes resolve or reject only when the test says so. */
function harness() {
  const writes: { text: string; revision: string; settle: (ok: boolean) => void }[] = [];
  const errors: [string, boolean][] = [];
  let saved = 0;
  const timers: (() => void)[] = [];
  const saver = createCanvasSaver({
    revision: "r0",
    delayMs: 500,
    schedule: (run) => timers.push(run),
    cancel: () => {},
    write: (text, revision) =>
      new Promise<string>((resolve, reject) => {
        writes.push({
          text,
          revision,
          settle: (ok) => (ok ? resolve(`r${writes.length}`) : reject(new Error("disk full"))),
        });
      }),
    onSaved: () => saved++,
    onError: (message, conflicted) => errors.push([message, conflicted]),
  });
  return { saver, writes, errors, timers, saved: () => saved };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("writes go one at a time, newest last, each over the revision the last one left", async () => {
  const { saver, writes } = harness();
  saver.queue(doc("one"));
  const first = saver.flush();
  await tick();
  // "one" is being written when "two" arrives
  saver.queue(doc("two"));
  const second = saver.flush();
  await tick();
  // the second write waits for the first
  expect(writes.map((w) => w.text.includes("one"))).toEqual([true]);
  writes[0]!.settle(true);
  await first;
  await tick();
  expect(writes[1]?.text).toContain('"two"');
  expect(writes[1]?.revision).toBe("r1");
  writes[1]!.settle(true);
  await second;
});

test("a failed write keeps the edit queued, retries it, and rejects so quit can stop", async () => {
  const { saver, writes, errors, saved } = harness();
  saver.queue(doc("keep me"));
  const failing = saver.flush();
  await tick();
  writes[0]!.settle(false);
  await expect(failing).rejects.toThrow("disk full");
  expect(errors).toEqual([["disk full", false]]);
  // the same doc goes out again on the next flush
  const retry = saver.flush();
  await tick();
  expect(writes[1]?.text).toContain('"keep me"');
  writes[1]!.settle(true);
  await retry;
  expect(saved()).toBe(1);
  // nothing left: a further flush writes nothing
  await saver.flush();
  expect(writes).toHaveLength(2);
});

test("a revision conflict stops edits and says so plainly, Mac or web wording alike", async () => {
  for (const wording of ["revision conflict: expected r0, found r9", "This canvas changed on disk"]) {
    const errors: [string, boolean][] = [];
    const saver = createCanvasSaver({
      revision: "r0",
      delayMs: 0,
      schedule: () => null,
      cancel: () => {},
      write: () => Promise.reject(new Error(wording)),
      onSaved: () => {},
      onError: (message, conflicted) => errors.push([message, conflicted]),
    });
    saver.queue(doc("x"));
    await expect(saver.flush()).rejects.toThrow();
    expect(errors).toEqual([[CANVAS_CONFLICT, true]]);
    expect(saver.conflicted).toBe(true);
    expect(saver.queue(doc("y"))).toBe(false);
  }
});

test("the beat after the last edit saves once, with the latest doc", async () => {
  const { saver, writes, timers } = harness();
  saver.queue(doc("a"));
  saver.queue(doc("ab"));
  timers.at(-1)!();
  await tick();
  expect(writes).toHaveLength(1);
  expect(writes[0]?.text).toContain('"ab"');
  writes[0]!.settle(true);
});
