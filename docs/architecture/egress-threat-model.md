# Egress threat model — can secure content reach a remote model?

Status: ACCEPTED (2026-08-01) · Audit + hardening · Companion to
[`../design/ai-visibility-matrix.md`](../design/ai-visibility-matrix.md) (the
policy) and [`../security/threat-model.md`](../security/threat-model.md) (the
app-wide model). This document is the **path inventory**: every route by which
bytes leave the machine, what stops secure content on each, and what did not.

## The question this document answers

The visibility matrix promises that a frontier/API model never receives a secure
note's **title, snippet, body, or search hit**. That promise is only as strong
as the layer that enforces it, so this audit asked one question in one adversarial
frame:

> Assume the TypeScript agent loop is **compromised or simply buggy**. It can
> invoke any Tauri command, with any arguments, in any order, ignoring every
> guard in `src/`. Can secure content — body, title, snippet, or the mere fact
> that the note exists — reach a remote provider through **any Rust path**?

That frame is not paranoia, it is where the trust boundary actually is.
`src/ai/` runs in the webview. The check scripts are static analysis. The
regex secret detector is a heuristic. **Rust is the only authority**, so Rust is
where every claim below is tested.

The answer, before this change: **yes, by nine distinct routes.** After it:
no route remains that does not require write access to the user's own disk.

## What "remote" means

Re-derived at every seam, never accepted from a caller:

- `chat::endpoint_is_local` — a real loopback host, parsed as an IP. Anything
  unparseable is not local.
- `chat::model_is_local` — loopback **and** a registry-declared on-device
  provider (`mlx` / `llamacpp` / `ollama`). A frontier provider behind a
  localhost proxy is remote. Verified: the loopback check runs *before* the
  registry lookup, and a model entry cannot carry its own endpoint.
- Headless workspace agents (`rotli` CLI, `rotli-workspace` MCP) are remote for
  content policy even though the process is local.

## The two content predicates

Everything in the tables below reduces to which question a seam asks.

| Predicate | Catches | Misses |
|---|---|---|
| `secret::looks_secure` | credential SHAPES — API keys, PEM, JWT, SSN, Luhn-valid PANs | ordinary private prose |
| `secret::protected_for_remote` | the above **+ markers**: `secure: true`, `local_ai_allowed:`, `secureContext: true` | prose whose markers were stripped |
| `secret::blocked_for_remote` | the above **+ the secure-prose ledger** | prose that never entered the vault |

**The ledger is the new thing, and it is what made most of the fixes possible.**
Before it, Rust could only refuse text that ANNOUNCED itself. A secure note is
usually not secret-shaped — it is private because the user said so — so the
moment its frontmatter was stripped (which the ordinary editor read does, by
design) its prose was indistinguishable from any other sentence, and Rust had
no basis to refuse it. `src/ai/guard.ts` had answered this since the 2026-07
audit with `containsPrivateDataOverlap`, but only in TypeScript, on the side of
the boundary this audit assumes hostile.

The ledger gives Rust the missing memory. Every corpus walk hashes the verbatim
5-word phrases of every **secure** note into a process-local, never-persisted
set. Every egress seam then refuses outbound text that echoes one. It is fed by
the WALK rather than by a read on purpose: it must not matter which command the
caller used to obtain the bytes.

Tradeoff, stated plainly and without flattery: this is a **contiguous
verbatim-phrase** rule (≥5 tokens, ≥24 chars). It stops **bulk verbatim
copying** and nothing subtler. Chunking the prose into ≤4-word fragments,
paraphrase, translation, reordering the sentence, base64/rot13 — every one of
those defeats it, by design. It is emphatically **not** a covert-channel
defense. It is why the ledger is a LAYER, not the gate — the gate is
`read_for_ai`, which stops a remote model getting the prose in the first place.
The ledger exists for the narrower, concrete case the matrix made common on
2026-08-01: on-device models now read secure notes routinely, so secure prose is
legitimately in memory far more often than before, and the cheap, common mistake
— an injected loop pasting a note's paragraph into a URL — should not be the one
thing that works. The determined exfiltrator is stopped upstream, at the read, or
not at all.

---

## The full path inventory

Verdicts are as of this change. "GAP → FIXED" means the audit found it open and
this commit closes it; every fix carries a Rust test that drives the path the
way a compromised loop would.

### Model transports

| # | Path | Verdict | Enforced by |
|---|---|---|---|
| 1 | `chat_messages` → loopback model | SAFE | destination clamp (`endpoint_permitted`), then the local lane is unrestricted by design |
| 2 | `chat_messages` → Gemini / registered remote | **GAP → FIXED** | `egress_allowed` asked `protected_for_remote`; it now asks `blocked_for_remote`, so stripped secure prose no longer passes |
| 3 | `cli_complete` → `claude` / `codex` / `agy` | **GAP → FIXED** | same upgrade. This is the lane Seth's frontier models actually use, and it was reachable with the body of any secure note via the ungated `corpus_read` |
| 4 | `generate_image` → `codex` / `agy` | **GAP → FIXED** | same upgrade; a prompt is an egress channel like any other |
| 5 | Organizer → `claude` / `agy` (`organizerModel` setting) | **GAP → FIXED** | had **no** transcript backstop at all — the only remote seam in the codebase with a single line of defense. `organizer_egress_allowed` is now that second line, and it also covers the two content paths that never passed `skip_reason`: an area `_index.md` description (excluded from snapshotting) and the enrich prompt built after a filing move without a fresh secure re-read |
| 6 | Organizer → local MLX | SAFE | `complete_local` is loopback by construction |

### Web lanes

| # | Path | Verdict | Enforced by |
|---|---|---|---|
| 7 | `web_search` — query to the explicitly selected DuckDuckGo or Brave adapter | **GAP → FIXED** | gate upgraded to `blocked_for_remote`; the query is capped at 512 chars; destinations are literal and redirect-free. Provider choice is per vault, the globe remains per-chat consent, Brave authentication is Keychain-only in Rust, and failures never fall through to a different provider |
| 8 | `web_fetch` — URL to any public host | **GAP → FIXED** | gate upgraded. SSRF containment (scheme, private-IP, same-host redirects, byte + 2048-char URL caps) was already solid and is untouched |
| 9 | `open_url` — URL to the OS browser | **GAP → FIXED** | had **no content gate whatsoever**. `url_openable` bounds the SCHEME, which stops an arbitrary app launch, but nothing bounded the payload. The webview can `invoke` it directly, so the agent loop's own `EGRESS_TOOLS` list never applied to it. It now asks the same question every other outbound lane asks |

### Retrieval — how a model learns what exists

| # | Path | Verdict | Enforced by |
|---|---|---|---|
| 10 | `corpus_read_ai` (read by id) | SAFE | `read_for_ai` — locality re-derived in Rust; refusals quote nothing |
| 11 | `corpus_readable_ids` (batch probe) | SAFE | the exact same `read_for_ai` per id; bodies never returned |
| 12 | `corpus_search` + TS filter | **GAP → FIXED** | Rust supplied the verdict, **TypeScript applied it**. A loop that skipped the probe got the titles and snippets of every matching secure note. New `corpus_search_ai` applies `read_for_ai` per hit **in Rust**, before anything crosses the boundary — one round trip instead of two, so it is also faster |
| 13 | `corpus_list` / `corpus_reference_notes` → knowledge map | **GAP → FIXED** | same shape: secure TITLES reached the map through a TS-side filter. New `corpus_notes_ai` filters in Rust |
| 14 | `corpus_read` / `corpus_file_text` / `corpus_file_bytes` | **MITIGATED** | these are the USER's editor lanes and cannot refuse the user their own notes. `corpus_read` returns the **frontmatter-stripped** body, which is precisely why the marker backstop was insufficient — see the ledger, above. The bytes are still obtainable; they can no longer EGRESS. **This holds from process start:** the ledger is fed by the corpus walk and `open` does not walk, so a fresh process once held none of a never-browsed root's secure prose until its first `list` — a real boot race (audit follow-up finding #2). Closed by walking every registered root once in the lib.rs setup loop (`warm_secure_ledger`), before any command can run |
| 15 | Workspace `notes list` / `search` / `query` / `read` | SAFE | `read_for_ai(id, false)` per item, filter-before-truncate |
| 16 | Workspace `list` — files and folders | **GAP → FIXED** | `NoteKind::File` metas and the whole folder tree bypassed every filter (`_ => true`), shipping the reserved `Secure notes/` folder name to a remote agent. Both now pass `agent_listable` |

### Writes — persistence and laundering

| # | Path | Verdict | Enforced by |
|---|---|---|---|
| 17 | `corpus_write_ai` — locked refusal | SAFE | `write_for_ai`, read gate then lock |
| 18 | `corpus_write_ai` — laundering | **GAP → FIXED** | "secure content flows only into secure containers" was enforced only by the TS host, via the CHAT's taint — and a chat id is a webview assertion. Rust cannot see chats; it CAN see that the incoming body is protected content, and now refuses to let it land anywhere it would stop being protected |
| 19 | Workspace `update_note` | **GAP → FIXED** | `compare_revision` ran BEFORE the read gate and reports `found fnv1a64:<hash>` — an unkeyed hash of a secure note's complete on-disk bytes. That is a **change-detection** oracle: poll the revision, watch it move. The gate now runs first, so the hash is never computed for an unreadable note. (The coarse path-existence bit remains — see O6) |
| 20 | Workspace `assign_view` | **GAP → FIXED** | a view tag rewrites the target's frontmatter, so it is an AI write — but the lane checked only that the path RESOLVED. A remote agent could stamp a note it may not read, a note the user LOCKED, or a `Reference`/`Hidden` lane the matrix says no lane ever writes. The read/lock/surface gate now runs first, and resolves the id itself so nothing touches disk before the verdict. (The coarse path-existence bit remains — see O6) |
| 21 | Filer / organizer writes | SAFE | `filer_writable`, `snapshot_note`, `auto_applies` — secure and locked skipped, flag ∪ detector |

### Chat memory

| # | Path | Verdict | Enforced by |
|---|---|---|---|
| 22 | Tainted transcript → remote model | **GAP → FIXED** | the matrix (T2 step 5) promises Rust refuses a `secureContext: true` transcript "regardless" of the TS filter. It did not: `protected_for_remote` knew `secure: true` but not the longer key. It does now |
| 23 | Tainted transcript → headless agent | **GAP → FIXED** | in a memex root `chats/**.md` are ordinary notes, so the remote-by-policy workspace agent could read a tainted transcript straight out of the notes lane. `read_for_ai` now treats the taint marker as secure |
| 24 | Per-turn memory note sync | SAFE | routes through `write_for_ai`; locked refused, laundering refused |

---

## OPEN — found, not fixed, and why

These are real and they are not silently carried. Each needs either a product
decision from Seth or a change whose blast radius does not belong in a security
commit.

### O1 — Breve's brief agent reads the whole vault (HIGHEST)

`routines.rs` spawns the scheduler, which runs
`claude -p --dangerously-skip-permissions` with `BREVE_KNOWLEDGE` pointed at the
entire vault root. The macOS sandbox profile allow-reads the memex wholesale.
Secure notes are ordinary `.md` files inside it.

**So: any note the organizer would refuse to send, the morning-brief agent can
simply open.** No gate in this document applies, because nothing is passed
through a seam — the model is handed a filesystem.

Not fixed here because the fix changes what Seth's daily brief can SEE, which is
his call, not a hardening decision. The concrete option: the secure lane already
appends every secure note's relative path to the vault `.gitignore`, so the
sandbox profile can emit a matching `(deny file-read* (literal …))` per path and
close this precisely. That belongs in its own change, with Seth's sign-off and a
brief run to confirm nothing he wants is lost.

### O2 — the model registry is an unprotected trust anchor

`~/.memex/ai/registry.json` is the sole thing distinguishing "a real on-device
model" from "a loopback proxy to a frontier provider". It is a plain user file.
A caller can reach it by registering `~/.memex` as a corpus root
(`corpus_add_folder` accepts any absolute path that `is_dir()`), which opens as
`LegacyRotli` where everything is writable, and then writing
`providers.mlx.endpoint`. Exploiting it for exfil additionally requires an
attacker-controlled loopback listener, so it is a chained break rather than a
standalone one — but the same primitive grants arbitrary `$HOME` read/write,
which is independently serious.

Recommended (small, safe): refuse to register a corpus root that IS `$HOME` or
that CONTAINS `~/.memex`. Deferred only because root registration is a UX path
and this audit's remit was egress.

### O3 — `read_main` / `read_views` leak ids to the headless agent

The Main and view manifests are dumped verbatim, and they reference notes by id
from anywhere in the corpus. Differencing them against `rotli_list` yields the
secure id set exactly. `rotli_status` additionally discloses absolute vault
paths, which makes path-guessing practical. The matrix's T1 defense is stated as
"the model never learns those ids"; the workspace lane does not honor it.

Filtering both manifests through `read_for_ai` is the fix and it is small — it
is out of this commit only because manifest filtering interacts with how the
sidebar reconciles orphaned entries, and getting that wrong loses user structure.

### O4 — `queue_open` takes an unvalidated id

A remote agent can force the local app to open a named item on screen, with none
of the shape validation `parse_deep_link` applies to the same payload.
Disclosure to the user's own screen, not to a model — low, but it should share
the deep-link validator.

### O6 — the path-existence differential (low, pervasive, accepted)

`read_for_ai` must resolve an id to a path before it can read the frontmatter it
gates on. So a **non-existent** id errors `note not found` while an **existing
secure** one errors `This note is secure…`. Any lane that reads by id therefore
lets a caller distinguish "no note here" from "a secure note here" by the error
text — `corpus_read_ai`, the batch probe, `update_note`, `assign_view`, all of
them. Combined with `rotli_status`'s absolute-path disclosure (O3) it makes
path-guessing an existence oracle over secure notes.

It is **not** a content leak: no title, snippet, body, or hash crosses — only the
one bit "something private is at this exact path you guessed." It is accepted as
low-severity and recorded rather than hidden, because closing it cleanly means
making every legitimate `not found` lie as `secure` (or vice-versa) across the
whole surface, which degrades honest errors everywhere to blunt one rarely-useful
guess. If O3 is fixed (ids and paths stop leaking to the headless agent), the
guessing input dries up and this loses most of its remaining value.

### O7 — the full-text index is a new at-rest asset (recorded, not a leak)

The Tantivy search index (`.rotli/search/`, design in
[`../design/tantivy-search.md`](../design/tantivy-search.md)) is a new place
secure-note content lives on disk: its inverted index holds the tokens **and
positions** of every indexed note, secure ones included, which makes a secure
note's vocabulary and word order substantially recoverable from the index files.
This is stated plainly rather than glossed. Three things bound it:

- **It is not an egress path.** `CorpusStore::search` is the user lane and
  returns secure hits as it always has; the only AI-facing search command,
  `corpus_search_ai`, re-applies `read_for_ai` **per hit in Rust** — reading the
  note's frontmatter from disk — before any hit crosses the boundary. The index
  changed how the candidate set is produced, not what the AI lane may keep. The
  index stores a `secure` classification bit for self-description, but it is
  **never the gate**: a stale or wrong bit cannot leak, because the verdict is
  re-derived from disk. Tested by
  `the_index_is_not_the_gate_a_stale_secure_bit_still_refuses_remotely` — a note
  secure on disk but flagged non-secure in the index still yields zero remote
  hits.
- **At rest** it inherits exactly the secure notes' protection (ROTLI_SECURITY
  rule 1: macOS account isolation + FileVault). It is DERIVED and rebuildable —
  deleting it loses nothing.
- **Gitignored + diagnostics-excluded.** It sits under `.rotli/`, which a vault
  `.gitignore` ignores as `.rotli/*` (the only un-ignore exceptions are
  `main.json` and `views.json`), so it is never committed, and it is not read by
  any support-bundle/diagnostics path — the same as the rest of `.rotli/` derived
  state (`index.json`, the journal, organizer state).

The **secure-prose ledger stays walk-fed and warm**: this change did not replace
the walk with index-driven listing. `corpus_list`, `tasks`, and
`warm_secure_ledger` still walk, and `search` still calls `ensure_walked` (which
feeds the ledger) before it touches the index, so the egress ledger cannot go
cold because search now uses an index.

### O5 — residual limits, by design

- **The ledger stops only bulk verbatim copying.** ≤4-word chunking, paraphrase,
  translation, reordering, and any encoding defeat it — by design; it is a layer
  over `read_for_ai`, not a covert-channel defense. Stated in full above.
- **Storage FILES carry no `secure:` flag**, so `read_file` has only the
  heuristic. Files are not notes and the matrix does not cover them.
- **DNS exfil**: `vetted_resolve` emits the lookup before vetting the address,
  so an encoded subdomain leaves over DNS even when the connection is then
  refused. Closing it needs a resolver that vets the NAME first — a real change
  to the fetch path, worth doing, not in this commit.
- **`brief_model` has no allowlist** (only a length bound), unlike every other
  model id in the codebase.

---

## Testing

Per-layer, deterministic, offline — `cargo test`, no live model.

- **Injection evals** — `src-tauri/src/injection_evals.rs`. These pay off a debt
  carried in the notes since 2026-07-24 ("secure organization still needs its own
  session with injection evals"). They keep slipping because an injection eval
  sounds like it needs a live model. It does not: the refusals are POLICY, not
  persuasion. So the eval grants the attacker everything — it assumes the
  injection worked *completely*, the model believed it, and the loop is now
  executing the injected instructions verbatim — and asserts the vault holds
  anyway. A hostile note tells the model to enumerate secure ids, read them,
  ship them to `https://audit.example/collect?data=…`, mail them via `open_url`,
  and stash them in an open note for the next session. All five steps are driven
  against the real gates. The target note is deliberately ORDINARY PROSE, so the
  regex detector proves nothing and only the matrix can pass the test.
- **Per-gate unit tests** — each fix above has one, driving the command with the
  arguments a compromised loop would use and asserting refusal: the walk-fed
  ledger vs. the frontmatter-stripped editor read, the tainted-chat read, the
  laundering refusal, the agent frontmatter surface, the revision oracle, the
  view-assign gate, `open_url`, the query cap, the organizer lane.
- **Parity** — `scripts/fixtures/parity.json` → `secureOverlap` pins the
  verbatim-phrase rule on BOTH sides (`src/lib/parity.test.ts`,
  `src-tauri/src/parity_tests.rs`), so the TS mirror and the Rust ledger cannot
  drift. One difference is deliberate and recorded there: TS normalizes NFKC and
  Rust has no std normalizer, so the fixture cases stay in NFC.
- **Mechanical guard** — `check:security` gained
  `rust.gatedEgressSites`: every function that puts caller-supplied text on a
  network must call `blocked_for_remote`. This is the class the audit found
  three times over (an outbound lane that bounded its DESTINATION and not its
  CONTENT), and nothing mechanical was catching it. Verified by removing a gate
  and watching the check fail.

## What did not change

No exclusion was weakened. Every refusal that existed before this audit still
refuses, and several now refuse in Rust that previously refused only in
TypeScript. The user's own lanes — the editor, ⌘K, the sidebar, Tasks, Quick
Look — are untouched: they are user surfaces, and the user may always see their
own notes.
