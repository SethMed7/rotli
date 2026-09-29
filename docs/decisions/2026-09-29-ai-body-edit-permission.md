# A note a person wrote is theirs: AI body edits need provenance or a grant

- Status: accepted
- Date: 2026-09-29
- Deciders: Seth Medina

## Context

Until now `locked` was the only edit control. Every other note a model could
read, it could rewrite: chat `update_note`, the per-turn chat-memory sync
(which wrote a "Conversation notes" section into the note a chat was attached
to), and the headless CLI/MCP `update`/`patch`/`rename`. Nothing recorded who
wrote a note: a note typed with ⌘N and one a chat created both carried
`owner: rotli`.

The owner asked for the Librarian to stay on metadata and for AI to change a
note's text only when the note's own metadata allows it. That allowance
depends on the rules the person sets and on whether the note began as a chat
or was written by the person. On 2026-09-29 the owner decided:

1. Every existing note counts as person-written. AI may not edit its body
   until the person grants it.
2. Filing may move the file into its area folder. It never changes the note's
   place in Main or its name there, and never touches its text.
3. With no grant, AI may edit only notes an AI made.
4. Chat memory for a person's note goes into its own chat-made note, not into
   theirs.

## Decision

1. Two Rotli-owned frontmatter keys, both `RESERVED` (never in the field
   editor) and `RAW_IMMUTABLE` (never forged through the raw metadata editor):
   - `created_by: chat | agent | librarian` is stamped once at creation: chat
     `create_note` and PDF sources, chat-memory notes, CLI/MCP `notes create`,
     and `/librarian` person notes. A person's notes carry no line.
   - `ai_edit: true | false` is the person's grant, written only by
     `corpus_set_ai_edit` from the note menu ("Let AI edit the text").
     Turning it off writes `false` rather than removing the line, so it sticks
     on an AI-made note.
2. One policy, `ai_edit_policy.rs`, with its TypeScript twin
   `src/lib/aiEditPolicy.ts`, pinned by `aiBodyEditCases` in
   `scripts/fixtures/parity.json`, decides in this order:
   - `locked` refuses;
   - otherwise the grant decides (a malformed value refuses);
   - otherwise only a known AI creator allows.

   Unknown and absent values fail closed.
3. Rust enforces the policy inside both AI body-write seams,
   `write_for_ai_if_revision` (chat and chat memory) and
   `write_for_remote_agent_if_revision` (CLI/MCP). TypeScript fails fast with
   the same words in `host.updateNote` and `updateNoteAsAi`. Rotli Web has no
   Rust gate, so it runs the twin on the web write path, fail-closed.
   `FrontmatterView.aiBodyEdit` carries the verdict to the UI.
4. When the chat's attached note is not AI-editable, chat memory reads that
   note's existing notes section and writes a chat-made note of its own. The
   chat file records it as `memoryNote: [[stem]]`, and `attachedTo` stays on
   the person's note. A memory note Rotli wrote before this rule has no
   provenance and is treated the same way. A shape check cannot tell Rotli's
   bullets from ones a person edited inside the section, and Rotli never
   recorded what it last wrote, so no older note is claimed.
5. Filing (`relocate`) writes every byte after the frontmatter fence
   unchanged. Main references Markdown notes by `id`, so a move never changes
   their place or name in Main.
6. Metadata is not a body edit. The Librarian's `AI_KEYS`, filing, and view
   tags stay governed by `locked`, `secure`, and the brain gate alone.

## Consequences

- An existing chat attached to a person's note, or to a memory note from
  before this rule, starts a new chat-made memory note on its next turn,
  seeded from the old note's notes section. The old note stays untouched.
- A chat or agent asked to rewrite a person's note gets a refusal that names
  the menu switch, and can create a new note instead.
- An older Rotli preserves both keys as unknown lines but does not enforce
  them (additive: it cannot make a note less safe than it was before).
- The desktop menu owns the grant. Rotli Web reads it but, like Lock, cannot
  toggle it yet.
