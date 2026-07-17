import { describe, expect, test } from "bun:test";
import { nextWatcherFailure, resetWatcherFailure } from "../scripts/watcherFailure";

describe("Breve watcher failure notifications", () => {
  test("alerts exactly when a fresh streak reaches five", () => {
    expect(nextWatcherFailure({ fails: 4, failureAlerted: false })).toEqual({
      fails: 5,
      alreadyAlerted: false,
      shouldAlert: true,
    });
  });

  test("does not repeat an acknowledged streak", () => {
    expect(nextWatcherFailure({ fails: 8, failureAlerted: true }).shouldAlert).toBe(false);
  });

  test("migrates a legacy over-threshold counter without another warning", () => {
    expect(nextWatcherFailure({ fails: 591 }).shouldAlert).toBe(false);
    expect(nextWatcherFailure({ fails: 591 }).alreadyAlerted).toBe(true);
  });

  test("emits once per streak and becomes eligible again only after recovery", () => {
    let state = resetWatcherFailure();
    let alerts = 0;
    for (let i = 0; i < 8; i++) {
      const decision = nextWatcherFailure(state);
      if (decision.shouldAlert) alerts++;
      state = { fails: decision.fails, failureAlerted: decision.alreadyAlerted || decision.shouldAlert };
    }
    expect(alerts).toBe(1);

    state = resetWatcherFailure();
    for (let i = 0; i < 5; i++) {
      const decision = nextWatcherFailure(state);
      if (decision.shouldAlert) alerts++;
      state = { fails: decision.fails, failureAlerted: decision.alreadyAlerted || decision.shouldAlert };
    }
    expect(alerts).toBe(2);
  });
});
