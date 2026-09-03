# Tantivy full-text search — a derived, gitignored, rebuildable index

Status: PROPOSED (2026-08-01). Owner contract for the search adapter. Companion
to [`../architecture/egress-threat-model.md`](../architecture/egress-threat-model.md)
(the security path inventory) and [`ai-visibility-matrix.md`](./ai-visibility-matrix.md)
(the policy the index must not weaken).

## Why

For a plain-`.md` vault, search is what decides whether the app is usable at 5,000
notes or only at 500. Today `corpus.rs::search` answers every query with a
substring scan of every note body held in the walk cache — `O(corpus)` per
keystroke, under the corpus mutex, and structurally incapable of phrase, fuzzy,
or tokenized matching. Tantivy replaces the scan with an inverted-index lookup
while keeping Rotli's **no-database** promise: the index is a **derived**
artifact — deletable and fully rebuildable from the `.md` files at any moment —
never a source of truth.

The `.md` files remain the only durable truth. If the index is absent, corrupt,
or a version behind, the answer is always **rebuild** (or fall back to the
substring scan), never data loss and never a blocked app.

## Non-negotiable invariants (design starts here)

1. **The egress boundary is not weakened.** The index contains secure-note text.
   A remote/frontier query must never receive a secure note's title, snippet,
   body, or even a hit. This is preserved *by construction* — see Security below.
2. **No database.** The `.md` files stay durable truth; the index is derived and
   rebuildable. A schema-version mismatch triggers a rebuild, never a crash.
3. **Adapter placement.** Tantivy is a vendor lib behind a narrow adapter
   (`src-tauri/src/search_index.rs`). The `corpus_search` / `corpus_search_ai`
   Tauri command signatures and the `SearchHit` wire shape are unchanged — the
   index is an implementation swap behind the existing seam.
4. **Incremental, not rebuild-per-keystroke.** The index rides the existing
   suppress-marked fs watcher via the corpus generation counter. It re-syncs only
   changed/deleted docs, and only when the generation moved since the last query.
   Startup never blocks on indexing.

## The seam — where the swap lives

```
corpus_search        (user lane: ⌘K, backlinks — ranks the whole corpus)
corpus_search_ai     (AI lane: corpus_search_inner, then read_for_ai per hit)
      │
      ▼
corpus_search_inner  (aggregates roots, id-prefixes, sort_hits, truncate)
      │
      ▼
CorpusStore::search  ──► SearchIndex (Tantivy)   ← the swap
      │                        │ candidate ids, ranked/tokenized/fuzzy
      │  fallback (index unavailable / read-only store)
      ▼
   substring scan (search_match over the walk cache — guaranteed-correct)
```

Nothing above `CorpusStore::search` changes. `corpus_search_ai` still calls
`corpus_search_inner` and still applies `read_for_ai` **per hit in Rust** before
any hit crosses the command boundary. That per-hit gate is the whole security
story and it is untouched (Security, below).

### Division of labour: Tantivy decides *membership*, `search_match` decides *presentation*

`search_match` (`src-tauri/src/search_match.rs`, and its byte-identical TS twin
`src/services/search.ts`) owns the `SearchHit` grammar: rank, the ±60-char
snippet window, emphasis-stripping, and the char spans. Rank, lower first:
0 the whole query is a contiguous substring of the title · 1 every query word
occurs in the title, any order ("checklist launch" finds "Launch checklist") ·
2 the whole query in the body · 3 every word in the body · 4 an index-only
(typo-tolerant) hit nothing here can frame. `spans` carries every matched
word as `[start, len]` char offsets (into the title for 0–1, into the snippet
for 2–3); `matchStart`/`matchLen` mirror the first span. Until 2026-09-03 only
the two contiguous ranks existed, so a note whose title carried all the words
in a different order fell to the fuzzy rank, sorted by recency beneath whatever
the Filer regenerated that morning, and showed no highlight.

`CorpusStore::search` now works in two stages:

1. **Membership + ranking (Tantivy).** Query the index for candidate note ids.
   Each query token is matched as an **infix** (`.*tok.*`) — anywhere inside an
   indexed term, so `config` finds "reconfigure" exactly as the old `find_ci`
   substring lane did. Infix subsumes prefix (as-you-type) and exact matching, so
   the membership set is a **superset** of the old lane (never fewer results — the
   invariant the 2026-08-01 verifier pinned), plus the genuinely new recall:
   multi-token AND, quoted phrase, and a distance-1 fuzzy fallback on the trailing
   token for typos the infix regex cannot reach (`cofnig` → `config`). A query with
   no alphanumeric token (punctuation only) has no index term to match, so it is
   routed straight to the substring lane, keeping the superset invariant true for
   *every* query. Proven by `store_search_index_membership_is_a_superset_of_the_substring_lane`,
   which diffs the two lanes and asserts index ⊇ substring.
2. **Presentation (`search_match`).** For each candidate, look up its cached
   `title`/`body`/`metadata`/`aliases` (already resident from the walk) and run
   `search_match` to produce the snippet, offsets, and rank exactly as today. If
   `search_match` finds neither a substring nor every word (a purely fuzzy hit),
   fall back to rank 4 with a leading-context snippet (HTML comments stripped)
   and no spans, so the result still renders without lying about a highlight.

The final ordering stays `sort_hits` — `rank asc → recency desc → id asc` — so
the wire is deterministic and every existing ordering test holds. BM25 relevance
ordering is available from Tantivy and is noted as a follow-up; it is deliberately
**not** switched on in this change, because it would alter the user-lane ordering
contract and its deterministic tests without a security or correctness need.

### Scope filter — identical to today, reused not re-encoded

`CorpusStore::search` applies the same scope predicates it does now, in Rust,
against the cached metas — never Trash (`is_trash_folder`), never a Memex root's
`chats/` (`is_chats_folder`), `Surface::Reference` only when `include_reference`
is set, kind `Note` only. Candidates are over-fetched from the index (limit × a
small factor) so post-filtering still fills the page. Reusing the existing
predicate functions guarantees the index lane and the substring lane cannot
diverge on what is searchable.

## Index schema

One document per note (kind `Note`). Fields:

| Field | Type | Stored | Indexed | Purpose |
|---|---|---|---|---|
| `id` | STRING | yes | yes | retrieval key + delete/update term (exact) |
| `all` | TEXT (`default` tokenizer, positions) | no | yes | title + body + meta, one field — infix/phrase/fuzzy membership |
| `hash` | U64 (fast, stored) | yes | — | content hash for incremental diffing |
| `secure` | U64 (fast, stored) | yes | — | classification, kept in sync (see below) |

**One combined `all` field, not one per field.** Title, body, and the meta
projection all index into `all` (as separate values, so a phrase cannot straddle
the title/body boundary). Membership is all the index decides — the title-vs-body
rank and the snippet come from `search_match` over the walk cache, not from the
index — so there is nothing to gain from separate fields, and one field is what
makes **infix affordable**: an infix regex is a leading-wildcard scan of the term
dictionary (no FST prefix pruning), so running it once per query token over one
field instead of three times over three fields is the difference between infix
being *slower* than the old substring scan (measured ~4.1 ms/query, 3 fields) and
being *faster* than it (~1.4 ms/query, 1 field; substring ~2.8 ms — see the PR).

The `default` tokenizer (lowercase + unicode word split, no stemming) keeps
matching close to the old lane; stemming was deliberately dropped so `en_stem`
surprises (a query stemming to a different root than the note) cannot cost recall.

Only `id`, `hash`, and `secure` are stored. Bodies are **not** stored — the
snippet is built from the walk cache, which already holds every body in memory,
so the on-disk index is not a second verbatim copy of the prose. Positions are
indexed (required for phrase queries), which does make the note's vocabulary and
word order substantially recoverable from the index files; this is stated plainly
in the threat model rather than glossed.

### On the `secure` field — stored, but never the gate

The `secure` fast field records each note's classification (the same rule
`read_for_ai` applies: `secure:`/`secureContext:` flag or the body detector) and
is kept in sync incrementally. It exists so the index is *self-describing* and so
a future query-time pre-filter is possible.

It is emphatically **not** the security gate, and the design does not trust it.
The authoritative gate is `read_for_ai`, applied per hit in `corpus_search_ai`,
which **re-reads the note's frontmatter from disk** at query time — the source of
truth. A stale or even deliberately-wrong `secure` bit in the index therefore
cannot leak anything: the AI lane re-derives the verdict from disk after the index
returns. A security test drives exactly this — a note secure on disk but flagged
non-secure in the index still yields zero remote hits — proving the index is not
load-bearing for the boundary.

## Lifecycle

- **Open.** `SearchIndex::open_or_create(.rotli/search)` reads a
  `rotli-search-meta.json` schema stamp. If the directory is missing, the stamp
  is absent, the stamp ≠ the current `SCHEMA_VERSION`, or Tantivy fails to open
  the segment files (a Tantivy format bump, corruption), the directory is wiped
  and recreated empty. **Never a crash, never a block.** Opening an empty index
  is cheap; the first query fills it.
- **Sync (incremental).** `CorpusStore::search` calls `SearchIndex::sync` gated by
  the corpus generation: if the index's `synced_generation` equals the current
  generation, sync is a no-op and the query runs immediately. Otherwise it diffs
  the current walk-cache docs against the index's stored per-doc `hash`: unchanged
  docs are skipped, changed/new docs are re-written (delete-by-`id`-term then add),
  and ids absent from the walk are deleted. One commit, then the reader reloads.
  This is the incremental update — it fires only when the watcher (or an internal
  write) bumped the generation, and touches only what changed.
- **Rebuild.** Deleting `.rotli/search/` is always safe. The next `open_or_create`
  recreates it empty and the next query rebuilds it from the walk cache. A schema
  bump is a rebuild, not a migration.
- **Startup.** `lib.rs` opens each store and calls `warm_secure_ledger` (a walk)
  but does **not** build the index — the index builds lazily on first search, off
  the main thread already implied by `corpus_search_ai`'s `spawn_blocking`. A
  large vault costs seconds on first search, never at launch.

## Fallback — substring scan stays the guaranteed-correct floor

If the store cannot host an index — a read-only mount (`open_read_only`,
`band_read_only`, `perms_read_only`), or any `open_or_create` error — `search_index`
is `None` and `CorpusStore::search` uses the existing substring scan verbatim.
The substring path is retained on purpose: it is simple, allocation-light, needs
no disk, and is the correctness oracle the index tests diff against. Choosing
"fall back to substring" over "rebuild-and-wait" means a search is never blocked
on index construction and never wrong — it degrades to today's behavior, which is
correct if slower. This is the deliberate pick the constraints asked for.

## Security — why a frontier query still gets zero secure hits

The index is a new place secure prose lives, so the audit question applies to it:
can a compromised agent loop use the index to get a secure note's title, snippet,
body, or hit to a remote model?

No, and the reason is structural, not incidental:

- `CorpusStore::search` is the **user** lane. It returns secure hits, because the
  user may always see their own notes (same as today's substring search — a local
  read, contract v3.7 gates AI reads, not the user's eyes).
- `corpus_search_ai` is the **only** AI-facing search command. It calls
  `corpus_search_inner` (→ `CorpusStore::search`) and then applies `read_for_ai`
  **per hit, in Rust**, dropping every hit the model may not read, before the
  result crosses the command boundary. For a remote model, `read_for_ai` refuses
  every secure note unconditionally. The index changed *how the candidate set is
  produced*; it did not change *what the AI lane is allowed to keep*.

So the visibility gate applies to index-derived hits exactly as it applies to
walk-derived hits — because it applies at the same seam, after search returns,
regardless of how search found them. The existing injection eval
(`a_cooperating_model_cannot_enumerate_or_read_the_secure_note_remotely`) exercises
this path and passes unchanged; new tests assert it specifically against the
Tantivy lane, including the stale-`secure`-bit case above.

### The index as an at-rest asset

- The index files live under `.rotli/search/`, beside `index.json` and the change
  journal — all derived, all gitignored. A vault `.gitignore` ignores `.rotli/*`
  (or a bare `.rotli/`), which already covers `.rotli/search/`; the only
  un-ignore exceptions are `!.rotli/main.json` and `!.rotli/views.json`, so the
  search dir is never committed. No new gitignore entry is required and none is
  added — coverage ships with the existing rule (adding-things law).
- At rest, the index inherits the same protection as the secure notes themselves:
  macOS account isolation + FileVault (ROTLI_SECURITY rule 1). Secure notes are
  plain local files; the index derived from them is no more exposed than they are.
- The index is **excluded from any diagnostics/support-bundle path** by the same
  rule that excludes the rest of `.rotli/` derived state — it is never read for
  export. This is recorded in the threat model as a new asset (O-series note).

### The secure-prose ledger is untouched

The ledger (`crate::secret::remember_secure_text`) is fed by the corpus **walk**
in `ensure_walked`, and `warm_secure_ledger` walks every root at startup. This
change does not replace the walk with index-driven listing — `corpus_list`,
`tasks`, and `warm_secure_ledger` still walk exactly as before, and `search` still
calls `ensure_walked` (which feeds the ledger) before touching the index. The
egress ledger cannot go cold because of this change.

## What this unlocks

- **No recall regression.** Infix matching means the membership set is a superset
  of the old substring lane — the same anywhere-in-the-text matching users have
  now, never fewer results. This is the floor, not a feature; the additions below
  sit on top of it.
- **New recall (F1).** Multi-token AND, quoted phrase, and distance-1 fuzzy — a
  query can now hit a note it does not contiguously contain, which makes Gemma's
  area-roll-call recovery-hop fire less often. That recovery observation is
  **kept** in this change — verified still working — with a note that Tantivy
  reduces how often it is needed.
- **Findings 2/5.** The per-query `O(N·doclen)` substring scan (which holds the
  corpus mutex for its whole duration) is replaced by an index lookup — measured
  ~1.9× faster at 5,000 short notes and pulling further ahead as the corpus grows
  and notes lengthen (the scan is linear in total text, the index is not). At
  small scale over short notes the cached scan was already fast, so the honest
  framing is: the win is capabilities + scaling headroom + a shorter lock hold,
  not a dramatic speedup at 500 notes. Before/after numbers in the PR.
- **Ranked candidates, snippet highlighting** — the latter fed through the
  existing `SearchHit` offset contract.

## Cost

Tantivy is a large dependency (pulls `zstd`, `lz4`, `memmap2`, `rust-stemmers`,
`tantivy-fst`, …). The binary-size delta and the compile-time cost are measured
and reported in the PR; if the delta is severe relative to the size-diet baseline
(the 40→20 MB session), it is flagged for the maintainer to weigh rather than absorbed
silently. the maintainer named Tantivy; the default is to use it unless the measurement is
damning.
