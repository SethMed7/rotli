# rotli — UI/UX mockups · round 6 — Chat module + the Memory — DECISION

**Date:** 2026-06-11 · **Gate:** `gate.html` (live render, kit tokens only; root pinned light)
**Input:** the maintainer's calls after the one-brain discussion: Wiki renamed **the Memory** (decided), and a new
**Chat module** to ship *before* the Memory.

## Decided this round (the maintainer)

- **Wiki → the Memory.** The corpus is the brain; modules are its fronts. Product psychology line:
  *one brain underneath — Notes writes it, Chat talks with it, the Memory recalls it.*
  ("Wiki / Karpathy LLM-wiki" stays as the internal architecture term in docs history.)

## Designed this round (pending gate)

1. **Chat module** (frame A) — "a chat version of opencode": the Inbox chassis carrying conversations.
   List pane = chats (model chip · linked-note tag · time); content = thread + composer. `/model` opens
   the model menu: bundled model first, Ollama auto-discovered, per-chat switching mid-thread. Reserved
   slash verbs: `/note` `/new` `/summarize`. Chats are tabs → split panes = several conversations at
   once. Transcripts live in `.rotli/chats/` (the r2 lock, now load-bearing). Models run in the
   background, summoned only when called — the breve law.
2. **Chat ⇄ note** (frame B) — tag a note into a chat (`/note` or drag): the note rides alongside;
   the model edits it **only on explicit instruction**; freshest edit on peach, fades to ground.
   "Start a new note from this chat" mints a note with the conclusion as its body. Either way:
   done talking, summary already written — the chat is scaffolding, the note is the artifact.
3. **⌘J ask-while-writing** (frame C) — small ask card at the caret inside Notes (hotkey ⌘J + a
   clay-deep spark at the end of the format bar, the only AI pixel at rest). One question deep;
   insert/discard; "Continue in Chat" escalates and auto-tags the note.
4. **New module order** (frame D): **Notes → Chat → Memory → Inbox → Voice → Board.**
   Rationale: Chat needs only the bundled model runtime + existing corpus locks; the Memory adds
   embeddings/RAG + citations and retroactively grounds Chat. Inbox (old phase 5) slides after the
   Memory. ⌃1–⌃6 reserved.

## Round-6 calls for the maintainer

1. Chat module chassis + /model + slash verbs — approve?
2. Chat ⇄ note loop (consent-only edits, two exits) — approve?
3. ⌘J + spark button — approve, or hotkey-only (zero AI pixels at rest)?
4. Lock the new order into ROADMAP (and re-letter the phases)?

## Verdict

**APPROVED — the maintainer, 2026-06-11 ("this is great, now let's lock in all of this").** All calls in this round are locked, including the phase-pill switcher variant, header-inline status, Proton-first order, the chat/voice designs, order v2, and pulling dictation into Notes v1.

**Addendum (same day):** the frame-D order is superseded — the maintainer promoted Voice ahead of the Memory as
well. Order v2 (Notes → Chat → Voice → Memory → Inbox → Board) is designed in
`../2026-06-11-ui-notes-mockups-r7/`.
