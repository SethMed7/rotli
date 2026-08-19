/**
 * Deterministic dictation cleanup — VENDORED from voz (~/voz/core/clean.ts, MIT, the maintainer's own).
 * Copied (not imported) so Breve stays self-contained and scoped to its own roots. Keep in sync
 * with voz if its rules change. Pure text transforms, no LLM, no network: drops fillers (um/uh),
 * resolves self-corrections ("2 actually 3" → "3"), honors "scratch that", collapses duplicates.
 * Breve uses it as the deterministic FLOOR for voice-note cleanup — applied to short notes, and as
 * the fallback when the Gemma polish is unavailable (so an Ollama outage still yields clean text).
 */
const FILLERS = new Set(["um", "umm", "uh", "uhh", "er", "erm", "ah", "hmm", "mhm"]);
const NUMBER_WORDS = new Set([
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
  "hundred",
  "thousand",
  "million",
]);
const MARKERS: string[][] = [
  ["no", "wait"],
  ["wait", "no"],
  ["i", "mean"],
  ["make", "that"],
  ["actually"],
  ["rather"],
];

const core = (token: string) => token.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, "");
type Shape = "numeral" | "numberWord" | "capitalized" | "plain";
function shapeOf(token: string): Shape {
  const c = core(token);
  if (/^\d+$/.test(c)) return "numeral";
  if (NUMBER_WORDS.has(c.toLowerCase())) return "numberWord";
  if (/^\p{Lu}/u.test(c)) return "capitalized";
  return "plain";
}
const endsSentence = (t: string) => /[.!?]$/.test(t);
const endsClause = (t: string) => /[.,!?;:]$/.test(t);

function applyScratchThat(tokens: string[]): string[] {
  const out = [...tokens];
  let i = 0;
  while (i + 1 < out.length) {
    if (core(out[i]).toLowerCase() === "scratch" && core(out[i + 1]).toLowerCase() === "that") {
      let start = 0;
      for (let j = i - 1; j >= 0; j--) {
        if (endsSentence(out[j])) {
          start = j + 1;
          break;
        }
      }
      out.splice(start, i + 2 - start);
      i = start;
    } else i++;
  }
  return out;
}
function applyCorrections(tokens: string[]): string[] {
  const out = [...tokens];
  let i = 1;
  while (i < out.length) {
    const marker = MARKERS.find((words) =>
      words.every((w, k) => i + k < out.length && core(out[i + k]).toLowerCase() === w),
    );
    if (marker) {
      const bIndex = i + marker.length;
      if (bIndex < out.length && shapeOf(out[i - 1]) === shapeOf(out[bIndex])) {
        out.splice(i - 1, marker.length + 1);
        i = Math.max(1, i - 1);
        continue;
      }
    }
    i++;
  }
  return out;
}
function removeFillers(tokens: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const c = core(tokens[i]).toLowerCase();
    if (FILLERS.has(c)) {
      i++;
      continue;
    }
    if (c === "you" && i + 1 < tokens.length && core(tokens[i + 1]).toLowerCase() === "know") {
      const prev = out[out.length - 1];
      const bare =
        endsClause(tokens[i + 1]) || i + 2 === tokens.length || (prev !== undefined && endsClause(prev));
      if (bare) {
        i += 2;
        continue;
      }
    }
    out.push(tokens[i]);
    i++;
  }
  return out;
}
function collapseDuplicates(tokens: string[]): string[] {
  const out: string[] = [];
  for (const token of tokens) {
    const prev = out[out.length - 1];
    if (
      prev !== undefined &&
      !endsSentence(prev) &&
      core(prev) !== "" &&
      core(prev).toLowerCase() === core(token).toLowerCase()
    ) {
      if (endsClause(token)) out[out.length - 1] = token;
    } else out.push(token);
  }
  return out;
}

/** Clean a raw dictation transcript deterministically. Returns the tidied text. */
export function cleaned(raw: string): string {
  const trimmed = raw.trim();
  const first = trimmed.charAt(0);
  const startedUpper = first !== "" && first !== first.toLowerCase();
  let tokens = trimmed.split(/\s+/).filter((t) => t.length > 0);
  tokens = applyScratchThat(tokens);
  tokens = removeFillers(tokens);
  tokens = applyCorrections(tokens);
  tokens = collapseDuplicates(tokens);
  let out = tokens
    .join(" ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim();
  if (startedUpper && out !== "") out = out.charAt(0).toUpperCase() + out.slice(1);
  return out;
}
