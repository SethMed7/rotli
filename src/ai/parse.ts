// Tolerant parsing of a small model's reply. Gemma & friends sometimes wrap JSON
// in ```json fences or add a stray word; we strip fences and pull the first
// balanced {…} object, then classify it as a tool call or a final answer.

import type { Parsed, ToolName } from "./types";

/** Pull the first balanced JSON object out of a model reply — tolerating a leading
 * ```json fence and prose around it. Returns null if there's no object. */
export function extractJsonObject(s: string): string | null {
  let t = s.trim();
  const fence = /^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/.exec(t);
  if (fence && fence[1] !== undefined) t = fence[1].trim();
  const start = t.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < t.length; i++) {
    const ch = t.charAt(i);
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') {
      inStr = true;
    } else if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return t.slice(start, i + 1);
    }
  }
  return null;
}

/** Classify a model step. `allowed` is the active tool set (web tools only when the
 * chat's globe is on), so an off-limits tool reads back as invalid. */
export function parseAction(raw: string, allowed: ReadonlySet<ToolName>): Parsed {
  const json = extractJsonObject(raw);
  if (json === null) return { kind: "unparseable", raw };
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { kind: "unparseable", raw };
  }
  if (data === null || typeof data !== "object") {
    return { kind: "invalid", reason: "not a JSON object" };
  }
  const obj = data as Record<string, unknown>;
  if (typeof obj.final === "string") {
    return { kind: "final", text: obj.final };
  }
  if (typeof obj.tool === "string") {
    const tool = obj.tool as ToolName;
    if (!allowed.has(tool)) return { kind: "invalid", reason: `unknown tool "${obj.tool}"` };
    const args =
      obj.args !== null && typeof obj.args === "object" ? (obj.args as Record<string, unknown>) : {};
    return { kind: "call", tool, args };
  }
  return { kind: "invalid", reason: 'reply had neither a known "tool" nor a "final"' };
}
