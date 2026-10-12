import { expect, test } from "bun:test";

import { sameTaskRequest } from "./sameTaskRequest";

const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));

test("callers in one synchronous run share one request", async () => {
  let calls = 0;
  const list = sameTaskRequest(() => Promise.resolve({ n: ++calls }));
  const [a, b, c] = await Promise.all([list(), list(), list()]);
  expect(calls).toBe(1);
  expect(a).toBe(b);
  expect(b).toBe(c);
});

test("a caller in a LATER task never joins an earlier request (it could predate a write)", async () => {
  let calls = 0;
  let release: (() => void) | undefined;
  const list = sameTaskRequest(
    () =>
      new Promise<number>((resolve) => {
        calls += 1;
        release = () => resolve(calls);
      }),
  );
  const first = list();
  await nextTask(); // the first request is still in flight
  const second = list();
  expect(calls).toBe(2);
  release?.();
  expect(await second).toBe(2);
  void first;
});

test("a caller after a microtask checkpoint issues its own request", async () => {
  let calls = 0;
  const list = sameTaskRequest(() => Promise.resolve(++calls));
  const first = list();
  await Promise.resolve();
  const second = list();
  expect(await first).toBe(1);
  expect(await second).toBe(2);
});

test("a failure is shared by its own task and does not stick", async () => {
  let calls = 0;
  const list = sameTaskRequest(() => {
    calls += 1;
    return calls === 1 ? Promise.reject(new Error("walk failed")) : Promise.resolve("ok");
  });
  const results = await Promise.allSettled([list(), list()]);
  expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
  expect(await list()).toBe("ok");
  expect(calls).toBe(2);
});
