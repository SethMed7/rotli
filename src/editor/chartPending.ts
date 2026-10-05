// A chart a slash command just inserted opens its Edit form once its block
// renders (SYNTAX.md). Kept apart from chartBlock.ts so the slash actions,
// which every editor test loads, never pull CodeMirror's view in with it.

import { parseChart, serializeChart } from "./chartSpec";

/** Bodies awaiting their form, by canonical text (a list indent can't hide one). */
const PENDING_EDITS = new Set<string>();

function canonical(code: string): string | null {
  const parsed = parseChart(code);
  return parsed.ok ? serializeChart(parsed.spec) : null;
}

/** Ask the block holding this body to open its form when it first renders. */
export function requestChartEdit(code: string): void {
  const key = canonical(code);
  if (key) PENDING_EDITS.add(key);
}

/** Whether this block was asked to open its form (one-shot). */
export function takeChartEdit(code: string): boolean {
  const key = canonical(code);
  return key !== null && PENDING_EDITS.delete(key);
}
