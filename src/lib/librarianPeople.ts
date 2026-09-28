// The Librarian keeps the vault, not just the open note (the owner,
// 2026-09-28: "/librarian Whenever I mention Kunal or Dhaval those are work
// people…"). When the person *tells* it something, a reply can carry vault
// actions besides the note's tag / mark / file:
//
// - `rule`: a filing sentence added to the Librarian rules;
// - `group`: a new People group;
// - `person`: a note for someone who has none yet, filled in with what was
//   said and filed into their People group;
// - `update`: a change to someone who already has a note (their group, their
//   tags). This one is a question: nothing happens until the person says yes.
//
// The first three are additions and happen right away; an existing note is
// never changed without asking, and its words are never edited. The pure half:
// which People notes exist, and a reply's vault actions, checked against the
// rules and those notes. Nothing here calls a model or touches a file.

import type { NoteSummary } from "../types";
import { cleanTags, PEOPLE_AREA } from "./librarianActions";
import { type LibrarianRules, RULE_LIMITS, validGroup } from "./librarianRules";

/** A note about a person the vault already has, and where it's filed
 * (`People/Work`, spelled as on disk). */
export interface PersonNote {
  id: string;
  title: string;
  area: string;
}

export type VaultAction =
  | { type: "rule"; text: string }
  | { type: "group"; name: string }
  | { type: "person"; name: string; area: string | null; about: string; tags: string[] }
  | { type: "update"; noteId: string; name: string; from: string; area: string | null; tags: string[] };

/** One line of what the Librarian did, for the chat. */
export interface KeptLine {
  text: string;
  /** The person's note, to open from the line. */
  noteId?: string;
  failed?: boolean;
}

export const PERSON_LIMITS = { name: 80, about: 280, perReply: 20, listed: 200 } as const;

/** The People notes in a note list: files under wiki/People (any case), not
 * secure, newest first, at most PERSON_LIMITS.listed of them. */
export function peopleNotes(notes: Iterable<NoteSummary>): PersonNote[] {
  const found: (PersonNote & { at: number })[] = [];
  const seen = new Set<string>();
  for (const note of notes) {
    const folder = note.diskFolderId ?? note.folderId;
    const inPeople = /^wiki\/people(\/|$)/i.test(folder);
    if (!inPeople || note.secure || (note.kind ?? "note") !== "note" || seen.has(note.id)) continue;
    seen.add(note.id);
    found.push({ id: note.id, title: note.title, area: folder.slice("wiki/".length), at: note.updatedAt });
  }
  return found
    .sort((a, b) => b.at - a.at)
    .slice(0, PERSON_LIMITS.listed)
    .map(({ id, title, area }) => ({ id, title, area }));
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** One plain name: no path, no line break, not too long. */
function personName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/\s+/g, " ").trim();
  return name && [...name].length <= PERSON_LIMITS.name && !/[/\\]/.test(name) ? name : null;
}

/** A reply's vault actions, per the grammar in docs/design/librarian-bar.md:
 * anything outside it is dropped, never guessed at. Groups come first so a
 * person can be filed into a group added in the same reply; someone who
 * already has a note (same title, any case) becomes an `update`. */
export function parseVaultActions(
  raw: readonly unknown[],
  context: { rules: LibrarianRules; known: readonly PersonNote[] },
): VaultAction[] {
  const items = raw.filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
  const { rules } = context;
  const grouped = rules.people.mode === "groups";
  const groups = [...rules.people.groups];
  const actions: VaultAction[] = [];

  for (const item of items) {
    if (item.type !== "group" || !grouped || typeof item.name !== "string") continue;
    const name = item.name.trim();
    if (!validGroup(name) || groups.some((g) => same(g, name)) || groups.length >= RULE_LIMITS.groups)
      continue;
    groups.push(name);
    actions.push({ type: "group", name });
  }

  const filing = [...rules.filing];
  for (const item of items) {
    if (item.type !== "rule" || typeof item.text !== "string") continue;
    const text = item.text.replace(/\s+/g, " ").trim();
    if (!text || [...text].length > RULE_LIMITS.sentence || filing.length >= RULE_LIMITS.filing) continue;
    if (filing.some((rule) => same(rule, text))) continue;
    filing.push(text);
    actions.push({ type: "rule", text });
  }

  // where a person goes: their group in the groups mode, else the one People area
  const areaFor = (group: unknown): string | null => {
    if (!grouped) return PEOPLE_AREA;
    const match = typeof group === "string" ? groups.find((g) => same(g, group)) : undefined;
    return match ? `${PEOPLE_AREA}/${match}` : null;
  };
  const named = new Set<string>();
  for (const item of items) {
    if (item.type !== "person") continue;
    const name = personName(item.name);
    if (!name || named.has(name.toLowerCase()) || named.size >= PERSON_LIMITS.perReply) continue;
    named.add(name.toLowerCase());
    const area = areaFor(item.group);
    const tags = cleanTags(item.tags);
    const known = context.known.find((note) => same(note.title, name));
    if (known) {
      const move = area && !same(area, known.area) ? area : null;
      if (move || tags.length > 0)
        actions.push({
          type: "update",
          noteId: known.id,
          name: known.title,
          from: known.area,
          area: move,
          tags,
        });
      continue;
    }
    const about = typeof item.about === "string" ? item.about.trim().slice(0, PERSON_LIMITS.about) : "";
    actions.push({ type: "person", name, area, about, tags });
  }
  return actions;
}

/** The body of a new person's note: their name, and what was said about them. */
export function personBody(action: Extract<VaultAction, { type: "person" }>): string {
  return action.about ? `# ${action.name}\n\n${action.about}\n` : `# ${action.name}\n`;
}

/** The question an `update` asks, in words. */
export function describeUpdate(action: Extract<VaultAction, { type: "update" }>): string {
  const changes = [
    ...(action.area ? [`move it from ${action.from} to ${action.area}`] : []),
    ...(action.tags.length > 0 ? [`tag it ${action.tags.join(", ")}`] : []),
  ];
  return `${action.name} already has a note in ${action.from}. ${changes.join(" and ").replace(/^./, (c) => c.toUpperCase())}?`;
}
