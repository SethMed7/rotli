# rotli — Main / Brain / Daemon Architecture (contract v3.7)

*Synthesis of four dimension designs. This is the decisive plan to approve before building. Conflicts between the dimensions are resolved inline and called out where the resolution matters.*

---

## Overview

rotli's notes layer becomes **two views over one set of files**. **Brain** is the canonical, AI-organized layer — the real `.md` files living in the memex `wiki/<area>/` folders (Projects · Research · People), maintained by a background local model. **Main** is the user's hand-arranged workspace sitting *above* Brain in the sidebar: it holds **no files of its own** — it is a view that references the same Brain notes by `id`, arranged into the user's own folders and order. Editing "Alazán 84" in Main or in Brain edits the one underlying file. A background **daemon** continuously files new captures into Brain areas and keeps each note's metadata (`area`/`summary`/`tags`/`links`) and the per-area overview notes fresh — reorganizing the canonical layer *underneath* while the Main view stays exactly as the user set it. The two views never collide because they ride **disjoint, separately-owned storage**: Main lives in a frontend manifest (`.rotli/`), Brain lives on disk, and the daemon can only touch disk.

```
                     ┌────────────────────────────────────────┐
  USER ARRANGES  →   │  MAIN   — hand-arranged view            │  ← .rotli/main.json
   (drag in left     │  Today · Active clients · Read later     │    (id-manifest; folders, membership,
    menu, 1 write)   │  (a tree of folders + note-id leaves)    │     order — frontend-owned, no .md files)
                     └──────────────────┬─────────────────────┘
                                        │ references notes by id only — survives any refile
                                        ▼  (one file, two views)
                     ┌────────────────────────────────────────┐
   AI ORGANIZES  →   │  BRAIN  — canonical, AI-organized        │  ← wiki/<area>/<slug>-<id6>.md
   (daemon, never    │  Projects · Research · People            │    (the real files on disk)
    deletes/rewrites)│  README (pinned, human) + _index.md/area │
                     └──────────────────┬─────────────────────┘
                                        │ same files; edits in either view hit the same .md
                                        ▼
                     ┌────────────────────────────────────────┐
                     │  DAEMON  — organizer.rs + local model    │
                     │  classify→file · enrich · refresh index  │
                     │  writes wiki/** ONLY via the Filer gate   │
                     └────────────────────────────────────────┘
```

Sidebar order top-to-bottom inside the Notes accordion: action rows (All notes · Captures · Recent) → **Main** (new section) → **Destinations**, now led by **Brain** (pinned README + the `wiki/<area>` tree) followed by Inbox · Storage · Board · Archive · Trash.

---

## 1. The link model — Main is an id-manifest, not a frontmatter field

**Decision: a single Main arrangement manifest** — an ordered, nested tree of Main-only folder nodes and note-`id` leaves, stored in `.rotli/main.json`, frontend-owned, referencing notes **by id, never by path, never by content**. This is the `link-model` Option (b), and it **overrides** the `metadata-contract` design's hybrid `main:` frontmatter proposal. **There is no `main:` frontmatter field.**

Why this resolution (the hybrid loses on the facts):

- **Empty folders are a core gesture.** "Make a folder, drag into it later" must work. A per-note `main:` field literally *cannot* represent a folder with no notes in it (`ensure_backing_folders` only synthesizes a folder a note points at, `corpus.rs:855-868`). A manifest node with `children: []` represents it natively.
- **A drag is one write, not N.** Reordering siblings with a per-note order key rewrites every note after the insertion point — N frontmatter round-trips, N git diffs, per drag. The manifest is the direct generalization of the shipped `captureOrder` precedent (`setCaptureOrder(ids)`, `BoardSurface.tsx:83`) from a flat list to a tree: one `setMain(tree)` write.
- **It ships without the contract bump.** Writing `main:` onto a `wiki/<area>` note hits the closed write gate (`NoteRO`, `corpus.rs:1153-1183`; `canWrite` false, `contract.ts:306`). A `.rotli/` manifest writes nothing into the corpus, so Main ships **fully decoupled** from the daemon and its v3.7 contract change.
- **It is immune to the daemon by construction.** The daemon `git mv`s a note's *path and filename* when it files it, but the contract guarantees `id` is preserved (`STRUCTURE.md:227-235`) and the index is keyed path-by-id (`corpus.rs:1553-1564`). Because Main references `id`, a Brain refile is *invisible* to Main — the note keeps its exact Main slot. This is precisely Seth's "Main stays how I set it while the AI organizes underneath," and only an id-manifest delivers it. A `main:` path field would break on every refile.
- **Stronger daemon isolation.** With no `main:` field in the corpus, the daemon's "never disturb Main" guarantee is *structural*, not a rule it must remember to honor — the daemon cannot write `.rotli/` at all (the watcher already ignores it, `corpus.rs:1044-1063`).
- **No watcher storm.** A Main drag touches only `.rotli/`, which `path_relevant` filters — no `corpus-changed`, no SuppressSet dance.

**"One file, two views."** The manifest stores only ids + tree structure — never a note's bytes. A note's content lives in exactly one `.md`. Both views resolve a row id → path via the single path-by-id index → the one file. Opening "Alazán 84" from Main and from Brain opens the same pane by the same id; edits in either view edit that one file. This is already how Brain works today; Main adds a second entry point, not a second file.

**Main-only folders** ("Today", "Read later") are folder nodes in the manifest, materialized at render as synthetic `Folder` rows with ids namespaced `main:<path>` — mirroring how `ensure_backing_folders` already invents folders with no backing directory and how the sidebar already routes by id namespace (`vault:`, `wiki/`).

**Rendering** reuses the Brain path almost verbatim via one new pure transform:

```
.rotli/main.json  →  folders: Folder[]       (id = "main:<path>", parentId chains the tree)
                     notes:   NoteSummary[]   (each referenced note, re-homed copy:
                                               folderId = "main:<path>", in manifest order)
```

Then `renderFolderTree("main:", mainNotes, 0, rowProps)` runs unchanged (`childrenOf` filters purely by `parentId`). **Roving-list parity:** prepend `...subtreeRows("main:", mainNotes)` to the flat `rows` array directly above the Brain line (`Sidebar.tsx:822-840`) so j/k stays in sync. **One new subtlety to build:** a Main note's id also appears in Brain, so it lands in `rows` twice — `rowProps`/focus must key off a **section-qualified row key** (namespace + id), not the bare id, or focus collides. Order is applied with `captureOrder`'s position-map sort, since the Brain `pinned→updated→id` sort is wrong for a hand-arranged view.

**Drag-and-drop** is the `BoardSurface` **pointer-drag** pattern generalized to a tree (5px threshold, `didDragRef` drag-vs-click, `elementFromPoint` + `closest("[data-main-id]")` hit-test), computing *before / after / into* a node and committing one `setMain(tree)`. **Do not** touch the sidebar's dead HTML5 `dropProps` (`Sidebar.tsx:574-596`) — that is the unreliable WKWebView `dataTransfer` path.

**Manifest shape** (`.rotli/main.json`):

```jsonc
{
  "version": 1,
  "tree": [
    { "folder": "Today", "children": [ { "note": "a1b2c3" }, { "note": "d4e5f6" } ] },
    { "folder": "Active clients", "children": [
        { "folder": "Alazán", "children": [ { "note": "g7h8i9" } ] },
        { "note": "j0k1l2" } ] },
    { "note": "m3n4o5" },                        // a top-level Main note
    { "folder": "Read later", "children": [] }   // empty folder is legal
  ]
}
```

Parse defensively like `parseSettings` (drop non-string ids, ignore unknown keys, never throw). Unknown/deleted ids render nothing (lazy GC on save) — the same `pos.get(id) ?? Infinity` tolerance `captureOrder` already uses. **Portability is an open decision (§6.1):** recommended to **commit** `.rotli/main.json` so the user's arrangement travels with the memex across machines, while it stays frontend-owned and contract-exempt.

---

## 2. The daemon — the Brain filer

**Where it runs — a Rust background worker inside the Tauri app (new `organizer.rs`).** This **overrides** the `safety-ux` design's "reuse `src/ai` loop.ts/host.ts in the webview." rotli is an always-running menu-bar `Accessory` app; background organizing belongs in the always-on Rust process, not the webview (which dies/pauses with UI, competes with rendering, and can't run with no window shown). The Rust side already holds everything in one place: the `CorpusStore` + id↔path index, the `SuppressSet`, the per-root watcher seam, and a dependency-free model client. **What we reuse is the model *transport*, not the ReAct *loop*** — the daemon's jobs are narrow, single-shot, structured-output calls with deterministic post-processing, not multi-step agentic reasoning. The `src/ai` loop stays exactly where it is, for interactive chat.

Shape: one `std::thread::spawn`'d worker (mirrors `spawn_watcher`) draining a job queue, managed as `OrganizerState(Mutex<…>)` next to `CorpusState`. Lift `messages_generate` (`chat.rs:240`) out from behind its `#[tauri::command]` into a plain `complete_local(messages, format_json, temperature, timeout) -> Result<String>` the worker calls directly.

**Cadence — event-driven off the watcher, gated, with a periodic backstop.** Extend the existing watcher closure (`lib.rs:760-762`) to also `organizer.enqueue(changed_ids)` — it already debounces 300ms, filters `.rotli/`/dotfiles/non-`.md`, and drops the daemon's own writes via the SuppressSet. Then three gates sit between event and model call:

1. **Per-note quiet period** (~45–60s, configurable) — a note being actively typed never gets filed under the cursor.
2. **Idle / foreground + power gate** — heavy model work runs only when the user is idle or rotli is backgrounded, **on AC by default** (battery policy is §6.3), and backs off when `NSProcessInfo.thermalState` is serious/critical (a 12B generation is a real thermal event on a laptop).
3. **Periodic reconciliation sweep** — on startup and a slow idle-on-AC cron, walk the corpus and enqueue anything whose content hash differs from last-processed (catches notes changed while the app was closed). A *diff* sweep, not re-process-everything.
   > **Shipped tighter (2026-07-01 energy audit):** the cron is gone. The sweep is fully event-driven — startup, **Run now**, a frontend Approve/Dismiss/Undo (whose suppress-marked writes never reach the watcher), and re-enabling trust each owe exactly one sweep (3s settle folds a spree into one walk). With nothing staged the worker **parks on the condvar** — zero wakeups (`plan_wait` in `organizer.rs`, test-locked).

This is **not a tight poll** — mostly "capture lands → settles → files," with a cheap safety net.

**The jobs** (all single-shot; skip any `locked:` note entirely; never use a web tool — model-local only, the `_inbox` holds real secrets):

- **Job A — Classify (`wiki/_inbox` → area).** Input: title + body + existing tags + the area vocabulary (with one-line descriptions). Output JSON `{ area: <one-of-vocab|none>, confidence }` constrained to the known area list, temp 0. If `confidence ≥ threshold` → **file it** (`file_note`, §3): fs-atomic move `_inbox/<file>` → `wiki/<area>/<slug>-<id6>.md`, set `area`, preserve `id/created/links/reach`, **do not bump `updated`**. Below threshold → leave in `_inbox`, set `suggested_area` + `area_confidence` so the UI offers one-click confirm. Never auto-file a guess.
- **Job B — Enrich.** One call → `{ summary, tags[], links[] }`. `links` are chosen from candidates produced **without the model** by `rankNotes` keyword scoring (logic ported/lifted from `tools.ts`) — the model only confirms/orders, keeping links grounded and cheap. Write each via `set_ai_field`, **only if missing or daemon-owned** (§3.5 — never clobber a user edit). Sort tags/links canonically so re-runs are byte-stable.
- **Job C — Refresh area overview.** When a member of area X is filed or its `summary` changes, regenerate `wiki/<X>/_index.md` **mostly deterministically**: enumerate members, pull their `summary` fields, render a canonical sorted table; the model writes at most a short cached prose intro, regenerated only when membership changes materially. Deterministic rendering = guaranteed fixed point, no thrash. **This is Seth's "edit Alazán 84 → Projects overview refreshes in the background"** — and because Main is an id-manifest in `.rotli/`, the Main view does not move while this happens.

**Model.** The chat default (`gemma-3-12b-it-qat-4bit`, MLX, `http://localhost:11435`, Ollama `/api/generate` shape), `format:"json"` + `temperature:0`. No new model, no second server. **Serialize and always yield to interactive work:** a daemon **permit = semaphore(1)** (never two model jobs at once); before each call, check an `interactive_busy` flag (set while a chat awaits `chat_messages`, cleared on return) and the idle gate — if a chat is in flight or the user is active, **defer** (requeue, don't call). The daemon is the citizen that steps aside. Use a **shorter timeout** than chat's 120s; "unreachable"/busy → requeue with exponential backoff. Prefer to drain the queue shortly *after* the user used the model (warm, resident); never pin MLX resident just for filing.

**Idempotency / convergence (breaks the write→watch→refile loop):** `.rotli/organizer.json` records per note `{ hash, area, lastFields:{summary,tags,links}, processedAt }` and per area `{ membersHash, builtAt }`. A job runs only when current hash ≠ last-processed. Fill a field only if empty **or** equal to what the daemon last wrote (else the user edited it → leave it). Compare-before-write (compose bytes; skip if identical to disk). Every write `suppress.mark`s its paths first. Deterministic outputs ⇒ "same input → same bytes → no-op."

---

## 3. Metadata + contract — v3.6 → v3.7

The daemon must write the one surface the contract closes (`wiki/<area>`). The change opens it for **exactly one new actor (the Filer) through a second, narrower gate**, while the **user's interactive write path stays byte-for-byte unchanged**. Thesis: **two actors, two gates, disjoint key-sets.** The User may write `chats/ _inbox/ inbox.md` and never the brain; the Filer may write the brain and never the user's arrangement. Neither reaches the other's territory.

### 3.1 The frontmatter schema

| Field | Owner | Gate today → v3.7 | Notes |
|---|---|---|---|
| `id` | Rust | RESERVED | ULID, immutable across filing |
| `created` / `updated` | Rust | RESERVED | **filing must NOT bump `updated`** (`corpus.rs:1725`) |
| `origin` | Rust | RESERVED | Archive/Trash restore breadcrumb |
| `pinned` | Rust | RESERVED | the note pin |
| `owner` | client at create | foreign → **promote to RESERVED** | provenance, immutable |
| `locked` | User | RESERVED, advisory → **hard Filer gate** | `true` ⇒ Filer must not read, annotate, or move it |
| `secure` | User/auto | RESERVED, gitignored | content never to a remote model; **never to *any* model in the daemon** (§4.2) |
| `area` | **Filer** | NoteRO foreign → **Filer-writable** | drives `home()` → the filing move |
| `summary` | **Filer** | NoteRO foreign → **Filer-writable** | one line; feeds `_index.md` + retrieval |
| `tags` / `links` | **Filer** | NoteRO foreign → **Filer-writable** | `[…]` / `[[…]]` |
| `suggested_area` | **Filer** | **NEW** | low-confidence staging hint; UI one-click confirm |
| `area_confidence` | **Filer** | **NEW** | `low\|med\|high` or 0–1 |
| `filed_by` / `filed_at` | **Filer** | **NEW** | `gemma-…` + timestamp; idempotent + auditable |
| `shelf` | User | foreign, untouched | existing Captures(Inbox)/Storage routing |
| `reach` | User | foreign, untouched | access scope; Filer inherits the catalog boundary |

**Net schema delta is small and purely additive:** `suggested_area`, `area_confidence`, `filed_by`, `filed_at`. Blank/absent is always valid. **There is no `main:` field** — Main lives in `.rotli/main.json` (§1). The Rust codec already preserves every non-owned line verbatim and in order (`compose_document`, `corpus.rs:728-747`), so non-rotli tools ignore the new lines.

### 3.2 The write-contract change — actor-scoped, not a blanket flip

`writable()` (`corpus.rs:1504-1520`) and `canWrite()` (`contract.ts:306-314`) stay **byte-identical** — the User lane's guarantees do not change, and every existing call site keeps its semantics. `surfaced()` stays unchanged: `wiki/**` remains `NoteRO`. `NoteRO` is **reinterpreted** as *"read-only for the User, writable for the Filer (subject to `locked`)."* Add a **second, parallel gate** the daemon's methods call:

```rust
fn filer_writable(&self, rel: &str, fm: &Frontmatter) -> Result<(), String> {
    if self.layout != Layout::Memex { return Err("the filer only runs on a memex".into()); }
    match surfaced(self.layout, rel) {
        Surface::NoteRW => Ok(()),                       // wiki/_inbox — source of a file move
        Surface::NoteRO if rel.starts_with("wiki/") => { // the curated brain — the filer's domain
            if locked_of(fm) { Err("note is locked — the filer must not touch it".into()) }
            else { Ok(()) }
        }
        _ => Err(format!("the filer may only write the brain (refused: {rel})")),
    }
}
```

Three **new Filer entry points**, each `suppress.mark`ing every path it touches:

1. **`file_note(id)`** — relocate per `area`: `_inbox/…` (or wrong area) → `wiki/<area>/<slug>-<id6>.md`. Shares `move_note`'s body but swaps the gate to `filer_writable` on **both** ends. **fs-atomic move** (temp+rename), preserves `id/created/links/reach`, does not bump `updated`. **No `git mv` shell-out** — git's rename detection handles history at commit; STRUCTURE.md's "git mv" describes the *effect*, not the mechanism (resolving the `daemon` vs `metadata-contract` split in favor of fs-move + commit, §4.4).
2. **`set_ai_field(id, key, value)`** — like `set_field` but **mirror-image gated**: accepts only `AI_KEYS = [area, summary, tags, links, suggested_area, area_confidence, filed_by, filed_at]`, refuses everything else. Combined with `set_field` refusing `RESERVED_KEYS`, the territories are disjoint: `{shelf, reach}` are writable by *neither* generic path (user's dedicated field-setter only); AI keys by the Filer only; reserved by Rust only.
3. **`write_index(area, body)`** — overwrite `wiki/<area>/_index.md`. The reserved `_index.md` name is the **only** file the Filer overwrites wholesale (deterministic name ⇒ never clobbers a user note).

**`locked` enforcement is TOCTOU-safe:** re-read the note's fresh frontmatter inside each Filer command (the user may lock between the classify-read and the write). Plus a soft rule: defer a note that is currently dirty/open in the editor.

### 3.3 TS mirror + versioning

`canWrite` stays byte-identical. Add the Filer's mirror beside it: `canFile(relPath)` (path gate — `wiki/_inbox/**` and `wiki/**` true, everything else false) + `mayFile(fm, areaVocab)` (locked / area-in-vocab / secure-index policy) + `AI_KEYS`/`USER_KEYS` constants + a new `Perms` tier `"chats+inbox+file"` that **only the daemon host runs with** (the editor keeps `"chats+inbox"`). Contract is mirrored-by-value, never imported — edit Rust, TS, and STRUCTURE.md in lockstep.

- `CONTRACT_VERSION "3.6" → "3.7"`; `MIN_CONTRACT` stays `"3.4"` (band `[3.4, 3.7]`).
- `STRUCTURE.md` → v3.7: add the four new fields; document `wiki/<area>/_index.md` as Filer-generated; **promote `locked` to a contract-level control flag** (any client's filer must skip it); annotate the ownership table `wiki/` write-owner = "Rotli **Filer** (via the rules)."
- **Do NOT flip `memex.json`'s stored `contract` to 3.7 yet.** A brain reading 3.6 is still in `[3.4, 3.7]` → fully writable, so **the Filer works against a 3.6 memex.json today.** Flipping the stored version would force every client with `MAX < 3.7` to open the brain read-only and silently break Breve's `history/` writes. The stored flip is a *later, coordinated* step after Breve+voz ship `MAX ≥ 3.7`. This decoupling is the key compatibility move.

**Compatibility with Breve/voz:** disjoint write surfaces (Breve owns `history/`, voz `insights/`, Filer `wiki/**`) → no write conflict. Purely additive fields → only required edit elsewhere is adding the four keys + `_index.md` recognition to `validate.ts`'s known-key set. Safe rollout: (1) bump every client's `MAX` to 3.7 + `validate.ts` keys (zero behavior change); (2) ship rotli's Filer; (3) optionally flip `memex.json` once all clients are ≥3.7.

### 3.4 The two README/index files

Resolving the `metadata-contract` vs `safety-ux` naming conflict:

- **`wiki/README.md`** — the **Brain's pinned, human-authored** trust README ("what the Brain is + its job"). **The daemon never touches it.** Pinned at the top of the Brain subtree, sorts first, can't be dragged into Main. Content in §4.7.
- **`wiki/<area>/_index.md`** — per-area, **daemon-generated** overview (leading underscore = generated convention, like `_inbox`). Surfaced read-only.

---

## 4. Safety / UX

**The trust promise (the one sentence everything serves):** *The daemon only ever adds, moves, or annotates inside the Brain — never deletes, never rewrites your words — everything it does is logged and reversible, and anything secret never enters the model or leaves your machine.*

### 4.1 Guardrails — the technical wall

- **The Filer lane (§3.2)** is a *separate, narrower* capability than user writes — the user lane stays closed to `wiki/**`, enforced by a test.
- **Closed verb set: add / move / annotate. No delete, no body-overwrite, anywhere in the daemon's code path.** A note's authored body is immutable to the daemon. "Summarize" goes in the `summary:` field or the area `_index.md`, never inside the note.
- **Field allowlist (`AI_KEYS`)** is the load-bearing guarantee behind "Main stays how I set it": the daemon writes `area` + the AI band, and is structurally unable to write Main (it isn't in the corpus) or `shelf`/`reach`/reserved fields.
- **`locked` is sacred** (skip read+annotate+move); **cooldown** — a note the user manually moved/edited in the last N minutes is off-limits; **idempotence + confidence floor** — refile only when proposed `area` differs *and* confidence ≥ threshold; **budgets** — max actions per run, backoff, idle-only.
- **No self-write storm** — every write `suppress.mark`s its paths before disk (`corpus.rs:1044-1063`).

### 4.2 The secret lane (highest stakes — live SSN/CC in `_inbox`)

1. **Detect before read** — trigger the existing secret detector (`read_frontmatter` auto-flags `secure:true` + gitignores, `corpus.rs:1313-1321`) on every candidate *first*.
2. **A `secure` note never enters a model — local or remote.** Harden the daemon path to refuse secure-to-*any*-model (stricter than `read_for_ai`'s remote-only refusal).
3. **Minimal-touch / surface to human:** the safer default is to **leave a secure capture in place** and surface it — *"2 captures look like they contain secrets (an SSN, a card number). I won't read or move these — review them yourself. [Open]"*
4. **Never auto-apply on a secure note**, even in Organize.
5. **Secure-into-index rule:** the Filer must never lift a secure note's `summary`/title into a non-gitignored `_index.md` — a secure note appears as a bare title-only row or is omitted.
6. `reach:` scoping is honored — the Filer's read/write set is intersected with each note's reach.

### 4.3 Trust ladder (default + how the user climbs)

A single Settings control, **monotonic in risk**. **Default: Suggest** (this resolves the `daemon` "default fully-automatic" vs `safety-ux` "default Suggest" conflict — see §6.2; the daemon is *always running and always classifying in the background*, the ladder governs only whether it auto-*applies*).

| Level | Auto-applies | Proposes | For |
|---|---|---|---|
| **Off** | nothing (dormant) | nothing | "leave my notes alone" |
| **Suggest** *(default)* | nothing | everything | first run / skeptics |
| **Tidy** | annotations + filing brand-new `_inbox` captures (no placement to disturb) | re-filing already-placed notes, index rewrites | steady state |
| **Organize** | everything, fully journaled + reversible | nothing | "keep it clean" |

The only things that auto-apply before a human looks are **pure additive annotation** and **filing a homeless `_inbox` capture** — both non-disorienting. The two genuinely jarring actions (re-homing a note the user has *seen* in a place; rewriting an index) stay in review until the user opts into Organize. **Earned-trust nudge:** after ~10 approved proposals with 0 undos, a one-time dismissible *"You've approved 12 suggestions and undone 0. Want it to tidy on its own? [Let it tidy] [Stay in review]"* — converting demonstrated trust into a setting rather than asking up front.

### 4.4 Visibility — the activity journal

`.rotli/brain-journal.jsonl` (frontend-owned), each record `{ id, ts, action, noteId, noteTitle, before, after, model, confidence, status: proposed|applied|reverted|dismissed, gitSha }`. Three quiet surfaces:

1. **Per-note chip** in `MetaPanel.tsx` — *"🧠 Filed by AI · Projects · 2h ago"* with inline **[Undo]** and **[Lock to stop AI]** (flips `locked:true` — opt a note out forever).
2. **Sidebar badge** on the Brain label — *"Brain · 3"* unreviewed proposals, or a brief *"filed 3"* pulse after an auto run. No modal, no focus-stealing toast.
3. **Brain Activity pane** (new `surfaceKind:"activity"`, opened from the README or badge) — run summaries, reverse-chron journal grouped by run (each row = the diff + confidence + [Open] [Undo]), pending proposals at top with [Accept] [Edit] [Reject] [Accept all from this run], filters (by area/action, "only moves," "needs your call").

### 4.5 Review (quarantine) + 4.6 Undo

**Quarantine:** proposals never touch disk — the daemon computes the *decision* (a journal record `status:"proposed"`) and writes nothing. Approve → apply (write + suppress + journal `applied` + sha). Reject → `dismissed`. Edit → user tweaks the target, applies their version (daemon learns via cooldown). Zero risk window. An **index** proposal carries the full proposed `_index.md` for a side-by-side diff.

**Undo, three radii** — the journal's `before`/`after` is the **primary** mechanism (works in any corpus, no git dependency): (1) undo one action (restore `before` fields, or `git mv` back); (2) undo a run; (3) "Reset Brain to how I had it on `<date>`." When the corpus *is* a git repo (memex-vault is), each applied daemon action is **additionally** committed path-scoped by a dedicated author `rotli-brain <brain@rotli.local>` (with `Note-Id`/`Rotli-Daemon` trailers) — giving a `git log --author=rotli-brain` audit trail and `git revert` as a second undo path. The daemon commits **only the specific paths it touched** (never `git add -A`), so uncommitted user edits are never swept in. *(Whether rotli auto-commits at all is §6.5.)*

### 4.7 The Brain README (pinned, human-authored, daemon never edits)

Pinned at the top of the Brain subtree (synthesized pinned row, `ensure_backing_folders`-style; opens `wiki/README.md`). It is the trust artifact — it tells the user the daemon exists, what it *can't* do, and where the controls are, *before* they discover an AI moved a file:

> ## This is your Brain
> Your notes live here, sorted into areas — **Projects, Research, People** — so you can always find them. Just capture; things land here.
>
> **A small AI on *your Mac* keeps it organized** — it files new notes into the right area, writes a one-line summary, suggests tags, and keeps each area's overview current. On-device, in the background.
>
> - It **never deletes** anything and **never rewrites what you wrote** — only files, tags, summarizes.
> - It **can't see your secrets** — notes with passwords, cards, or IDs are flagged and left untouched.
> - **Everything it does is logged and reversible.** Open **Activity** to see it and undo any of it.
> - Your **Main** view stays exactly how you arranged it — the AI organizes underneath, your shortcuts on top.
>
> More or less help? **Settings → Brain.** Want a note left alone? Open it and hit **🔒 Lock**.

### 4.8 Controls + degradation

**Settings → Brain:** the 4-level radio (doubles as on/off) · capability checkboxes (File captures · Write summaries · Suggest tags · Link related · *Re-file existing* (off by default) · Keep overviews current) · areas it may touch · "Never touches: locked · secure · your Main arrangement" · **Model: Local only — never the internet, can't read secrets** (reassurance as copy) · **Pause** (1h / today / until I resume, also in the menu-bar dropdown) · [View activity] · [Reset Brain…]. Persisted next to `captureOrder`/`expandedDests`.

**Degradation (model may be down):** queue, never block — watcher events accumulate as candidates while `:11435` is offline (errors are already graceful, `chat.rs:64`); show don't nag (*"Paused — local model offline. 4 captures waiting."*); resume cleanly under the same budgets; re-evaluate (don't apply a stale decision) if the user edited a note between proposal and apply. Atomic temp+rename means a crash/quit mid-op leaves either the clean before-state or a clean after-state, never a torn file; the queue rebuilds from hash state + startup sweep; every job is idempotent.

---

## 5. Phased build plan

Ordered to ship value early and de-risk the daemon last. **Main (Phase 1) is independently shippable with no contract change. The daemon is the riskiest piece, so the capability + the see/review/undo loop land before any automation.**

**Phase 1 — Main view (no contract change, ships alone)**
- Move Brain into Destinations; add the pinned, human-authored `wiki/README.md` row (synthesized, sorts first, not draggable into Main).
- New `SEC_MAIN` section above Brain; `.rotli/main.json` + defensive parser; the `manifest → Folder[]/NoteSummary[]` transform; `renderFolderTree("main:")`.
- `rows`/`subtreeRows` parity + **section-qualified row keys** (the one new roving subtlety).
- Pointer-drag reorder (BoardSurface pattern) → one `setMain(tree)` write; empty-folder create; orphan-id GC on save.

**Phase 2 — Contract v3.7 + Filer gate (capability only, no daemon yet)**
- `filer_writable` + `set_ai_field` (`AI_KEYS`) + `file_note` (fs-atomic move) + `write_index` in `corpus.rs`; `canFile`/`mayFile`/`AI_KEYS`/new `Perms` tier in `contract.ts`; `STRUCTURE.md` → v3.7 (+ `locked` promotion, `owner`→RESERVED).
- A **test asserting the user lane stays closed** to `wiki/**` and the Filer allowlist refuses non-AI keys.
- Bump Breve/voz `MAX` to 3.7 + `validate.ts` known-keys. **Do not flip `memex.json`.**

**Phase 3 — Journal + Activity + manual "file this note"**
- `.rotli/brain-journal.jsonl`; Activity pane (`surfaceKind:"activity"`); per-note AI chip + [Undo] + [Lock to stop AI] in `MetaPanel.tsx`; sidebar badge.
- A **manual** "Suggest area / File this note" action that drives the Filer gate end-to-end. Undo (journal `before`/`after`, + optional git commit per §6.5). **Proves see/review/undo against real writes before anything is automatic.**

**Phase 4 — Suggest daemon (ships as the default posture)**
- `organizer.rs` worker + queue + `.rotli/organizer.json` hash state; lift `complete_local` from `chat.rs`; extend the watcher closure to `enqueue`.
- Quiet/idle/AC/thermal gates; semaphore(1) + `interactive_busy` defer; short timeout + backoff.
- Classify + Enrich jobs **propose-only** into the journal; `rankNotes` link-candidate generation; secure detection + `locked`/cooldown skip; offline degradation. **Default = Suggest.**

**Phase 5 — Auto-apply (Tidy/Organize) + index + earned trust**
- Flip annotate + homeless-capture filing to auto-apply under Tidy; deterministic `_index.md` regen (RefreshIndex job) — Seth's Projects-overview example; Organize full-auto.
- Earned-trust nudge; global "Reset Brain"; the Settings ladder UI; battery/thermal/budget polish.

---

## 6. Open decisions for Seth

1. **Main manifest: committed (portable) or gitignored (per-machine)?** *Recommend committed* — Main *is* the user's durable hand-organization; it should survive a machine move with the memex. It stays frontend-owned and contract-exempt either way; committing just un-gitignores `.rotli/main.json`. (Cost: `.rotli/` becomes partly-committed, a new pattern alongside the per-machine `settings.json`.)

2. **Default trust level: Suggest or Tidy?** *Recommend ship Suggest as the product default* (safe first impression on real data with live secrets), and **you flip yourself to Tidy on day one** — you're the developer, it's your vault, and the daemon is always classifying in the background regardless. This honors your "always-running, auto-organizing" vision while keeping the first auto-*write* earned for everyone else.

3. **On-battery policy: off / small budget / full?** *Recommend off on battery* (model work only on AC + idle), configurable. A menu-bar app should be thermally invisible; a 12B generation on battery is felt.

4. **Confidence threshold + low-confidence behavior.** *Recommend below-threshold notes stay in `_inbox`* with `suggested_area` + `area_confidence` set and surfaced as "needs your call" (one-click confirm) — never auto-filed to a guess. You set the numeric threshold.

5. **Does rotli auto-commit the daemon's actions to git?** *Recommend yes, when the corpus is a git repo* — each applied daemon action becomes one path-scoped commit by `rotli-brain`, giving a real audit trail + `git revert` undo. The journal is the primary undo so it degrades gracefully in a non-git corpus. (Fork: if you'd rather rotli *never* writes commits and keeps all commits manual, undo falls back to journal-only — still complete, just no git audit log.)

6. **fs-atomic move vs literal `git mv` for filing.** *Recommend fs-move + git rename detection* (no shell-out) — simpler, atomic, and git still records the rename at commit. Confirm this satisfies your read of STRUCTURE.md's "filing is a `git mv`" (we treat it as describing the effect, not the mechanism).

---

*Resolved conflicts of record: (a) Main link model — **pure id-manifest**, not the hybrid `main:` frontmatter field (empty folders + one-write + daemon-immunity are decisive); (b) daemon home — **Rust `organizer.rs`**, reusing the model transport not the webview ReAct loop; (c) filing mechanism — **fs-atomic move + commit**, not `git mv` shell-out; (d) Brain README — **human-authored `wiki/README.md`** (daemon never touches) + daemon-generated per-area `_index.md`; (e) default posture — **Suggest ladder**, with the daemon always classifying and Seth free to run Tidy immediately.*