# Librarian rules

Status: built 2026-09-28 on `feat/librarian-rules` (the owner's Round Three list:
"clean up prompts that keep vault organized and allow for rules"). The owning
contract for the data is [memex-data-contract.md](../architecture/memex-data-contract.md)
(`area`, secure keywords); this note records the decisions and the checks owed.

## What the person sets

Settings → Librarian → **Your rules** (`src/components/settings/librarianRulesSettings.tsx`),
kept as one `librarianRules` object in the vault's `.rotli/settings.json` (on
this Mac, never in Git). TS parses it in `src/lib/librarianRules.ts`, Rust in
`src-tauri/src/librarian_rules.rs`; anything missing or malformed is the default.

| Rule | Shape | Default |
|---|---|---|
| Secure keywords | `secureKeywords: string[]` (≤ 50, ≤ 40 chars) | none |
| People | `people: { mode: "groups" \| "simple", groups: string[] }` (≤ 20 groups, one plain name each) | groups: Family, Friends, Work, Acquaintances |
| Filing rules | `filing: string[]` (≤ 20 sentences, ≤ 200 chars) | none |

## Owner decisions (2026-09-28)

- Secure notes go to **one protected folder** (`wiki/_secure/`); keywords only
  decide which notes are secure. Choosing other folders is future work: each
  would need the same Git and model protection.
- People is split by default into **Family, Friends, Work, Acquaintances**,
  editable, with a switch to one list.
- The rules live in the **vault's settings on this Mac**.

## Where each rule acts

- **Secure keywords** match whole words of the note's **title or file name**,
  in any case, never the body and never a model (`secure_by_name`; the TS twin
  `secureByName`; shared cases in `scripts/fixtures/parity.json`). Rust acts at
  creation (born secure), on the save that names the note, on the metadata
  read (the existing auto-flag), in `read_for_ai` (remote refused by name before
  any move), and in the organizer's snapshot (skipped). The two "is the target
  secure" write checks are deliberately unchanged: a keyword note not yet
  moved must not receive protected prose. A note a remote agent creates with a
  keyword title is created secure (it already authored the words), where a
  body secret refuses the creation outright. **Secure matching notes now**
  (`corpus_secure_by_keywords`) protects notes named that way earlier. TS
  refuses such a note in `/librarian` before any prompt exists.
- **People groups** become areas `People/<group>`: the organizer's Classify
  offers them in place of People (`with_people_groups`), `/librarian` accepts
  them, and `file_note` files into them only when the rules name the group.
- **Filing rules** go into the organizer's Classify prompt
  (`filing_prompt`) and the `/librarian` conversation's rules.

## Proof owed to the owner (native)

The browser build proves the Settings editing (`e2e/librarian-rules.spec.ts`);
the rest needs the Mac app:

- Add "bank" as a keyword, then retitle a note "Bank login": it moves to
  Secure on save, and Chat with a remote model can't read it.
- Add a keyword that an existing note's title carries, press **Secure
  matching notes now**: it says how many, and they are in Secure.
- File a person with `/librarian` ("she's a friend"), or let the organizer
  file a person note: it lands in People › Friends, the folder made then.
- Add "Recipes go to Cooking" (with a Cooking area) and capture a recipe: the
  organizer files it there.
- Switch People to One list: persons go to People again.
