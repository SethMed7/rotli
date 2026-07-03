# The Clean-up Room — guided, conversational triage

**Status:** DESIGN (Seth asked 2026-07-03). A new surface **above Brain** that sits you
down with the organizer and walks you through the notes it's unsure about, one question at
a time — so the memex stays tidy without you having to go hunting.

## The idea (Seth's words)
> "A clean-up room above Brain which asks me about files it's unsure of, or that haven't
> been touched in a while — should I delete or leave it, etc. A split view: chat on the
> left, list on the right, with questions, guiding me toward organizing and answering."

## Why it's a small build (rotli already has the parts)
- The **organizer daemon** already classifies every note and records **`area_confidence`**
  + `filed_by`/`filed_at` — so "notes I'm unsure about" is already a signal it computes.
- Notes carry **`updatedAt`** → staleness is free. Unfiled notes sit in **Captures**
  (`wiki/_inbox`) → "hasn't been sorted" is free.
- The **Activity journal** already logs organizer actions and supports **undo** — the
  Clean-up Room's actions ride the same journaled+undoable path.
- The **chat surface** + the **pluggable model transport** (0.24.3: local MLX or
  `claude -p`) already exist — the guide chat reuses them.
- The Breve **doctor** (orphans, broken `storage:` refs) folds in as one queue source.

So this is mostly a **new surface that assembles an existing queue** + a guide chat, not new
infrastructure.

## The surface
A content-area view (like All Notes / Activity), opened from a new sidebar row **above
Brain**: `🧹 Clean up (N)` with a count badge (N = items needing attention). Split:

- **Left — the guide chat.** The organizer asks ONE thing at a time, warm and specific:
  *"'Q3 scratch' hasn't been touched in 94 days and it's still sitting in Captures. Archive
  it, delete it, or file it to Projects?"* You answer in natural language **or** tap a quick
  action. It moves to the next item. It can also answer meta-questions ("why is this here?",
  "show me everything stale in Projects").
- **Right — the queue.** Each flagged note is a card: title · **why it's flagged** (stale /
  low-confidence / unfiled / orphan) · last-touched · **current location** (reusing the new
  location label) · quick actions: **Keep · Archive · Delete · File to ▸ · Skip**. The card
  the chat is currently asking about is highlighted; resolving it (chat or buttons) removes
  it and advances. A progress line: *"12 to review · 3 done · 2 skipped."*

Both halves act on the same queue — chat for guided flow, list for batch/skim. Every action
is journaled in Activity and **undoable**.

## What lands in the queue (the "needs attention" scan)
A pure ranking function over the note universe, each with a reason + suggested action:
1. **Stale & unfiled** — in Captures/`wiki/_inbox` and `updatedAt` older than *N* days
   (default 30) → "sort or drop?"
2. **Low-confidence filing** — `area_confidence` below a threshold → "did I file this right?"
   (offers the runner-up area).
3. **Stale in an area** — untouched > *M* days (default 120) → "still relevant? archive?"
4. **Orphans** — empty notes, notes with no `area`, broken `storage:` refs (the doctor
   check) → "fix or remove?"
5. *(later)* **Near-duplicates** — very similar title/body.

**Never surfaces:** locked notes, secure notes, or anything in **Main** (hands-off, same as
the organizer). The scan is read-only; nothing changes until you answer.

## Guardrails
- **Delete = Trash** (recoverable), never a hard delete. Archive = the Archive sink.
- Every resolution is one journaled entry (Activity) with **undo**.
- The guide chat runs on the **organizer model lane** (local by default; `claude -p` if you
  chose it). Secure/locked notes never reach it (same guarantee as the daemon).
- It only ever proposes for **location/metadata/lifecycle** — never edits your words.

## How it connects to the roadmap
This is the **human-in-the-loop** twin of the background organizer, and a rotli-native
version of Breve's doctor + Signal "save this / delete this" triage — so it's squarely on
the **Breve→rotli merge** path (`breve-merge.md`). It can also be a **Routine**: a scheduled
"time to tidy?" nudge that opens the room with a fresh queue (the routines scheduler from
Breve P0 is the substrate).

## Build sketch (phased, each ends green)
- **C0** — the pure **queue scanner** (`src/cleanup/scan.ts`): note universe + settings →
  ranked `CleanupItem[]` (`{ noteId, reason, suggestedAction, location, lastTouchedMs }`),
  with tests. No UI. (Confidence source: the daemon writes `area_confidence`; the scanner
  reads frontmatter.)
- **C1** — the **surface + sidebar row + count badge**; the **list** (right) with quick
  actions wired to the existing lifecycle/file/Main commands + Activity journal.
- **C2** — the **guide chat** (left) on the organizer lane: one-item-at-a-time prompting,
  natural-language answers mapped to actions, "next"/"skip" flow.
- **C3** — settings (stale thresholds N/M, confidence threshold) + an optional **Routine**
  ("weekly tidy nudge").

## Open decisions for Seth
1. **Name** — "Clean up", "Tidy", or "Review"? (row label + surface title)
2. **Delete semantics** — confirm **Delete → Trash (recoverable)**, never permanent, from
   this room?
3. **Default staleness** — 30 days for unfiled / 120 for filed a reasonable start (tunable)?
4. **Trigger** — always-available row with a live count (recommended), and/or a scheduled
   Routine that nudges you when the queue crosses a size?
