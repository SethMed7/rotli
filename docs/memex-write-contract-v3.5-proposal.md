# Proposal — memex write-contract v3.5: a `notes/` root + the app-plugin model

**Status:** STRAWMAN for Seth to redline. Authored from rotli (2026-06-25) against
smBrain `STRUCTURE.md` **v3.4**. Nothing here is ratified — once you redline, the
agreed version lands in `~/smBrain/STRUCTURE.md` (+ a `CHANGELOG.md` bump to v3.5)
and the `[[smbrain-integration]]` note; then rotli implements strictly against it.

---

## The one-line change

The memex is the home — **nothing writes outside it.** Today the contract sends
rotli's notes into `wiki/` (the curated, `[[linked]]` knowledge area). Add a
**separate, visible `notes/` root** for your everyday, *user-organized* notes —
distinct from the curated `wiki/` — and make the ownership map explicit for **all
apps** (rotli · Breve · voz), each writing only its own surface, reading the rest,
damaging nothing.

This is **additive**: v3.4's "two platforms, shared ground (ownership · reach · no
bleed)" already encodes the non-interference model — Breve owns `history/`, rotli
owns `chats/`, both read everything. v3.5 just adds a root and generalizes the map.

---

## 0. The two-layer model (the load-bearing idea — Seth, 2026-06-25)

**The memex is built for an AI.** It only works with a **local LLM** doing the
organizing — that's not optional, it's the engine. There are two layers:

- **User layer (loose, theirs).** The user works the way *they* think — a visible
  folder like `inbox/myela`, notes arranged however suits them. This is all they
  see and touch. rotli shows **meaning, not plumbing**: friendly labels, the user's
  own folders; the strict memex roots (`wiki/`, `self/`, `history/`) are never shown
  as raw names (e.g. Breve's `history/` appears as **"Breve"** — see §3).
- **AI layer (strict, hidden).** A **local LLM** reads every note and maintains the
  strict, retrievable structure in the background: it writes a **hidden section** on
  each note (its canonical place + an llmwiki-style `summary`/`tags`/`[[links]]`) and
  keeps `MAP.md` current. The user never authors this; the AI does. "The top part
  that defines files" = this hidden section.

So: **the human organizes for humans; the local AI organizes for AI — on the same
files.** rotli *inherits* this engine from smBrain (`organize.ts` deterministic MAP +
the enrich/`learn.ts` LLM step + `client.ts` context packs) — it doesn't rebuild it.
A note created in rotli triggers the local AI to fill its hidden section + index it.

> **Open fork (needs your call — §6.6):** does the hidden section mean the AI
> **physically files** the note into the strict tree (display path ≠ disk path, the
> hidden section maps them), or does the file **stay in the user's folder** and the
> hidden section just *records* its canonical role (a semantic overlay, so "what you
> see is where it is on disk")? The latter preserves "open it in any editor and it's
> exactly where rotli showed it"; the former gives a literally-strict disk tree.

---

## 1. The new logical root: `notes/`

| Resolver (proposed) | Primary path | Per-user? | Owner (write) |
|---|---|---|---|
| `notesPath(user?)` | `~/smBrain/notes` | yes — `userRoot(name)/notes` | **rotli** |

- **Visible + user-organized.** `notes/<your folders>/<slug>.md`. *You* make the
  folders and arrange them; rotli's sidebar shows them as-is. (Unlike `wiki/`,
  whose `projects/research/...` taxonomy is curation, not your daily filing.)
- **Note shape** — the `wiki/` shape, but `[[links]]` are optional (a working note
  needn't be a curated, cross-linked wiki note):
  ```
  ---
  summary: one line an LLM reads to decide relevance
  tags: [topic]
  updated: YYYY-MM-DD
  ---
  # Title
  …your note…
  ```
  **Local AI fills the frontmatter** (`summary`/`tags`/`updated`) so `organize.ts`
  indexes the note into `MAP.md` — "the top part that defines files" — while *you*
  own the folder organization and the body.
- **`wiki/` stays the curated layer.** Promoting a working `notes/` note into a
  curated `wiki/` note is a *choice* (exactly like "persisting a chat is a choice").
  rotli reads `wiki/` and can promote; it no longer has to dump every note there.
- **Lifecycle unchanged:** `inbox.md` (capture) → filed into `notes/` · `self/` ·
  `wiki/` · `history/` → `archive/` → `trash/`. `notes/` is just a new filing home.

> **Why `notes/` and not "into `wiki/`"?** Your words: "wiki has no meaning to the
> user." `wiki/` is a curated knowledge taxonomy; your everyday notes deserve a
> plain, visible home you arrange. Keeping them separate means rotli never has to
> force your quick notes into research/projects/etc., and `wiki/` stays curated.

---

## 2. The ownership / reach map (generalized to apps)

Supersedes v3.4's "Two platforms, shared ground." Same rule, more apps:

| App | Writes (owns) | Reads |
|---|---|---|
| **rotli** | `notes/` (your notes) · `chats/` (rotli's AI chats only) · `inbox.md` (captures) · may *promote* into `wiki/` | everything |
| **Breve** | `history/` (the by-day stream) · `inbox.md` | everything |
| **voz** | *proposed* `insights/` (personal voice insights) — see §4 | everything |

- **No bleed, enforced in code.** `scripts/conversations.ts` already rejects a write
  to the wrong surface. v3.5 adds the same guard for `notes/` (only rotli writes it)
  and `validate.ts` flags a foreign writer. **A tool can never damage another's data.**
- **`chats/` is for AI chats only.** Correcting my earlier mistake: notes do **not**
  go in `chats/`. `chats/` holds rotli's named AI conversations once that feature
  ships; everything else the user writes goes to `notes/` (or `inbox.md`).
- **Plugin independence.** rotli, Breve, voz each `connectApp()` additively into
  `memex.json`'s `apps` registry and `requireContract(3.5)`. Run one, two, or all —
  the structure guarantees isolation, so any subset works standalone.
- **Nothing outside the memex.** When a memex is connected, rotli writes ONLY into
  it (`notes/`/`chats/`/`inbox.md`). The local `~/Documents/rotli` corpus is the home
  **only** in standalone mode (no memex connected).

---

## 3. Breve-in-rotli (read the days, branch without breaking Breve)

You see Breve's `history/` **in rotli labeled "Breve"** (never the raw "history" —
the user reads *meaning*, not the folder name), as a by-day stream (a day-view UI,
slightly different from the note editor). You **don't participate** in those messages
— rotli reads `history/` (`recentDailies()`), never writes it (the v3.4 guard already
forbids it). But you can **branch a day**:

- **Take it into a conversation** → a `chats/<slug>.md` with `attachedTo:
  [[YYYY-MM-DD]]` (the day note is the object — "everything has a chat"). The day's
  `## Chat` backlink is kept in sync by `conversations.ts`. Breve is untouched.
- **Add a note linked to the day** → a `notes/` note with a `## Related [[YYYY-MM-DD]]`
  link. Your reflection on that day, in your area, pointing at Breve's day.

Either way: rotli **reads** Breve's stream and **writes its own** surface linked back.
Breve and rotli stay fully independent or work together — both just honor this map.

---

## 4. voz (its own surface; hidden-by-default in rotli; **`~/voz` must migrate**)

voz captures personal voice insights. It becomes a **memex app** like rotli/Breve:

- **Writes its own owned root** (strawman: `insights/`, or a voz-sourced daily under
  `history/` — TBD with voz's real shape), `connectApp("voz")`, never touches another
  app's surface; read by rotli + Breve.
- **`~/voz` exists today and writes ELSEWHERE — so it has to move to plug into the
  memex.** That's a cross-repo task in `~/voz` (resolve smBrain via a local config
  pointer like Breve/rotli; write through the contract). Until then voz isn't in the
  unified structure.
- **In rotli: hidden by default, with a Settings toggle to show it.** Most people read
  voz *in voz*, not rotli. The value of voz living in the memex is the **one unified
  structure**: the local AI learns who you are — how you speak, which tools you use —
  so its insights/organization get better. So rotli *can* surface voz (option on),
  but doesn't by default (option off).

**Still open:** voz's exact data shape — settle when we build the `~/voz` migration.

---

## 5. Versioning + enforcement (the deliberate, contract-correct part)

Per smBrain's local-first rule (no "push an update" — change deliberately + version):

1. `STRUCTURE.md`: add the `notes/` root + the generalized ownership map → **bump
   v3.4 → v3.5** + a dated `CHANGELOG.md` entry (the DOCS contract rule).
2. `scripts/mounts.ts`: add `notesPath(user?)`.
3. `scripts/conversations.ts` (or a sibling `notes.ts`): a `writeNote()`/`fileNote()`
   path that writes only `notes/`, atomic (temp+rename) + advisory-locked like the
   conversation writers; `validate.ts` flags a foreign writer in `notes/`.
4. `memex.json`: `apps` registry gains `voz`; `CONTRACT_VERSION` → `3.5`; rotli/Breve/
   voz `requireContract(3.5)` (fail loud on drift).
5. `[[smbrain-integration]]`: update the "Notes → `wiki/...`" row to "Notes →
   `notes/...` (promote to `wiki/`)" and the ownership section.
6. **rotli** then: when a memex is connected, write notes into `notesPath()` (not the
   local corpus, not `wiki/`, never `chats/`); add the Breve day-stream view + branch.
   Replaces the shipped "notes redirect to local Inbox / Vault read-only" interim.

**CARL rotli rule 4** ("rotli OWNS chats/, … wiki read-only") should be revised to:
rotli owns `notes/` + `chats/`, reads + may promote into `wiki/`, never `history/`.

---

## 6. Redline these (open questions)

1. **Root name:** `notes/` — good, or another word (`desk/`, `pages/`)?
2. **`notes/` ↔ `wiki/` promotion:** manual only, or an AI-suggested "this note is
   wiki-worthy"? (Persistence-is-a-choice precedent says manual + opt-in.)
3. **Standalone vs connected:** confirm — local `~/Documents/rotli` is used ONLY when
   no memex is connected; once connected, the memex is the sole home. (Or keep local
   as a scratch space that syncs in?)
4. **voz surface** (§4) — defer to when we build voz, or pin a placeholder now?
5. **Per-user:** notes/ resolves per partition (`userRoot(name)/notes`) like the rest
   — confirm rotli's UI exposes the active partition (`currentUser()`).
6. **The two-layer fork (§0):** AI **physically files** notes into the strict tree
   (display ≠ disk, hidden section maps them) — OR the file **stays in the user's
   folder** and the hidden section only *records* its canonical role (semantic overlay,
   "what you see is where it is on disk")? This is the biggest call.
7. **Local AI dependency:** memex mode needs a local LLM (the organizer). Use smBrain's
   inherited engine (`organize.ts` + the enrich step), and which model (a local
   open-weight one from `~/open-weight-models`, or `agy`/Gemini for enrich)? Is wiring
   that in-scope now, or assumed-present? And what's the graceful degrade if no local
   AI is available (hidden section best-effort? memex mode disabled?).
