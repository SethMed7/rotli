/** Coarse provenance routing for the local-model loop. This does not dispatch
 * anything: it only recognizes questions that are clearly personal or clearly
 * about public/external facts so Rotli can correct a weak model's wrong first
 * tool choice. Ambiguous names remain the model's decision. */
export type LocalSourceRoute = "personal" | "external" | "ambiguous";

const PERSONAL_ANCHORS = [
  /\b(?:my|mine|our|ours)\b/i,
  /\b(?:notes?|vault|memex|workspace|attached note)\b/i,
  /\bwhat (?:did|do|have) (?:i|we)\b/i,
  /\b(?:i|we) (?:decided|prefer|planned|said|wrote|work)\b/i,
];

const EXTERNAL_FACT_CUES = [
  /\b(?:specifications?|usable capacity|nominal capacity|mass|weight)\b/i,
  /\b(?:standardized (?:test|runtime)|runtimes?|benchmarks?)\b/i,
  /\b(?:clinical trial|phase[- ]?(?:one|two|three|[1-3])|primary (?:endpoint|outcome))\b/i,
  /\b(?:regulatory|regulator|approved|approval|investigational)\b/i,
  /\b(?:transactions?|acquisitions?|purchas(?:e|ed|er)|buyers?|consideration|deals?)\b/i,
  /\b(?:launch(?:ed|ing)?|missions?|into space)\b/i,
  /\b(?:signers?|signatories|public letter|published report|newly announced|just-announced)\b/i,
  /\b(?:prices?|schedules?|standings|currently holds)\b/i,
];

export function localSourceRoute(userText: string, attachedNote = false): LocalSourceRoute {
  if (attachedNote || PERSONAL_ANCHORS.some((pattern) => pattern.test(userText))) return "personal";
  if (EXTERNAL_FACT_CUES.some((pattern) => pattern.test(userText))) return "external";
  return "ambiguous";
}
