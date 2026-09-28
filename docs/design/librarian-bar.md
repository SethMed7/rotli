# Talk to the Librarian (`/librarian`) — slice 1 plan, and the conversation

Status: building (2026-09-28, the owner: "I wanted everything in this branch").
Slice 1's contract and logic are PR A; the bar is PR B; the conversation (slice 2,
part one) is PR C, on `feat/librarian-chat`. Owner decisions from Round
Three are recorded in [ROADMAP.md](../../ROADMAP.md) under "Talk to the
Librarian". This document is the build plan for slice 1 and the contract
changes it needs; the owning contracts stay
[memex-data-contract.md](../architecture/memex-data-contract.md) and
[ai-visibility-matrix.md](ai-visibility-matrix.md).

## What slice 1 does

Typing `/librarian` in a Markdown note swaps the bottom format bar for a small
Librarian bar. The user highlights part of the note, types what they want, and
sends it. The chosen model **proposes** actions; nothing changes until the user
applies them. Applied actions are journaled and appear in Librarian Activity
with Undo. The note's prose is never edited.

Actions in slice 1:

| Action | What it writes | Through |
|---|---|---|
| Tag | `tags` (Librarian-owned metadata), merged with what is there | `corpus_set_ai_field` |
| Mark this passage | a pointer in `anchors`: the exact words plus a little text before and after, and an optional short label | `corpus_set_ai_field` (new key) |
| File the note | `area`, then the move into that Library area | `fileNoteToArea` |

Following a pointer ships in slice 1 too, or the pointer is only half a
feature: the note's metadata panel lists its marked passages, and clicking one
selects and scrolls to the passage in the editor (the same selection path Find
uses). A pointer whose words are gone says so instead of guessing.

Slice 2, part one (built 2026-09-28, see "The conversation" below): after the
first ask the bar pops out into a multi-turn chat in the pane's corner. Still
to come: new notes from a highlight (people notes, a People folder created
when missing unless a rule says otherwise), and "Open in Chat" to continue full
size.

## Who may use it — checked before any model call

The bar says why, in one plain sentence, and offers nothing else when:

| Condition | Message |
|---|---|
| Web build (`!isTauri()`) | The Librarian works in the Mac app. |
| Librarian off (`brainEnabled` false) | The Librarian is off for this vault. Turn it on in Settings → Librarian. |
| Locked note | This note is locked, so the Librarian won't touch it. |
| Secure note | The Librarian doesn't organize secure notes. |
| Secret-shaped text in what would be sent (a key, token, card or ID number) | This note looks like it holds a secret, so the Librarian won't send it to a model. Remove it, or make the note secure. |
| Not in the Library (plain vault, or outside `wiki/`) | The Librarian only organizes notes in the Library. |

The secret refusal is the same `looksSecret` gate (`src/ai/guard.ts`) that
Hand to AI and chat egress use. It runs on the exact prompt text: the note's
title, the highlighted passage and its prefix/suffix, and the note body excerpt
the prompt carries. It runs before `makeTauriHost(model).complete`, whatever
model is chosen, and Rust's egress ledger still backstops it.

Secure is refused outright in slice 1 (not "on-device only"): the filer write
lane already refuses secure notes in Rust, and the organizer skips them, so a
model proposal could never be applied. Rust independently re-refuses locked,
secure, raw-vault, and out-of-Library writes (`brain_gate`, `filer_writable`).
Unknown frontmatter state counts as locked and secure.

## Model

The bar and the chat use the chat composer's picker (`ModelPicker`,
searchable and grouped by provider) over the models the user has connected
(`mergedModels` without hybrid presets). It defaults to the
Librarian's own choice (`organizerModel` / `organizerModelId`, only when that
provider is switched on), else the on-device default. One call per turn through
`makeTauriHost(model).complete`, with `isSecureContext` wired as a backstop.
Each turn sends the rules and the note as it is now (title, tags, areas, an
excerpt), then the conversation so far, the person's messages carrying the
passage highlighted when they sent them (`src/lib/librarianChat.ts`). The
reply is prose, and when the person asks to organize, it ends with one JSON
object; the prose is shown, and the object is parsed tolerantly against this
grammar (the unit tests pin it). A turn carries the latest 12 turns of the
conversation (`HISTORY_TURNS`), so the context stays bounded; there is no
`formatJson` coercion, since the reply is prose first:

```json
{ "actions": [
  { "type": "tag",  "tags": ["person", "q3"] },
  { "type": "mark", "exact": "…", "prefix": "…", "suffix": "…", "label": "…" },
  { "type": "file", "area": "people" }
] }
```

- The reply may be wrapped in prose or a code fence; the first JSON object
  with an `actions` array is taken, and lifted out of what the chat shows.
  Anything else is a reply with nothing to apply.
- `tag`: `tags` is required, a non-empty list of strings. Each tag is trimmed
  and loses `,`, `[`, and `]`. Empty and duplicate tags are dropped, and a tag
  over 40 characters is dropped.
- `mark`: `exact` is required and must occur in the note. `prefix`, `suffix`,
  and `label` are optional. The model's `exact` is only trusted when it matches
  the highlight; otherwise the anchor is rebuilt from the user's own selection.
- `file`: `area` is required and must name an existing Library area. A
  missing People area is the one exception: it is created, unless a rule says
  people go elsewhere.
- Unknown `type`s, unknown fields, and actions missing a required field are
  dropped silently. At most one `file` action counts (the first).

## Contract change: `anchors`

`anchors` joins the Librarian-owned metadata keys (`AI_KEYS`, Rust and TS,
pinned by a parity fixture). Value: one line of JSON, a list of
`{"exact","prefix","suffix","label"?}`. `exact` is capped at 280 characters
(a longer highlight keeps its first 280 and still finds the passage with its
prefix). Prefix and suffix are up to 32 characters each, and `label` up to 80,
optional, so a later "name this passage" needs no second contract change. At
most 20 anchors per note; the oldest drops first. It is a text-quote pointer:
it finds the passage again without changing the text, and survives edits
elsewhere in the note. Jump-to resolves `prefix + exact + suffix` first. If
that is gone, it falls back to `exact` alone, and a quote that now matches more
than once is shown as "this passage moved" and jumps to none of the matches,
rather than guessing. The organizer never writes it
(`ENRICH_FIELDS` unchanged).

## Editor details

- The bar opens on `/librarian` even when the format bar is hidden
  (`formatBarVisible` off); Escape returns whatever the slot held before.
- The bar shows a live chip of the highlighted text and snapshots the
  selection when the user sends, so a later click cannot change what was asked
  about. CodeMirror keeps its selection when focus moves into the bar, but the
  browser stops painting it, so while the Librarian is open the passage is
  painted as a mark (`passageHighlight` in `findHighlight.ts`, the same pattern
  as Find), following edits and cleared when the Librarian closes.
- `LibrarianBar` lives in its own file; `cmEditor.tsx`, `editorSurface.tsx`,
  and `slashMenu.tsx` only gain the seam (size ceilings).

## The conversation

The first ask pops the bar out: the conversation moves into a chat in the
pane's bottom-right corner (`src/editor/librarianChat.tsx`), above the format
bar when it shows, and the format bar comes back.

It is the Librarian, not a chatbot (the owner, 2026-09-28: "/librarian is here
to help organize things like metadata, not to replace chat"). Its header says
"organizes this note", its quick asks are organizing asks, and its rules tell
the model to organize only. A request for anything else (answering or
explaining, writing, research, conversation) gets one sentence and
`{"actions":[],"handoff":"chat"}`; that reply offers **Take this to Chat**,
which opens a new chat about the note (`openChatForNoteId`, a new tab) with the
question, and the passage it was about, typed into its composer, never sent.
A reply that proposes changes is organizing, so a `handoff` beside actions is
ignored. **Open in Chat** in the header does the same for the latest question
at any time. It holds one conversation,
about one note, in one pane (`state/librarianBar.ts`); another note in that
pane hides it, and `/librarian` again continues it. Every turn:

1. The same refusals as the bar gate the first ask; every turn runs the secret
   check on the whole outgoing conversation before the call.
2. The reply's prose joins the conversation. Its proposals (if any) show as a
   checklist inside that reply, with Not now and Apply; applying goes through
   the same journaled `applyLibrarian`, and the reply then says how many
   changes were made and links to Librarian Activity for Undo.
3. One message at a time; a reply that lands after the chat was closed or
   restarted is dropped.

Escape or − tucks the chat into a button in the same corner; × ends the
conversation. The conversation lives in memory for the app session and is
never written to the vault.

## Order of operations

1. Gate (web, off, locked, secure, not in the Library) before any prompt.
2. Model call; parse; drop anything outside the grammar.
3. Apply tags and anchors first, filing last (filing writes `area` before it
   can refuse). Each write captures its `before` value and journals a row with
   `noteUlid`, `field`, `before`, `after`, and `model`, so Undo in Librarian
   Activity restores exactly and survives the filing move.

## Build steps (stacked PRs)

1. **PR A — contract + logic** (no UI):
   `anchors` key (Rust, TS, parity fixture, contract doc, Rust round-trip
   test); pure `src/lib/librarianActions.ts` (anchor from a selection, prompt,
   tolerant reply parser, tag/anchor merges) with unit tests;
   `src/services/librarianBar.ts` (gate, propose, apply with before-values
   captured for Undo, journal rows, `organizer_learn_field` like Approve) with
   fake-injected tests.
   No user-visible surface; the CHANGELOG notes the new metadata key.
2. **PR B — the bar**: `/librarian` slash item; `EditorHandle.getSelection`;
   `EditorSurface` swaps `FormatBar` for `LibrarianBar` in the bottom slot;
   states: ready, thinking, proposals, applied, error, and every refusal
   above. Only a mark needs a highlight: with no selection, the bar still
   offers tagging and filing for the whole note, and "mark a passage" asks for a
   highlight first (the needs-highlight hint); Escape returns the format bar; keyboard-only path.
   Playwright covers the bar, the swap, Escape, and the web message; unit
   tests cover apply; a native checklist covers the Mac-only write path. Also
   the metadata panel's list of marked passages, with jump-to.

Stacking: PR A targets `feat/hand-to-ai` (#101) until that merges; then
`git merge origin/dev` (keeping the branch side on conflicts) and retarget to
`dev`. PR B stacks on PR A the same way.

## Proof owed to the owner (native)

Browser tests cannot write Librarian metadata (the web build has no filer
lane), so the Mac app needs a hand check: tag, mark, and file a Library note;
see each in Librarian Activity; Undo each; a locked and a secure note refuse.

The conversation adds its own (the web build refuses the Librarian before any
of it, so no browser test reaches it; the chat's states are proved by
component and driver tests with a fake model):

- The first ask pops the chat out in the pane's corner and the format bar
  comes back; a second message's reply shows the model had the first.
- A proposal applied from its card shows in Librarian Activity with Undo.
- An off-topic ask ("write her an email") gets one line and **Take this to
  Chat**, which opens a new chat about the note with the question typed and
  unsent; the button then reads "Opened in Chat".
- The model picker's search finds a model, Escape in its search closes only
  the list, and a picked model answers the next message.
- Escape (or −) tucks the chat into its corner button; × ends it.
- An on-device model: the chat asks for prose plus a trailing JSON object,
  without the `formatJson` coercion the one-shot bar used, so a small local
  model may drop the object and read as "nothing to apply". Worth checking with
  the Librarian's default local model.
