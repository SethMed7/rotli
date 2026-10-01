import { describe, expect, test } from "bun:test";

import { createPersistDrain } from "./persistDrain";

describe("createPersistDrain — settings survive a transient write failure", () => {
  test("a failed write leaves the mark behind, so the next drain retries the payload", async () => {
    const landed: string[] = [];
    let fail = true;
    const drain = createPersistDrain(
      // oxlint-disable-next-line typescript/no-misused-promises -- tsgolint preview misreads comma-expression arrow bodies as a Promise in a boolean conditional
      (_key, payload) => (fail ? Promise.reject(new Error("io")) : (landed.push(payload), Promise.resolve())),
      { settings: () => "A", viewstate: () => "" },
      { settings: "init", viewstate: "" },
      () => {},
    );
    await drain(); // transient failure — nothing landed
    expect(landed).toEqual([]);
    fail = false;
    await drain(); // no store change since, but the payload MUST retry
    expect(landed).toEqual(["A"]);
  });

  test("a landed payload is not rewritten", async () => {
    let writes = 0;
    const drain = createPersistDrain(
      // oxlint-disable-next-line typescript/no-misused-promises -- tsgolint preview misreads comma-expression arrow bodies as a Promise in a boolean conditional
      () => (writes++, Promise.resolve()),
      { settings: () => "A", viewstate: () => "" },
      { settings: "init", viewstate: "" },
      () => {},
    );
    await drain();
    await drain();
    expect(writes).toBe(1);
  });

  test("onFailure fires so the saver can re-arm, and only settled keys advance", async () => {
    let failures = 0;
    const landed: string[] = [];
    const drain = createPersistDrain(
      // oxlint-disable typescript/no-misused-promises -- tsgolint preview misreads comma-expression arrow bodies as a Promise in a boolean conditional
      (key, payload) =>
        key === "viewstate" ? Promise.reject(new Error("io")) : (landed.push(payload), Promise.resolve()),
      // oxlint-enable typescript/no-misused-promises
      { settings: () => "S", viewstate: () => "V" },
      { settings: "init-s", viewstate: "init-v" },
      () => failures++,
    );
    await drain();
    expect(landed).toEqual(["S"]);
    expect(failures).toBe(1);
    await drain(); // settings already landed; only viewstate retries
    expect(landed).toEqual(["S"]);
    expect(failures).toBe(2);
  });
});
