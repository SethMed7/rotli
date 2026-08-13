// Tolerant parsing of a small model's reply. Gemma & friends sometimes wrap JSON
// in ```json fences or add a stray word; we strip fences and pull the first
// balanced {…} object, then classify it as a tool call or a final answer.

import type { Parsed, ToolName } from "./types";

const THOUGHT_MAX_CHARS = 800;
const QUESTION_MAX_CHARS = 240;
const QUESTION_OPTION_MAX_CHARS = 80;

/** Keep reasoning as a concise private checkpoint, not an unbounded transcript.
 * The field remains optional so older/frontier models that omit it still work. */
function parsedThought(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const thought = value.trim().slice(0, THOUGHT_MAX_CHARS);
  return thought || undefined;
}

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
  const thought = parsedThought(obj.thought);
  if (typeof obj.final === "string") {
    return { kind: "final", text: obj.final, ...(thought ? { thought } : {}) };
  }
  if (typeof obj.question === "string") {
    const prompt = obj.question.trim();
    const rawOptions = obj.options;
    if (!prompt || prompt.length > QUESTION_MAX_CHARS) {
      return { kind: "invalid", reason: "question must be concise and non-empty" };
    }
    if (!Array.isArray(rawOptions) || rawOptions.length < 2 || rawOptions.length > 3) {
      return { kind: "invalid", reason: "question needs 2 or 3 options" };
    }
    const options = rawOptions.map((option) => (typeof option === "string" ? option.trim() : ""));
    if (
      options.some((option) => !option || option.length > QUESTION_OPTION_MAX_CHARS) ||
      new Set(options).size !== options.length
    ) {
      return { kind: "invalid", reason: "question options must be concise, distinct text" };
    }
    return { kind: "question", prompt, options, ...(thought ? { thought } : {}) };
  }
  if (typeof obj.tool === "string") {
    const tool = obj.tool as ToolName;
    if (!allowed.has(tool)) return { kind: "invalid", reason: `unknown tool "${obj.tool}"` };
    const args =
      obj.args !== null && typeof obj.args === "object" ? (obj.args as Record<string, unknown>) : {};
    return { kind: "call", tool, args, ...(thought ? { thought } : {}) };
  }
  return {
    kind: "invalid",
    reason: 'reply had neither a known "tool", a "question", nor a "final"',
  };
}
