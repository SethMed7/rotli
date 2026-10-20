import { isBidiControl, isC0OrC1Control } from "../lib/controlChars";

export interface ModelMapNote {
  id: string;
  title: string;
  folderId: string;
  updatedAt: number;
  pinned: boolean;
  kind?: "note" | "board" | "file";
}

export type ModelMapProfile = "compact" | "balanced" | "expansive";

export interface ModelMapPolicy {
  profile: ModelMapProfile;
  titlesPerArea: number;
  includeIds: boolean;
}

const MAX_MAP_FIELD_CHARS = 300;
const MAX_MAP_ID_CHARS = 128;

/** Model Mapping 0: retrieval shape derives from actual model capacity, not a
 * provider name. A replacement model automatically lands in the right tier. */
export function modelMapPolicy(contextWindow: number): ModelMapPolicy {
  if (contextWindow >= 180_000) return { profile: "expansive", titlesPerArea: 8, includeIds: true };
  if (contextWindow >= 24_000) return { profile: "balanced", titlesPerArea: 4, includeIds: true };
  return { profile: "compact", titlesPerArea: 2, includeIds: false };
}

function readable(notes: ModelMapNote[]): ModelMapNote[] {
  return notes.filter((note) => note.kind !== "board" && note.kind !== "file");
}

/** Explicit user signals win: pinned first, then recent work. This gives the
 * map useful adaptive priority without a hidden database or opaque training
 * state; the source remains clean memex metadata and filesystem timestamps. */
export function priorityOrder(a: ModelMapNote, b: ModelMapNote): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
  return a.title.localeCompare(b.title);
}

/** C0/C1 controls, line/paragraph separators, and bidi embeddings/overrides/
 * isolates: none of them may reach model-facing text. */
export function isModelUnsafeCodeUnit(code: number): boolean {
  return isC0OrC1Control(code) || code === 0x2028 || code === 0x2029 || isBidiControl(code);
}

/** Each model-unsafe UTF-16 code unit becomes U+FFFD; everything else is kept. */
export function scrubModelUnsafe(text: string): string {
  let out = "";
  let kept = 0;
  for (let i = 0; i < text.length; i++) {
    if (!isModelUnsafeCodeUnit(text.charCodeAt(i))) continue;
    out += `${text.slice(kept, i)}\ufffd`;
    kept = i + 1;
  }
  return kept === 0 ? text : out + text.slice(kept);
}

function dataField(value: string, cap = MAX_MAP_FIELD_CHARS): string {
  return scrubModelUnsafe(value.normalize("NFKC")).slice(0, cap);
}

function structuredJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
}

/** Legacy budget-only map kept for browser/test callers. */
export function buildIndex(notes: ModelMapNote[], maxChars = 3500): string {
  return buildMap(notes, { profile: "expansive", titlesPerArea: 3, includeIds: true }, maxChars);
}

/** A bounded, model-specific table of contents generated on demand. The map is
 * serialized as untrusted JSON data; no note-controlled value can create a
 * prompt heading, delimiter, role label, or literal markup close tag. */
export function buildModelMap(notes: ModelMapNote[], contextWindow: number, maxChars = 3500): string {
  return buildMap(notes, modelMapPolicy(contextWindow), maxChars);
}

function buildMap(notes: ModelMapNote[], policy: ModelMapPolicy, maxChars: number): string {
  const groups = new Map<string, ModelMapNote[]>();
  for (const note of readable(notes)) {
    const area = dataField(note.folderId || "Notes");
    const group = groups.get(area);
    if (group) group.push(note);
    else groups.set(area, [note]);
  }
  const entries = [...groups.entries()]
    .map(([area, areaNotes]) => [area, [...areaNotes].sort(priorityOrder)] as const)
    .sort((a, b) => priorityOrder(a[1][0]!, b[1][0]!) || a[0].localeCompare(b[0]));

  const encode = (areas: unknown[], truncated: boolean): string =>
    structuredJson({
      kind: "rotli.model-map",
      trust: "untrusted-data",
      profile: policy.profile,
      truncated,
      areas,
    });
  const noteData = (note: ModelMapNote) => ({
    title: dataField(note.title),
    pinned: note.pinned,
    ...(policy.includeIds ? { id: dataField(note.id, MAX_MAP_ID_CHARS) } : {}),
  });
  const allAreas = entries.map(([name, areaNotes]) => ({
    name,
    count: areaNotes.length,
    notes: areaNotes
      .slice(0, policy.profile === "expansive" ? areaNotes.length : policy.titlesPerArea)
      .map(noteData),
  }));
  const full = encode(allAreas, false);
  if (full.length <= maxChars) return full;

  const bounded: unknown[] = [];
  for (const [name, areaNotes] of entries) {
    let area: { name: string; count: number; notes: ReturnType<typeof noteData>[] } = {
      name,
      count: areaNotes.length,
      notes: areaNotes.slice(0, policy.titlesPerArea).map(noteData),
    };
    if (encode([...bounded, area], true).length > maxChars) {
      area = { name, count: areaNotes.length, notes: [] };
    }
    if (encode([...bounded, area], true).length > maxChars) break;
    bounded.push(area);
  }
  const result = encode(bounded, true);
  if (result.length <= maxChars) return result;
  return structuredJson({ kind: "rotli.model-map", trust: "untrusted-data", truncated: true, areas: [] });
}
