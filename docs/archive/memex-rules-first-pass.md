# Memex rule-set — v2 (revised with the maintainer's redlines, 2026-06-25)

> **SUPERSEDED (2026-06-27) by the ratified v3.6 write contract.** This first-pass
> proposed rotli *itself* filing notes into `wiki/<area>/`. The shipped model is
> narrower: **rotli writes ONLY `wiki/_inbox/` (note staging), `chats/`, and `inbox.md`**;
> a later memex-side **local-LLM** classifies + files staged notes to `wiki/<area>/`.
> `self/` is now `identity/` + `personality/`. See `~/memex-vault/STRUCTURE.md` (v3.6)
> and CARL rotli rule 4. Read this for the organizing *ideas*, not the exact write boundary.

**The problem:** wiki-style organization is what an AI needs (parsable, linked,
summarized) but is *not* how a human naturally works. Closing that gap = the product.

**The resolution:** the **disk is the AI's strict structure** (navigable, parsable,
consistent no matter what plugs in); each client **renders a view that feels like the
user's own organization**; the user never feels the gap. Both are **projections over
one set of rule-governed files**. Placement is **rule-derived, never per-note declared.**

**Who does what** (memex-vault Configuration Rule #9 — *the brain makes no LLM calls*):
- **memex = a pure backend: structure + config + rules, nothing else.** `organize.ts`
  builds `MAP.md` from each note's `summary`; `validate.ts` enforces the contract. No LLM.
- **the client = the "app"** — rotli / breve / voz, **or even a Claude Code session
  writing into the memex** (then Claude is the plugin; no app at all). The client owns
  the **LLM and the logic to use it**, and the **UX**. A memex is only *usable* through
  some LLM-capable client.
- So: **clients store + reason; the memex rules + indexes; UIs project.**

---

## 1. The invariants the rules guarantee

1. **Stable + parsable on disk** — a fixed root skeleton + a bounded, config-defined
   sub-taxonomy. Nothing *invents* structure ad-hoc.
2. **Consistent across any plug-in** — one note contract (§3); a new client can't change
   the shape or break the layout.
3. **Non-damaging** — each client writes only its owned surface (§6), enforced.
4. **Projection-stable** — the user's view keys off `shelf`, not the disk path, so the AI
   filing/moving a note **never moves the user's folder view**. Zero felt tension.
5. **Rule-derived placement** — a note's home is a deterministic function of its metadata
   (§4); no `canonical:` pointer to drift or collide.
6. **Access-scoped** — no client (and no AI) can read/write outside the **logged-in
   user's catalog** (§8). The memex enforces reach, not trust.
7. **Never-delete** — nothing is hard-deleted; `trash/` + `archive/` only (§9).
8. **Local-first + versioned** — rule changes = `STRUCTURE.md` bump + `CHANGELOG` + a
   `validate.ts` check (the Configuration Rule).

---

## 2. The disk skeleton (AI-strict, bounded; top level is config/admin only)

**Top level holds ONLY config + admin/skeleton** — never user-arbitrary folders (those
break the contract). The fixed roots:

```
# — the structure (per partition; under multi-user, repeated as users/<name>/…) —
self/        identity layer (curated)
wiki/        the knowledge structure — organized notes live here, by AREA
history/     Breve's by-day stream      (shown in rotli as "Breve"; PRIVATE — §6)
chats/       AI chats                   (shareable — §6)
insights/    voz's voice insights       (shown in rotli only if toggled on)
inbox/       capture + fast staging (un-classified notes land here instantly)
MAP.md       always-loaded index (organize.ts builds it from summaries)
archive/  trash/   never-delete sinks (§9)

# — top-level config/admin ONLY (not user content) —
memex.json · users.json · memex.local.json · CONFIG.md · STRUCTURE.md · clients/ · scripts/
```

- **`wiki/` sub-taxonomy is CONFIG, not AI-freestyle.** Areas live in a config knob
  (`CONFIG.md` → `areas`; seed = today's `projects/ research/ reference/ people/
  theology/` — **confirmed seed, redline if you want different life-areas**). The LLM
  **classifies into an EXISTING area**; it never creates a folder; unclassifiable → it
  stays in `inbox/` (a valid state). Adding an area is a deliberate config change.

---

## 3. The note contract (one shape, every client)

Frontmatter = the **hidden section** (rotli already strips it — the user never sees it);
body = the human's note.

```yaml
---
# identity + provenance (the stable anchors)
id: 01J8…              # ULID — NEVER changes, even when filed/moved
owner: rotli           # rotli | breve | voz | claude | manual → ownership/non-bleed
created: 2026-06-25
updated: 2026-06-25

# AI metadata (the client's LOCAL LLM maintains it; drives placement + retrieval)
area: projects/northstar   # classification (a value from the config vocabulary) → §4 placement
summary: One line an LLM reads to decide relevance without opening the file.
tags: [northstar, payments]
links: [[elavon-integration]]

# USER metadata (what the human arranged; drives the view, §5)
shelf: [Northstar/Payments]   # the user's folder(s) — MULTI allowed → §5
reach: [seth]             # who can access this note → §7/§8 (default: just the owner-user)
---
# the user's note…
```

- **Required at rest:** `id`, `owner`, `created`/`updated`, `shelf`, `reach`. **AI-filled:**
  `area`, `summary`, `tags`, `links` (blank until the LLM runs — valid).
- `id` is the anchor: filing never changes it, so links + the user view + sharing survive.

---

## 4. Placement = rule-derived, with FAST staging (no felt delay)

```
home(note):
  if area set + in vocabulary →  wiki/<area>/<slug>-<id6>.md
  else (unclassified)         →  inbox/<slug>-<id6>.md
```

- **Write is instant.** A new rotli note lands in `inbox/` immediately (`shelf` + `id` +
  `reach` set, `area` blank) — **zero delay.** The local LLM then classifies it and the
  file is **filed** to `wiki/<area>/…` via `git mv`, async. The user's view never moves
  (it keys off `shelf`). This is your "for speed they write into staging, then the AI
  moves it into the wiki structure properly."
- No `canonical:` field. Re-classification just re-runs `home()` + `git mv`; `id`/links/
  `shelf`/`reach` untouched.

> **Redline #2 (still open):** auto-refile on every re-classification, or only on an
> explicit pass, so the disk doesn't churn under the user? (Lean: file once on first
> classify; re-file only on an explicit "reorganize.")

---

## 5. The projection (makes it feel like the user's own)

- rotli groups notes by **`shelf`** (the user's folders), not disk path — so you see
  `Northstar/Payments`, arrange it freely, and never feel the file lives in `wiki/…`. `shelf`
  is **multi**: a note can appear in several of your folders (tags-as-folders), and that
  same field is how a **shared** note reaches more places.
- rotli **hides all frontmatter** (already does). **Breve** → a row labeled **"Breve"**
  (day-stream over `history/`), never "history". **voz** → off by default, Settings toggle.
- Any future client is just another projection over the same files.

---

## 6. Ownership / non-bleed + per-surface privacy

| Surface | Owner (write) | Shareable? | Reads |
|---|---|---|---|
| `wiki/_inbox/` (note staging) | rotli | **yes** (multi-person) | everything in the user's catalog |
| `chats/` (AI chats) | rotli | **yes** | " |
| `history/` (day stream) | Breve | **NO — private** (ties to a phone number) | " |
| `insights/` | voz | per voz | " |

Enforced by `validate.ts` + the conversation/note writers (a foreign writer in a root it
doesn't own is flagged). `owner:` records origin. **Per CARL rotli rule 4 (v3.6):** rotli
writes ONLY `wiki/_inbox/` (staging) + `chats/` + `inbox.md`; the memex's local-LLM — not
rotli — files staged notes into `wiki/<area>/`. rotli never writes `history/`, `identity/`,
`personality/`, `MAP.md`, or the curated rest of `wiki/`.

---

## 7. Access · tenancy · sharing (single-person OR multi-person)

Builds directly on memex-vault v3.4 tenancy (`users.json` · roles · `accessMode` · per-user
partitions · "the app enforces who reaches which").

- **Two modes, both supported:**
  - **Single-person** — a private, local memex for one person (`accessMode: local`). No
    auth, no isolation needed.
  - **Multi-person** — the memex sits on a **shared backend** (a NAS / Proton Drive you
    back up to). Several people connect + write; `accessMode: open` (isolated, no auth) or
    `secure` (RBAC + step-up auth). Each person is a **partition** (`users/<name>/`),
    mutually isolated.
- **Roles** (`admin` | `member`): an **admin (you) can reach another partition to
  *debug*** — but not casually; members can't see each other. "For personal use I may
  want family not to see what I think, but I need access to debug their issues."
- **Who's logged in on rotli** = `currentUser()` (the active partition). rotli scopes
  **every** read/write/AI-action to that user so **data never splits or bleeds** across
  partitions. Switching user switches the whole scope.
- **Per-note sharing** = the note's `reach:` (users/roles who may access it). A private
  note → `reach: [seth]`; a shared note → `reach: [seth, alex]` (or a role/group). The
  app enforces; the AI obeys.
- **Real-time co-editing is deferred** — everything in one local home makes concurrency
  hard. That rides the existing **sync-design (Convex + CRDT)**, NOT this rule-set. We
  design **access control** now; **live multi-writer** later.

> **Redline #3 (new):** `reach:` granularity — per-user only, or also **roles/groups**
> (e.g. `reach: [family]`)? And the **login/active-user** UX in rotli (how you pick/switch
> who's logged in) — sketch now or defer with sync?

---

## 8. The user catalog (the rule the AI can't get past)

Your idea: a per-user **catalog = a table-of-contents of what that user can reach.**

- For the active `currentUser()`, the client builds a **catalog**: the set of
  partitions/roots/notes the user may read + write, derived deterministically from
  `users.json` (their role) + each note's `reach:`. (Admin's catalog includes others'
  partitions *flagged debug-only*.)
- **Every** client read, write, *and LLM prompt* is scoped to the catalog — the AI is
  only ever shown, and only ever writes, what's in it. It **cannot get past** it, because
  it never receives anything outside it. This is the hard boundary you asked for.
- The memex only *declares* the policy (`users.json` + `reach:`); the **client enforces**
  it by building + obeying the catalog (consistent with v3.4: "the app enforces who
  reaches which"). `validate.ts` can sanity-check a note's `reach:` against `users.json`.

> **Redline #4 (new):** is the catalog **computed live** (from `users.json` + `reach:`)
> or also **materialized** (a per-user `catalog.md` index the AI loads as its reach
> manifest)? Materialized doubles as the user's "what do I have" map.

---

## 9. Never-delete

Nothing is hard-deleted. `delete` → `git mv` into **`trash/`** (soft, purgeable);
`archive` → **`archive/`** (retired, kept). **Purge** (the real removal) is explicit +
rare. The `id` + `reach:` ride along, so a trashed/archived note is still access-scoped
and restorable. (Matches rotli's never-delete + memex-vault's lifecycle.)

---

## 10. Who runs the LLM, when (Rule #9)

- The **memex is deterministic** (`organize.ts`, `validate.ts`) — no LLM, ever.
- The **client runs the local LLM** (the organizer): on save (debounced) + a sweep of
  `inbox/`. Per note: classify (`area`), write `summary`/`tags`/`links`, file via
  `home()`. A **Claude Code session** can be that client too — it follows the same rules.
- **Degrade (no LLM):** the note waits in `inbox/` with `shelf`/`id`/`reach` set, fully
  usable; organization is **eventual**, never required to write.

> **Redline #5:** which local model does classify/summarize (open-weight from
> `~/open-weight-models`, or `agy`/Gemini enrich)? And — **is the LLM step in the first
> build, or do we ship structure + projection + access first** and let organization be
> manual / `/brain`-driven until the local LLM is wired?

---

## 11. Validation + versioning

Extend `validate.ts`: every note has `id`/`owner`/`shelf`/`reach`; `area` (if set) in the
vocabulary; placement matches `home()`; ownership/non-bleed; `reach:` resolves against
`users.json`; `[[links]]` resolve; never-delete (no file vanishes outside `trash/purge`).
Then `STRUCTURE.md` v3.4 → **v3.5** + a dated `CHANGELOG` entry + the checks.

---

## 12. Redline list v2

**Resolved by you:** notes → `wiki/` + fast staging (§4) · `shelf` multi (§5) · LLM in
the client incl. Claude Code (§10) · top-level config/admin-only + area seed (§2) ·
never-delete (§9) · per-surface privacy, Breve private (§6) · single + multi-person with
roles (§7).

**Still open:** auto-refile vs explicit (§4·R2) · `reach:` per-user vs roles/groups + the
rotli login UX (§7·R3) · catalog computed vs materialized (§8·R4) · local model + LLM-in-
first-build vs deferred (§10·R5) · the area vocabulary seed (§2) · `insights/` shape with
the `~/voz` migration.
