// Talk to the Librarian (`/librarian`, 2026-09-28; plan: docs/design/librarian-bar.md).
// The pure half: the reply grammar and the metadata it writes —
// tags merged into `tags`, and text-quote pointers to passages in `anchors`.
// Nothing here calls a model or touches a file.

/** A pointer to a passage: its words, a little text on each side, and an
 * optional short name. It finds the passage again without changing the note. */
export interface Anchor {
  exact: string;
  prefix: string;
  suffix: string;
  label?: string;
}

export const ANCHOR_LIMITS = { exact: 280, context: 32, label: 80, perNote: 20 } as const;
const TAG_MAX = 40;
export const EXCERPT_MAX = 4000;
/** The one area filing may create when it's missing (the owner, Round Three). */
export const PEOPLE_AREA = "People";

export type LibrarianAction =
  | { type: "tag"; tags: string[] }
  | { type: "mark"; anchor: Anchor }
  | { type: "file"; area: string; create: boolean };

// ── anchors ──────────────────────────────────────────────────────────────────

/** The pointer for a selection in `doc`, or null for an empty one. */
export function anchorFromSelection(doc: string, from: number, to: number, label?: string): Anchor | null {
  const [a, b] = [Math.min(from, to), Math.max(from, to)];
  const exact = doc.slice(a, b).slice(0, ANCHOR_LIMITS.exact);
  if (!exact.trim()) return null;
  const anchor: Anchor = {
    exact,
    prefix: doc.slice(Math.max(0, a - ANCHOR_LIMITS.context), a),
    suffix: doc.slice(a + exact.length, a + exact.length + ANCHOR_LIMITS.context),
  };
  const name = label?.trim().slice(0, ANCHOR_LIMITS.label);
  if (name) anchor.label = name;
  return anchor;
}

/** The `anchors` field read tolerantly: malformed entries are dropped. */
export function parseAnchors(value: string): Anchor[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value || "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item): Anchor[] => {
    if (!item || typeof item !== "object") return [];
    const { exact, prefix, suffix, label } = item as Record<string, unknown>;
    if (typeof exact !== "string" || !exact) return [];
    const anchor: Anchor = {
      exact: exact.slice(0, ANCHOR_LIMITS.exact),
      prefix: typeof prefix === "string" ? prefix.slice(-ANCHOR_LIMITS.context) : "",
      suffix: typeof suffix === "string" ? suffix.slice(0, ANCHOR_LIMITS.context) : "",
    };
    if (typeof label === "string" && label.trim()) anchor.label = label.trim().slice(0, ANCHOR_LIMITS.label);
    return [anchor];
  });
}

/** `anchors` with one more pointer: the same passage replaces its old entry,
 * and past the per-note limit the oldest goes first. One line of JSON. */
export function addAnchor(value: string, anchor: Anchor): string {
  const same = (a: Anchor) => a.exact === anchor.exact && a.prefix === anchor.prefix;
  const list = [...parseAnchors(value).filter((a) => !same(a)), anchor];
  return JSON.stringify(list.slice(-ANCHOR_LIMITS.perNote));
}

function occurrences(doc: string, text: string): number[] {
  const found: number[] = [];
  for (let at = doc.indexOf(text); at >= 0; at = doc.indexOf(text, at + 1)) found.push(at);
  return found;
}

/** Where a pointer's passage is now: found (the one match, with its words
 * and their surroundings first), moved (its words now appear more than once,
 * so jumping would be a guess), or gone. */
export function resolveAnchor(
  doc: string,
  anchor: Anchor,
): { kind: "found"; from: number; to: number } | { kind: "moved" } | { kind: "gone" } {
  const whole = occurrences(doc, anchor.prefix + anchor.exact + anchor.suffix);
  if (whole.length === 1) {
    const from = whole[0]! + anchor.prefix.length;
    return { kind: "found", from, to: from + anchor.exact.length };
  }
  const bare = occurrences(doc, anchor.exact);
  if (bare.length === 1) return { kind: "found", from: bare[0]!, to: bare[0]! + anchor.exact.length };
  return bare.length === 0 ? { kind: "gone" } : { kind: "moved" };
}

// ── tags ─────────────────────────────────────────────────────────────────────

function cleanTag(tag: string): string {
  return tag.replace(/[,[\]]/g, "").trim();
}

/** A model's tag list, cleaned: strings only, no commas or brackets, no
 * duplicates, none too long. */
export function cleanTags(list: unknown): string[] {
  const seen = new Set<string>();
  return (Array.isArray(list) ? list : []).flatMap((tag): string[] => {
    if (typeof tag !== "string") return [];
    const clean = cleanTag(tag);
    if (!clean || clean.length > TAG_MAX || seen.has(clean.toLowerCase())) return [];
    seen.add(clean.toLowerCase());
    return [clean];
  });
}

/** The tags in a `tags` field value (`[a, b]`, or a bare list). */
export function parseTags(value: string): string[] {
  const inner = value.trim().replace(/^\[/, "").replace(/\]$/, "");
  return inner
    .split(",")
    .map((tag) =>
      tag
        .trim()
        .replace(/^["']|["']$/g, "")
        .trim(),
    )
    .filter(Boolean);
}

/** `tags` with new ones added; existing tags keep their place and spelling. */
export function mergeTags(value: string, add: readonly string[]): string {
  const tags = parseTags(value);
  const seen = new Set(tags.map((tag) => tag.toLowerCase()));
  for (const tag of add) {
    if (seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    tags.push(tag);
  }
  return `[${tags.join(", ")}]`;
}

// ── the reply ────────────────────────────────────────────────────────────────

/** The first JSON object in `text` that has an `actions` array (the reply may
 * be wrapped in prose or a code fence), and where it sits, so a conversation
 * can show the prose around it. */
export function actionsBlock(
  text: string,
): { actions: unknown[]; handoff?: unknown; start: number; end: number } | null {
  for (let start = text.indexOf("{"); start >= 0; start = text.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (ch === "\\") i++;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        try {
          const parsed = JSON.parse(text.slice(start, i + 1)) as { actions?: unknown; handoff?: unknown };
          if (Array.isArray(parsed.actions))
            return { actions: parsed.actions, handoff: parsed.handoff, start, end: i + 1 };
        } catch {
          // not JSON — try the next opening brace
        }
        break;
      }
    }
  }
  return null;
}

/** A model reply as actions, per the grammar in docs/design/librarian-bar.md:
 * anything outside it is dropped, never guessed at. */
export function parseLibrarianReply(
  reply: string,
  context: {
    doc: string;
    highlight: Anchor | null;
    areas: readonly string[];
    /** Where a note about a person may go (the Librarian rules' People
     * groups); created when missing. Default: the one People area. */
    people?: readonly string[];
  },
): LibrarianAction[] {
  const people = context.people ?? [PEOPLE_AREA];
  const raw = actionsBlock(reply)?.actions ?? [];
  const actions: LibrarianAction[] = [];
  let filed = false;
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const action = item as Record<string, unknown>;
    if (action.type === "tag") {
      const tags = cleanTags(action.tags);
      if (tags.length > 0) actions.push({ type: "tag", tags });
    } else if (action.type === "mark" && typeof action.exact === "string" && action.exact.trim()) {
      const label = typeof action.label === "string" ? action.label : undefined;
      // the user's own highlight wins; otherwise the words must be in the note
      let anchor: Anchor | null = null;
      if (context.highlight) {
        anchor = { ...context.highlight };
        const name = label?.trim().slice(0, ANCHOR_LIMITS.label);
        if (name) anchor.label = name;
      } else {
        const at = context.doc.indexOf(action.exact);
        if (at >= 0) anchor = anchorFromSelection(context.doc, at, at + action.exact.length, label);
      }
      if (anchor) actions.push({ type: "mark", anchor });
    } else if (action.type === "file" && typeof action.area === "string" && !filed) {
      const wanted = action.area.trim().replace(/^wiki\//, "");
      const area = context.areas.find((name) => name.toLowerCase() === wanted.toLowerCase());
      const person = people.find((name) => name.toLowerCase() === wanted.toLowerCase());
      if (area) {
        actions.push({ type: "file", area, create: false });
        filed = true;
      } else if (person) {
        actions.push({ type: "file", area: person, create: true });
        filed = true;
      }
    }
  }
  return actions;
}

/** One line per proposed action, for the bar's list. */
export function describeLibrarianAction(action: LibrarianAction): string {
  if (action.type === "tag") return `Tag the note: ${action.tags.join(", ")}`;
  if (action.type === "mark") {
    const words =
      action.anchor.exact.length > 60 ? `${action.anchor.exact.slice(0, 57)}…` : action.anchor.exact;
    return action.anchor.label ? `Mark “${words}” as ${action.anchor.label}` : `Mark “${words}”`;
  }
  return action.create ? `File it in ${action.area} (a new area)` : `File it in ${action.area}`;
}
