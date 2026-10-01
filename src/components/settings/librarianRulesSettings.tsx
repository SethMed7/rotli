// Settings → Librarian → Your rules (2026-09-28, the owner's Round Three list):
// tell the Librarian how you want things kept, in plain settings — secure
// keywords, how People is split, and filing sentences. The rules live in the
// vault's `.rotli/settings.json` (src/lib/librarianRules.ts); the Rust
// organizer and corpus read the same file, so they apply to background
// organizing, to /librarian, and to the secure-note protections alike.

import { useState } from "react";

import {
  DEFAULT_PEOPLE_GROUPS,
  type LibrarianRules,
  type PeopleMode,
  RULE_LIMITS,
  validGroup,
} from "../../lib/librarianRules";
import { secureByKeywords } from "../../lib/vaultRepair";
import { invalidateNotes } from "../../services/hooks";
import { useLibrarianRules } from "../../state/librarianRules";
import { AddField, AddRow, EntryProblem, RemovableRows } from "./removableList";
import { Seg } from "./seg";

type Check = (value: string, current: readonly string[]) => string | null;

export const ENTRY_PROBLEMS = {
  empty: "Type something first.",
  duplicate: "That’s already on the list.",
} as const;

/** Why a new entry can't be added, or null when it can. */
export function entryProblem(
  value: string,
  current: readonly string[],
  limit: number,
  check?: Check,
): string | null {
  const text = value.trim();
  if (!text) return ENTRY_PROBLEMS.empty;
  if (current.some((item) => item.toLowerCase() === text.toLowerCase())) return ENTRY_PROBLEMS.duplicate;
  if (current.length >= limit) return `That’s the most this list holds (${limit}).`;
  return check?.(text, current) ?? null;
}

const groupCheck: Check = (text) =>
  validGroup(text)
    ? null
    : `A group is one plain name, up to ${RULE_LIMITS.word} characters, with no “/” and not starting with “_” or “.”.`;

const wordCheck: Check = (text) =>
  [...text].length > RULE_LIMITS.word ? `Keep a keyword under ${RULE_LIMITS.word} characters.` : null;

const sentenceCheck: Check = (text) =>
  [...text].length > RULE_LIMITS.sentence ? `Keep a rule under ${RULE_LIMITS.sentence} characters.` : null;

/** A short editable list: chips for words, rows for sentences. */
function ListEditor({
  label,
  items,
  limit,
  placeholder,
  check,
  rows = false,
  onChange,
}: {
  label: string;
  items: readonly string[];
  limit: number;
  placeholder: string;
  check?: Check;
  rows?: boolean;
  onChange: (items: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const add = () => {
    const why = entryProblem(draft, items, limit, check);
    setProblem(why);
    if (why) return;
    onChange([...items, draft.trim()]);
    setDraft("");
  };
  return (
    <div className="rules-list">
      <RemovableRows
        label={label}
        rows={items.map((item) => ({ key: item, text: item }))}
        chips={!rows}
        onRemove={(key) => onChange(items.filter((other) => other !== key))}
      />
      <AddRow disabled={!draft.trim()} onAdd={add}>
        <AddField
          aria-label={`Add to ${label}`}
          placeholder={placeholder}
          value={draft}
          onChange={(event) => {
            setDraft(event.currentTarget.value);
            setProblem(null);
          }}
        />
      </AddRow>
      <EntryProblem problem={problem} />
    </div>
  );
}

const plural = (n: number) => `${n} ${n === 1 ? "note" : "notes"}`;

export function LibrarianRulesSettings({ native }: { native: boolean }) {
  const rules = useLibrarianRules((s) => s.rules);
  const setRules = useLibrarianRules((s) => s.setRules);
  return <RulesEditor native={native} rules={rules} setRules={setRules} />;
}

/** The editor itself, for one set of rules (tests render it directly). */
export function RulesEditor({
  native,
  rules,
  setRules,
}: {
  native: boolean;
  rules: LibrarianRules;
  setRules: (rules: LibrarianRules) => void;
}) {
  const [secured, setSecured] = useState<{ text: string; err: boolean; busy?: boolean } | null>(null);
  const update = (change: Partial<LibrarianRules>) => setRules({ ...rules, ...change });
  const setPeople = (people: Partial<LibrarianRules["people"]>) =>
    update({ people: { ...rules.people, ...people } });

  const protectNow = () => {
    setSecured({ text: "Checking note names…", err: false, busy: true });
    secureByKeywords()
      .then(async (count) => {
        if (count > 0) await invalidateNotes();
        setSecured({
          text: count === 0 ? "No other notes are named with these words." : `Protected ${plural(count)}.`,
          err: false,
        });
      })
      .catch((e) => setSecured({ text: e instanceof Error ? e.message : String(e), err: true }));
  };

  return (
    <section className="rules" aria-label="Your rules">
      <h4 className="sethead">Your rules</h4>
      <p className="setnote">
        Tell the Librarian how you want things kept. It follows these when it organizes on its own and when
        you ask it with <code>/librarian</code>.
      </p>

      <span className="mplabel">Secure keywords</span>
      <ListEditor
        label="Secure keywords"
        items={rules.secureKeywords}
        limit={RULE_LIMITS.keywords}
        placeholder="Add a word, like bank or passport"
        check={wordCheck}
        onChange={(secureKeywords) => {
          update({ secureKeywords });
          setSecured(null);
        }}
      />
      <p className="setnote">
        A note whose <b>title or file name</b> has one of these words becomes secure when it’s saved, and
        moves into your protected Secure folder. Only the name is checked, never what the note says, and the
        check never uses a model. “Bank” matches “Bank login”, not “Riverbank”.
      </p>
      {rules.secureKeywords.length > 0 &&
        (native ? (
          <>
            <button type="button" className="ghostbtn" disabled={secured?.busy} onClick={protectNow}>
              Secure matching notes now
            </button>
            {secured && (
              <p className={secured.err ? "setnote err" : "setnote"} role="status">
                {secured.text}
              </p>
            )}
          </>
        ) : (
          <p className="setnote">Protecting notes already named this way works in the Mac app.</p>
        ))}

      <span className="mplabel">People</span>
      <Seg<PeopleMode>
        value={rules.people.mode}
        options={[
          ["groups", "Groups"],
          ["simple", "One list"],
        ]}
        onPick={(mode) => setPeople({ mode })}
      />
      {rules.people.mode === "groups" ? (
        <>
          <ListEditor
            label="People groups"
            items={rules.people.groups}
            limit={RULE_LIMITS.groups}
            placeholder="Add a group, like Neighbors"
            check={groupCheck}
            onChange={(groups) => setPeople({ groups })}
          />
          <p className="setnote">
            A note about a person is filed into one of these, in People. A group’s folder is made when its
            first note is filed.{" "}
            {rules.people.groups.join("|") !== DEFAULT_PEOPLE_GROUPS.join("|") && (
              <button
                type="button"
                className="rules-reset"
                onClick={() => setPeople({ groups: [...DEFAULT_PEOPLE_GROUPS] })}
              >
                Back to Family, Friends, Work, Acquaintances
              </button>
            )}
          </p>
        </>
      ) : (
        <p className="setnote">Every note about a person is filed into one People folder.</p>
      )}

      <span className="mplabel">Filing rules</span>
      <ListEditor
        label="Filing rules"
        items={rules.filing}
        limit={RULE_LIMITS.filing}
        placeholder="Like: Recipes go to Cooking"
        check={sentenceCheck}
        rows
        onChange={(filing) => update({ filing })}
      />
      <p className="setnote">
        Plain sentences, in your own words. The Librarian reads them each time it files a note; they never
        change what a note says.
      </p>
    </section>
  );
}
