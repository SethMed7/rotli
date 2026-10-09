// A chart a slash command just inserted opens its Edit form once its block
// renders (SYNTAX.md). Kept apart from chartBlock.ts so the slash actions,
// which every editor test loads, never pull CodeMirror's view in with it.

import { parseChart, serializeChart } from "./chartSpec";

/** Bodies awaiting their form, by canonical text (a list indent can't hide
 * one), each until it expires: a starter that never renders — inserted where
 * no fence widget draws — must not open a form on some later, identical chart. */
const PENDING_EDITS = new Map<string, number>();
const PENDING_FOR_MS = 5_000;

function canonical(code: string): string | null {
  const parsed = parseChart(code);
  return parsed.ok ? serializeChart(parsed.spec) : null;
}

/** Ask the block holding this body to open its form when it first renders. */
export function requestChartEdit(code: string, now = Date.now()): void {
  const key = canonical(code);
  if (key) PENDING_EDITS.set(key, now + PENDING_FOR_MS);
}

/** Whether this block was asked to open its form (one-shot). */
export function takeChartEdit(code: string, now = Date.now()): boolean {
  const key = canonical(code);
  if (key === null) return false;
  const until = PENDING_EDITS.get(key);
  PENDING_EDITS.delete(key);
  return until !== undefined && now <= until;
}
