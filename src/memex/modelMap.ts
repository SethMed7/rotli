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

/** Legacy budget-only map kept for browser/test callers. */
export function buildIndex(notes: ModelMapNote[], maxChars = 3500): string {
  return buildMap(notes, { profile: "expansive", titlesPerArea: 3, includeIds: false }, maxChars);
}

/** A bounded, model-specific table of contents generated on demand. Nothing is
 * duplicated on disk: every run projects the current memex and its priorities. */
export function buildModelMap(
  notes: ModelMapNote[],
  contextWindow: number,
  maxChars = 3500,
): string {
  return buildMap(notes, modelMapPolicy(contextWindow), maxChars);
}

function buildMap(notes: ModelMapNote[], policy: ModelMapPolicy, maxChars: number): string {
  const groups = new Map<string, ModelMapNote[]>();
  for (const note of readable(notes)) {
    const area = note.folderId || "Notes";
    const group = groups.get(area);
    if (group) group.push(note);
    else groups.set(area, [note]);
  }
  const entries = [...groups.entries()]
    .map(([area, areaNotes]) => [area, [...areaNotes].sort(priorityOrder)] as const)
    .sort((a, b) => priorityOrder(a[1][0]!, b[1][0]!) || a[0].localeCompare(b[0]));

  if (policy.profile === "expansive") {
    const full = entries
      .map(([area, areaNotes]) =>
        `## ${area}\n${areaNotes.map((note) => `- ${note.pinned ? "★ " : ""}${note.title}  {id: ${note.id}}`).join("\n")}`,
      )
      .join("\n\n");
    if (full.length <= maxChars) return full;
  }

  let out = `Model Map 0 · ${policy.profile}\n`;
  for (const [area, areaNotes] of entries) {
    const selected = areaNotes.slice(0, policy.titlesPerArea);
    const lines = selected.map((note) => {
      const id = policy.includeIds ? `  {id: ${note.id}}` : "";
      return `- ${note.pinned ? "★ " : ""}${note.title}${id}`;
    });
    const section = `\n## ${area} (${areaNotes.length})\n${lines.join("\n")}\n`;
    if (out.length + section.length > maxChars) {
      out += "\n…more areas available through search_notes\n";
      break;
    }
    out += section;
  }
  return out.trim();
}
