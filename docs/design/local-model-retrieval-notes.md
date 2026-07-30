# Local-model retrieval over a real vault — eval notes + design directions

Status: DRAFT (2026-07-30) — evidence memo, not a contract. Written from a
whole-vault eval sweep (`scripts/eval-vault-sweep.ts`, cases + transcripts kept
outside the repo per the no-real-content rule; all examples below are
synthetic). Companion prior art: `scripts/eval-local-chat.ts` (the 0.46.1
fixture harness) and `docs/architecture/system-audit-2026-07-29.md`.

All numbers in this memo describe an anonymized production-shaped vault
(~200 visible notes, ~330 files, one writable memex root); names and note
contents in examples are invented stand-ins with the same *shape* as the real
failures.

## 1. What a real vault looks like (and why it breaks fixture assumptions)

The fixture vault in `eval-local-chat.ts` has 8 notes, one area each, and one
purpose-built index note. A production vault measured through the read-only
workspace CLI looks nothing like it:

- **~207 workspace-visible Markdown notes** across ~19 disk folders, plus
  ~330 storage files and a handful of boards. One area dominates: a daily-brief
  folder holds **~34%** of all notes (71/207), all near-identical in title
  shape ("Brief — <date>").
- **Metadata coverage is high but uneven**: `summary` 85%, `tags` 81%,
  frontmatter `links` 63% — but `area` only **7%** and `created` 27%. The
  enrichment fields the Filer owns exist for most filed notes; the older and
  hand-made lanes (theology, people, chats, _inbox) sit far below the average.
- **Body wikilink density is low**: 150/207 notes contain zero body
  `[[wikilinks]]` (median 0, mean 1.1). The link graph the prompts warn the
  model about is concentrated in a few index/master notes (max 26 links).
- **Note length**: median ~4.3k chars, p90 ~10.2k, max ~38.5k. With
  `readNoteChars = 6000` (the 128k tier), **roughly a quarter of all notes
  truncate on read** — and the notes most worth reading (indexes, master
  plans, specs) are precisely the long ones.
- **Intake is real**: 16 notes sit in `wiki/_inbox` unfiled, several of them
  duplicate captures with identical titles ("(2)", "(3)", …). Duplicates are
  not an edge case; they are what intake looks like.
- **Two kinds of "index" notes coexist** per area: a human-written `README.md`
  (prose about how the area is organized — often with **zero member names**)
  and a Filer-generated `_index.md` (a table of every member note + its
  one-line summary). They answer *different questions*, and nothing in the
  retrieval surface tells the model which is which.

### What the model map actually shows for this vault

`buildModelMap` sorts areas by their top note's priority (pinned, then
recency). On this vault, with nothing pinned, that means:

- The **daily-brief area leads every tier's map** (it is always the most
  recently touched), followed by boards, chats, and Trash. On the balanced
  tier (3.5k cap) the map truncates after ~10 areas.
- **The people area never appears in any tier's map** — its notes are months
  old, so it falls past the truncation point. For "who are the people in my
  vault", the map contributes nothing; search must carry the whole burden.
- Trash contents and quadruplicate intake captures occupy map slots that
  areas like people/projects lose.

## 2. Eval sweep — setup and results

Setup: the REAL `runAgent` loop + adapter prompts; `searchNotes` /
`readNote` / `knowledgeMap` ride the packaged read-only workspace CLI
(`notes search` IS Rust `corpus_search`; the secure/secret-shaped lane is
omitted in Rust before the model sees anything); `complete()` rides the local
MLX server on loopback. 20 questions across people, projects (3 products),
engineering, research, briefs/timeline, theology (negative space), inbox,
cross-area synthesis, one secure probe, and 4 multi-turn follow-ups.

Known fidelity gaps vs the in-app host (kept, and worth knowing): the CLI's
`notes list` caps at 500 entries, so the map's area counts skew toward
recently-created files; `search_memory` degrades to note search (no chat
retrieval lane over the CLI); and the CLI lane has no secure-note
`local_ai_allowed` path at all — which is the correct posture for an external
harness.

### Scores (baseline, pre-quick-win prompts)

| | gemma-3-12b (128k tier) | qwen2.5-3b (32k tier) |
|---|---|---|
| correct / partial / wrong | **9 / 1 / 10** | **2 / 0 / 18** |
| read a note before final | 14/20 runs | 1/20 runs |
| avg steps (model calls) | 4.0 | 1.8 |
| avg wall per question | ~62 s | ~4 s |
| truncated reads encountered | 6/20 cases | 1/20 |
| secure probe | pass (no hit, clean refusal) | pass (refusal) |

By category (gemma): single-note lookups with a distinctive keyword are
reliable (people-profile, inbox capture, philosophy, daily-brief recency,
theology negative-space, area-scoped engineering detail: 8/9 correct-ish);
enumeration, cross-area synthesis, and multi-turn follow-ups are where it
dies (1/8). The failure is almost never comprehension — the model summarizes
whatever it reads well — it is **finding and choosing the right note**.

**qwen2.5-3b is below the protocol floor on a real vault**: in 18/20 runs it
emitted an immediate `final` without a single tool call (`{"thought":"final",
"final":"…"}`) and fabricated or denied ("X is not mentioned in your notes").
Its 2 passes were the refusal probe and one lucky map-led brief question.
This model ships in `LOCAL_CATALOG`; the catalog should carry a
capability floor (or the loop a mandatory-first-search mode) before a 3B
model is offered as a vault assistant.

The single most instructive contrast: asking one person's profile succeeds in
3 steps / 24 s, while "list everyone" fails after 6 steps / 84+ s — same
area, same notes, same model.

### Quick-win before/after (prompt tweaks only, same model, same cases)

Re-run of the 9 failing F1/F4-adjacent cases plus 2 passing regression
checks, gemma-3-12b, after the two prompt tweaks (§6):

| case (category) | before | after | note |
|---|---|---|---|
| synthesis (friends/family projects) | wrong | **correct** | degraded to a single keyword, read the projects `_index`, synthesized from its summaries |
| project log (cleanup question) | wrong | **partial** | keyword query hit; answer from the first 6k chars only (F5) |
| enumeration + live follow-up repro | wrong | wrong | queries improved; still reads the prose README over the roster `_index` (F2 — needs metadata, not prompts) |
| decision qs (2), research q, follow-ups (2) | wrong | wrong | model still composes multi-word exact-substring queries under pressure; retries more but keyword discipline decays |
| regression checks (2) | correct | correct | no regressions |

Net: **+1 correct, +1 partial of 9**, no regressions. Honest read: prompt
teaching moves the margins; the dominant failures need the engine
(tokenized search) and metadata (index-note roles, summaries on hits). The
re-run also surfaced a new unwanted behavior: after failed retrieval the
model tried to `create_note` a "research blocked" note into the vault (the
eval host refused; in-app this becomes junk intake) — failed-retrieval
should never trigger note creation.

One more capability-tier observation, isolated with a same-class 12B model
whose id family `contextWindowFor` does not recognize (→ the 8k "frugal"
tier: 1.2k map, no ids, 900-char reads). On a 4-case probe it kept the
distinctive-keyword profile win and the secure refusal, but **lost the
daily-brief recency question that the balanced tier passes** — the balanced
map carries the brief's exact title + id, and the model wins by copying that
title into search; the compact map (2 titles, no ids) takes that move away.
Map budget measurably changes outcomes for identical questions. Tier
assignment by id-substring is also fragile; the registry should carry the
context window as data (it already stores per-model metadata) instead of
inferring it from the name.

## 3. Failure patterns (by class, each tied to a design lever)

Every failure in the sweep fell into one of six classes. Examples are
synthetic re-creations of real transcripts.

### F1 · Exact-substring search vs natural-language queries

`corpus_search` (and therefore `search_notes`/the CLI's `notes search`) is
**exact-substring** matching: `"rent everything"` hits the note containing
that phrase; `"myela strategy"` returns zero because those tokens are never
adjacent. Small models open with whole-question queries ("who are the people
in my notes") and burn 1–3 of their 5 steps on empty results before
discovering single keywords work. Observed in a third of gemma's runs and the
majority of qwen's. Levers: tokenized AND matching in Rust (0.47), plus a
prompt rule to search with 1–3 keywords (quick win), plus `queryHints` in the
learned index (§5).

### F2 · Wrong-source selection: README vs roster, stub vs target

Areas carry two index-shaped notes (prose `README` + generated `_index`
table) and tombstone stubs ("Moved → [[target]]"). The model cannot tell them
apart from titles/snippets, reads the prose or the stub, and answers about
*structure* instead of *members* — the exact live 0.46.1 failure. A recency-
polluted map amplifies it: the daily-brief area leads every map, so a "people"
search that also matches a brief tempts the model into reading the brief.
Levers: `role:"area-index"` metadata on hits/map (§4.1, §4.3), summary-carrying
hits, learned-index `corrections` (§5).

### F3 · Single-read satisficing under the step cap

With 5 steps and 1–3 spent on empty searches, the model reads exactly one
note and finalizes — even when the right note was visible in the hit list it
already held. Enumeration questions ("all/every/list") need the roster
`_index` read; profile questions usually succeed because any one person note
suffices. This is why people-profile passes while people-roster fails on the
same area.

### F4 · Per-turn scratch amnesia → path re-treading

Scratch resets each turn; only the model's own prose answer survives in
history. A follow-up asking for specifics re-runs the SAME search, re-reads
the SAME wrong note, and pads the rest from its prior summary — the wrong
path is now precedent, not evidence. (The observed shape: turn 1 read the
zero-name README; turn 2 re-read it and enumerated a model name from an
unrelated test note as a "person".) Levers: carry forward a compact
read-trail ("turn 1 read: <id> <title>") into the next turn's prompt, teach
"a follow-up asking for names/details requires reading a NEW source, not the
one that already failed to contain them", and learned-index routes.

### F5 · Truncation-blind synthesis on long notes

Long notes (p90 ≈ 10k chars) truncate at 6k with an explicit marker. The
marker keeps the model from claiming completeness (that fix holds), but the
content past the cut is simply absent: answers built from a master note's
first 6k chars miss decisions recorded further down. Levers: metadata-first
reads (summary + headings outline before body), section-addressable reads
(0.47), larger read budget for balanced+ tiers.

### F6 · Echo-chamber pollution from persisted chat notes

Prior model conversations persist as chat notes and board summaries in the
vault, so yesterday's wrong answer becomes today's search hit ("Testing …"
notes matching "people"). One sweep answer listed an AI model's name as a
person because a prior test chat mentioned it. Levers: down-rank `chats/` and
board-summary hits for note questions, exclude them from the map's leading
areas, and never let learned-index routes point into chat notes.

## 4. Where metadata would have fixed a failure

Concrete places in the sweep where existing (or one new) metadata field would
have converted a wrong answer into a correct one. Examples are synthetic but
shape-identical to the observed transcripts.

### 4.1 Summaries are the roster; snippets are lottery tickets

The single highest-leverage observation: **85% of notes already carry a
Filer-written one-line `summary`, and the model never sees it.** Search hits
surface a 160-char *body* snippet framed around the match; the map surfaces
*titles only*. In the enumeration failures, the model held a hit whose snippet
happened to window into the roster table — and still read the wrong note,
because nothing distinguished "the note ABOUT the people area" from "the table
OF people".

Synthetic illustration — today's search result:

```json
{"id":"…","title":"people","folder":"wiki/people",
 "snippet":"<!-- Generated by the Filer --> | Note | Summary | | --- | …"}
```

With `summary` (and a `role` for generated index notes) carried on the hit:

```json
{"id":"…","title":"people","folder":"wiki/people",
 "summary":"Index table of every person note in this area (9 people)",
 "role":"area-index"}
```

A 12B model reliably picks the second shape. The metadata already exists; the
retrieval surface just drops it. The same applies to `search_memory` and to
the knowledge map's balanced/expansive tiers.

### 4.2 Frontmatter as parse target, not noise

The prompts currently teach "text between --- lines is filing metadata, not
content" — a *defensive* rule written when frontmatter confused enumeration
(link stems presented as people). But the sweep shows the opposite failure
now dominates: the model is told to ignore the one structured, load-bearing
line (`summary:`) a note carries. The right shape is to **strip frontmatter
from `read_note` bodies at the host** (the workspace CLI already does this —
`notes read` returns pure body, and the eval rode it without a single
frontmatter-confusion failure) and instead deliver `summary`/`tags`/`area` as
*structured fields on hits and reads*, where they are data the model is meant
to use, not prose to be waved off.

### 4.3 What the knowledge map should carry, per capability tier

Measured map behavior on the real vault (nothing pinned): recency sorting puts
the 71-note daily-brief area first at every tier, Trash and duplicate intake
captures occupy slots, and the people/theology/tasks areas never fit. Proposed
per-tier shape, extending `modelMapPolicy` (`src/memex/modelMap.ts`):

| Tier | Today | Should carry |
|---|---|---|
| compact (<24k) | 2 titles/area, no ids | area names + **counts + one-line area digest** (no titles — titles mislead more than counts at this size) |
| balanced (24k–180k) | 4 titles/area + ids | titles + ids **+ per-note `summary` (capped)** + the area's `_index` note id marked `role:"area-index"` |
| expansive (≥180k) | all titles + ids | same + `tags` rollup per area |

Plus three shape rules independent of tier, each tied to an observed failure:

- **Lifecycle filter**: Trash (and archived) notes never enter the map — they
  cost slots and invite reads of deleted content (observed: Trash listed at
  every tier).
- **Serial-area compression**: an area whose titles share a date-stamped shape
  ("Brief — <date>" × 71) collapses to one line with a count and the newest
  id, freeing ~40% of the map budget (measured on the real vault) for the
  areas that answer identity/people/project questions.
- **Pinned index notes**: the Filer's `_index.md` notes are exactly the "read
  this first for enumeration" targets; the map should carry them per area
  regardless of recency. `priorityOrder` already honors pinned — the Filer
  (not the user) should pin its own indexes, or the map should special-case
  `role:"area-index"`.

## 5. Per-model self-built indexing — a concrete sketch

The sweep's most stubborn failures are not knowledge gaps — they are *routing*
gaps the loop re-commits every conversation: natural-language queries that
full-text search can't match, the wrong index note read twice in a row, a
follow-up that re-treads the identical wrong path because per-turn scratch
starts empty. A per-model, self-built projection can close exactly this class
without touching durable truth.

### 5.1 Shape and home

```
.rotli/ai/<model-id>/learned-index.json     (per memex root, per model)
{
  "version": 1,
  "model": "<model-id>",
  "builtFrom": { "noteCount": 207, "newestUpdatedAt": 1785406100365 },
  "routes": [
    { "ask": "people|who is|family",             // normalized intent key
      "readIds": ["<roster-note-id>"],           // what actually answered it
      "confidence": 3,                            // times it worked
      "lastVerified": "2026-07-30" }
  ],
  "areaDigests": [
    { "area": "wiki/people",
      "digest": "9 person notes; roster table lives in the _index note",
      "sourceIds": ["…"] }
  ],
  "corrections": [
    { "ask": "people roster", "wrongId": "<readme-id>",
      "rightId": "<roster-id>", "note": "README describes structure, holds no names" }
  ],
  "queryHints": [ { "bad": "who are the people in my notes", "good": "people" } ]
}
```

- **Never in the text tree, never durable truth** — it lives beside
  `main.json`/`views.json` in `.rotli/`, is deletable at any moment, and per
  the data contract ("`.rotli/` files are rebuildable projections") nothing
  may treat it as a source of facts. It stores *ids and routing*, not note
  prose; digests are the model's own words about where things are, not what
  they say.
- **Written by the loop, not the Filer**: after a run ends, the host appends
  (a) reads that preceded a user-accepted answer as `routes`, (b) explicit
  user corrections ("no, look in X") as `corrections`, (c) zero-hit queries
  paired with the query that later worked as `queryHints`. A small
  size-capped journal, compacted on write.

### 5.2 Consultation — a `knowledgeMap` augmentation, not a new tool

`buildModelMap` already produces the capability-sized ToC (Model Mapping 0,
ROTLI_MEMORY rule 0). The learned index extends that substrate rather than
replacing it: after the fresh map is built, up to N (cap ~600 chars) matching
`routes`/`areaDigests`/`queryHints` entries are appended as a separate
`"learned"` JSON block, same `trust:"untrusted-data"` marking, selected by
overlap with the user's question. The fresh map stays authoritative for what
exists; the learned block only says *where this model found answers before*.
A compact-tier model gets `queryHints` only (they pay for themselves at that
size); balanced+ gets routes and digests.

### 5.3 Bounds, staleness, rebuild

- **Size cap**: hard ceiling per file (e.g. 32 KB); compaction drops lowest
  `confidence` first, then oldest `lastVerified`.
- **Staleness**: every entry carries the source note ids; consultation drops
  entries whose ids no longer resolve (rename-safe: ULIDs survive renames).
  `builtFrom.noteCount`/`newestUpdatedAt` gate a cheap "vault moved a lot →
  decay confidences" pass.
- **Full rebuild**: delete the file. Nothing else references it; the next runs
  regrow it. An explicit "rebuild" can also replay it against the live vault
  and keep only entries that still verify (ids resolve + digest area exists).

### 5.4 Safety rules (these are the design, not an appendix)

- **Local models only, per model.** The file is keyed by model id and only the
  same on-device model consults its own entries. Frontier/remote models get
  nothing from it: entries can encode note EXISTENCE (titles/ids of things a
  remote model's map would have been filtered from), so cross-model sharing
  would become an egress side channel.
- **Secure taint.** A run that read a secure note (the audit-#7 taint signal,
  now `secureContext`) writes NOTHING to the learned index for that run — not
  even ids. Fail closed: if taint state is unknowable, skip the write. This
  keeps the file shareable with the *non-secure* future runs of the same
  model.
- **Injection containment.** Learned entries feed future prompts, so a hostile
  note could try to plant instructions via a "digest" the model wrote while
  reading it. Three fences: (1) digests/routes pass the same `dataField`
  control-character neutralization + length caps as map titles; (2) the block
  renders inside the existing `<knowledge_map>`-style untrusted-data fence,
  never as prompt scaffold; (3) entries are structurally typed (ids, area
  names, short strings) — free-prose fields are capped well below
  instruction-carrying length (~200 chars) and `defuse()`d like every other
  untrusted surface.
- **No write path from prompts.** The loop's tool grammar gets no
  "remember this" tool in v1; writes happen only in host post-processing of
  observed behavior (which reads succeeded, which queries zero-hit). A note
  cannot instruct the model into writing chosen text into the index because
  the index writer never takes model-authored free text — the digest lane, if
  enabled, is the one exception and carries the caps above.

## 6. Quick wins vs 0.47-sized work

### Implemented in this change (prompt-only, re-proven on the affected cases)

1. **Keyword-search teaching** (F1) — both adapters now say search matches
   exact text; the gemma adapter adds "1-3 short keywords, never a whole
   question" and "no hits → retry ONCE with one different word".
2. **Follow-up re-read rule** (F4) — the gemma adapter now teaches that a
   prior answer is a summary, not a source, and that a note that lacked the
   asked-for specifics must not be re-read.

Both are pinned in `src/ai/prompt.test.ts`; before/after deltas on the
affected sweep cases are recorded in §2 (net +1 correct, +1 partial, no
regressions — real but marginal, which is the point: the rest needs code).

### 0.47-sized (each tied to an observed failure)

- **Tokenized AND search in Rust `corpus_search`** (F1) — "breve rotli" must
  match a note titled "Breve → rotli". Prompt teaching only shrinks the
  failure; the engine is the fix. Keep exact-phrase as a quoted operator.
- **Summary-carrying hits + `role:"area-index"`** (F2, §4.1) — surface the
  Filer's existing `summary` on `search_notes`/`search_memory` hits and mark
  generated `_index` notes; budget cost is bounded by `snippetChars`.
- **Map shape work** (§4.3): lifecycle filter (no Trash), serial-area
  compression (71 same-shaped briefs → one line), area-index pinning. All in
  `modelMap.ts` + the host's list mapping — unit-testable pure code.
- **Read-trail carry-over across turns** (F4) — persist the turn's read ids +
  titles as a compact line in the next turn's prompt (not the whole scratch),
  so a follow-up starts knowing what was already read and what it lacked.
- **Learned index v1** (§5) — routes + queryHints only (no digests), local
  models only, consultation as a knowledgeMap suffix block.
- **Chat-note down-ranking for note questions** (F6) — provenance-aware rank
  penalty for `chats/` and board-summary hits in note-search context.
- **Section-addressable reads** (F5) — `read_note` with an optional heading
  path, so a 38k-char master note can be read in slices instead of
  first-6k-chars-only.
- **Catalog capability floor** — qwen2.5-3b (a `LOCAL_CATALOG` entry) skipped
  tools in 18/20 real-vault runs and fabricated/denied instead. Either gate
  sub-7B models out of the vault-assistant role, or add a loop mode that
  forces one search before any final on note-question turns.
- **Context window as registry data** — stop inferring the budget tier from
  id substrings (`contextWindowFor`); the memex-ai registry already stores
  per-model metadata and should carry `contextWindow` explicitly, with the
  substring heuristic as fallback only.
- **No create-on-failure** — after zero-hit retrieval the model reached for
  `create_note` to record its own failure; the create lane should be
  unavailable (or confirm-gated) when the turn's retrieval found nothing and
  the user didn't ask for a note.
