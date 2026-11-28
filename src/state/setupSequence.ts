// First run's steps in order, under a host or not (host/registry.ts,
// HostFirstRun): which step a saved phase means, what comes next and before,
// and where a step sits in the count. Pure, so setup and its tests share it.
// Standalone Rotli's order is its four steps, so nothing here changes them.

import { SETUP_STEPS } from "../host/registry";
import type { OnboardingPhase } from "./onboardingPhase";

const BUILT_IN: readonly string[] = SETUP_STEPS;

/** The phase a step is saved as: "you" is "preferences", a host's step is
 * "host:<id>", and Rotli's others are their own ids. */
export function phaseOfStep(step: string): OnboardingPhase {
  if (step === "you") return "preferences";
  return BUILT_IN.includes(step) ? (step as OnboardingPhase) : `host:${step}`;
}

/** The step a saved phase names, or null for "skipped". */
export function stepOfPhase(phase: OnboardingPhase): string | null {
  if (phase === "skipped") return null;
  if (phase === "preferences") return "you";
  return phase.startsWith("host:") ? phase.slice("host:".length) : phase;
}

/** The step to show for a saved phase, or "skipped" for Skip's folder
 * prompt. A phase this order doesn't hold (a host step since removed, a step
 * the host left out, a host's phase read by standalone Rotli) starts again at
 * the first step, never a blank window. */
export function setupStepNow(phase: OnboardingPhase, order: readonly string[]): string {
  if (phase === "skipped") return "skipped";
  const step = stepOfPhase(phase);
  return step !== null && order.includes(step) ? step : (order[0] ?? "you");
}

/** The step after this one, or null when it is the last. */
export function stepAfter(step: string, order: readonly string[]): string | null {
  const at = order.indexOf(step);
  return at >= 0 && at < order.length - 1 ? order[at + 1]! : null;
}

/** The step before this one, or null for the first. */
export function stepBefore(step: string, order: readonly string[]): string | null {
  const at = order.indexOf(step);
  return at > 0 ? order[at - 1]! : null;
}

/** "2 of 4": where a step sits, counted from one. */
export function stepCount(step: string, order: readonly string[]): string {
  return `${order.indexOf(step) + 1} of ${order.length}`;
}
