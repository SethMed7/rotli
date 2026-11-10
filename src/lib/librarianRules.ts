// Librarian rules (2026-09-28): how the person wants the Library kept, in plain
// settings rather than code. One `librarianRules` object in the vault's
// `.rotli/settings.json`; the Rust twin (src-tauri/src/librarian_rules.rs)
// reads the same shape the same way, and scripts/fixtures/parity.json pins the
// shared constants and the name matcher's cases on both sides.
//
// - `secureKeywords`: words that make a note secure when they appear in its
//   title or file name — the name only, never the body, never a model — and
//   the note goes to the one protected folder like any other secure note.
// - `people`: `groups` splits People into sub-folders (People/Friends…,
//   created when the first note lands); `simple` keeps one People folder.
// - `filing`: plain sentences the Librarian follows when it files.

import { PEOPLE_AREA } from "./librarianActions";

export type PeopleMode = "groups" | "simple";

export interface LibrarianRules {
  secureKeywords: string[];
  /** The groups stay listed in the simple mode, so switching back keeps them. */
  people: { mode: PeopleMode; groups: string[] };
  filing: string[];
}

export const DEFAULT_PEOPLE_GROUPS = ["Family", "Friends", "Work", "Acquaintances"] as const;

export const RULE_LIMITS = { keywords: 50, groups: 20, filing: 20, word: 40, sentence: 200 } as const;

export const DEFAULT_LIBRARIAN_RULES: LibrarianRules = {
  secureKeywords: [],
  people: { mode: "groups", groups: [...DEFAULT_PEOPLE_GROUPS] },
  filing: [],
};

/** A People group becomes a folder, so it is one plain name: no path
 * separators, no leading `_` or `.` (Rotli's own lanes), no `..`. */
export function validGroup(name: string): boolean {
  const n = name.trim();
  return (
    n.length > 0 &&
    [...n].length <= RULE_LIMITS.word &&
    !/[/\\:]/.test(n) &&
    !n.includes("..") &&
    !/^[_.]/.test(n)
  );
}

function strings(value: unknown, maxItems: number, maxLength: number): string[] {
  const out: string[] = [];
  for (const item of Array.isArray(value) ? value : []) {
    if (typeof item !== "string") continue;
    const text = item.trim();
    if (!text || [...text].length > maxLength) continue;
    if (out.some((seen) => seen.toLowerCase() === text.toLowerCase())) continue;
    out.push(text);
    if (out.length === maxItems) break;
  }
  return out;
}

/** The rules read tolerantly: anything missing or malformed is the default. */
export function parseLibrarianRules(value: unknown): LibrarianRules {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return structuredClone(DEFAULT_LIBRARIAN_RULES);
  const rules = value as Record<string, unknown>;
  const people = (rules.people && typeof rules.people === "object" ? rules.people : {}) as Record<
    string,
    unknown
  >;
  return {
    secureKeywords: strings(rules.secureKeywords, RULE_LIMITS.keywords, RULE_LIMITS.word),
    people: {
      mode: people.mode === "simple" ? "simple" : "groups",
      groups:
        people.groups === undefined
          ? [...DEFAULT_PEOPLE_GROUPS]
          : strings(people.groups, RULE_LIMITS.groups, RULE_LIMITS.word).filter(validGroup),
    },
    filing: strings(rules.filing, RULE_LIMITS.filing, RULE_LIMITS.sentence),
  };
}

/** The People areas a note about a person may be filed into. */
export function peopleAreas(rules: LibrarianRules): string[] {
  const groups = rules.people.mode === "simple" ? [] : rules.people.groups;
  return groups.length > 0 ? groups.map((group) => `${PEOPLE_AREA}/${group}`) : [PEOPLE_AREA];
}

/** The ways a name is cut into lowercased words; a note is secure when ANY of
 * them finds the keyword, since a deny list may only ever grow
 * (librarian_rules.rs `Words` defines each the same way): plain letters and
 * digits; the same with combining marks as breaks (`banḱ` holds "bank"); and
 * NFKC-folded with marks kept (a decomposed `é`, a fullwidth `ｂａｎｋ`). */
const EVERY_WAY: readonly ((text: string) => string[])[] = [
  (text) => cut(text, /[^\p{Alphabetic}\p{N}]+/u),
  (text) => cut(text, /(?:[^\p{Alphabetic}\p{N}]|\p{M})+/u),
  (text) =>
    cut(text.normalize("NFKC"), /[^\p{Alphabetic}\p{N}\p{M}]+/u).map((word) => word.normalize("NFKC")),
];

function cut(text: string, breaks: RegExp): string[] {
  return text
    .split(breaks)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

/** The short id suffix an older Rotli added to a colliding file name
 * (`bank-login-3f9k2a.md`): a dash and the ULID's last six characters,
 * lowercased. Only that exact ASCII shape, with a digit, is dropped. */
const ID_SUFFIX = /^([\s\S]+)-(?=[0-9a-z]*[0-9])[0-9a-hjkmnp-tv-z]{6}$/;

/** A note file name's words, without its folder, `.md`, and an id suffix. */
function fileWords(rel: string, words: (text: string) => string[]): string[] {
  const name = rel.split("/").pop() ?? rel;
  const stem = name.replace(/\.md$/, "");
  const head = words(ID_SUFFIX.exec(stem)?.[1] ?? stem);
  return head.length > 0 ? head : words(stem);
}

/** Does a keyword appear in the title or the file name, as whole words, in
 * any case? "bank" matches "Bank login", never "Riverbank". */
export function secureByName(title: string, rel: string, keywords: readonly string[]): boolean {
  return EVERY_WAY.some((words) => {
    const names = [words(title), fileWords(rel, words)];
    return keywords.some((keyword) => {
      const k = words(keyword);
      return (
        k.length > 0 &&
        names.some((name) => name.some((_, at) => k.every((word, offset) => name[at + offset] === word)))
      );
    });
  });
}
