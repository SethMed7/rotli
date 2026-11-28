import { expect, test } from "bun:test";

import { setupOrder } from "../host/registry";
import { onboardingPhaseOf } from "./onboardingPhase";
import { phaseOfStep, setupStepNow, stepAfter, stepBefore, stepCount, stepOfPhase } from "./setupSequence";

// A synthetic host order: You, a step of its own, then the folder.
const HOSTED = ["you", "synthetic-tools", "vault"] as const;

test("standalone Rotli keeps its four steps, counted and walked as before", () => {
  const order = setupOrder(null);
  expect(order).toEqual(["you", "vault", "librarian", "shortcuts"]);
  expect(order.map((step) => stepCount(step, order))).toEqual(["1 of 4", "2 of 4", "3 of 4", "4 of 4"]);
  expect(order.map((step) => stepAfter(step, order))).toEqual(["vault", "librarian", "shortcuts", null]);
  expect(order.map((step) => stepBefore(step, order))).toEqual([null, "you", "vault", "librarian"]);
  expect(order.map(phaseOfStep)).toEqual(["preferences", "vault", "librarian", "shortcuts"]);
  for (const phase of ["preferences", "vault", "librarian", "shortcuts"] as const)
    expect(phaseOfStep(setupStepNow(phase, order))).toBe(phase);
  expect(setupStepNow("skipped", order)).toBe("skipped");
});

test("a host's own step is saved as host:<id> and read back", () => {
  expect(phaseOfStep("synthetic-tools")).toBe("host:synthetic-tools");
  expect(stepOfPhase("host:synthetic-tools")).toBe("synthetic-tools");
  expect(onboardingPhaseOf("host:synthetic-tools")).toBe("host:synthetic-tools");
  expect(onboardingPhaseOf("host:not a step!")).toBe("preferences");
  expect(setupStepNow("host:synthetic-tools", HOSTED)).toBe("synthetic-tools");
  expect(stepAfter("synthetic-tools", HOSTED)).toBe("vault");
  expect(stepCount("vault", HOSTED)).toBe("3 of 3");
});

test("a saved phase the order doesn't hold starts again at the first step", () => {
  // a host step since removed
  expect(setupStepNow("host:gone", HOSTED)).toBe("you");
  // a step of Rotli's the host left out
  expect(setupStepNow("librarian", HOSTED)).toBe("you");
  // standalone Rotli reading a host's phase
  expect(setupStepNow("host:synthetic-tools", setupOrder(null))).toBe("you");
});
