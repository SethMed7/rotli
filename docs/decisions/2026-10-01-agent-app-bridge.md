# Agents reach Word documents through the running app

**Date:** 2026-10-01 · **Status:** accepted; development builds (the agents gate)

## Context

The owner, 2026-10-01: "let's run the rotli mcp through the app … keeping in
mind a way for Grok bot / Claude Code etc. to have capability to talk to Rotli
with set actions and rules that respect the same rules in the app."

`rotli mcp` is a headless Rust process; Rotli's Word codec, its block model,
and the edit actions chat uses are TypeScript in the app's webview. The open
question in `docs/design/univer-ai-integration.md` (decision 2) was how an
agent reaches them: (A) a second codec in Rust, (B) a request/response bridge
through the running app, (C) a Bun sidecar. Nothing existed for an outside
process to ask the running app something and get an answer.

## Decision

1. **(B), for reads and writes.** Document tools (`rotli_read_document`,
   `rotli_apply_document`, `rotli_create_document`; `workspace_documents.rs`)
   travel to the running app, where the chat's own code does the work: one
   codec, one block numbering (an apply addresses the numbers the read gave),
   one action vocabulary and its limits (`src/documents/aiEdit.ts`; the 40
   actions, 8,000 characters, and 12 MB are pinned TS↔Rust in `parity.json`). Rotli
   must be running; a closed app is a clear error, never an auto-launch.
2. **One Rust entry, two paths.** `agent_bridge::ask_app`. Inside the app (the
   relay that carries a cloud client such as the Grok bot) it dispatches in
   process; a headless `rotli mcp` sends one JSON line over a Unix socket,
   `agent-bridge/bridge.sock` in the per-user app-support folder: bound inside
   a 0700 folder (private from the moment it exists, whatever the umask), then
   0600 itself, never inside a vault (which can be synced or shared). At most
   8 socket requests run at once. Both paths meet in `dispatch`. Stable builds
   open no socket. Until the main window says it listens
   (`agent_bridge_ready`), a request is refused at once rather than waiting.
3. **Rust enforces the rules, independently of the webview.** An agent counts
   as remote. Before the webview sees a request, Rust refuses another vault
   than the one open, writes to a read-only vault (the relay's flag or the
   development fallback), a document hidden from agents, named with a secure
   keyword, or holding secret-shaped text (`docx_text` + `blocked_for_remote`),
   an edit to a document no AI created, a new document named with a secure
   keyword, and an incomplete call (no file, no revision, no actions). After, every answer passes
   `blocked_for_remote` before it leaves, a refusal's own words included. The
   document's records are checked under the corpus lock; its contents (size,
   secret scan) are read outside it. Saves go through
   `corpus_write_file_ai` (grant, secret check, revision gate, `.bak`).
4. **The webview keeps its own checks too**: the action parser, the revision
   named by the read (a newer file is refused), a document open in a pane
   (it saves on its own), and its own secret check on what it answers.
5. **Agents have names.** `initialize`'s `clientInfo.name` (sanitized) rides
   each request; a document an agent creates is recorded in
   `.rotli/file-grants.json` as `createdBy: "agent"` with that name. Any AI's
   document is open to every AI, as notes are (`created_by`).

## Alternatives considered

- **(A) A Rust codec**: works with Rotli closed, but two codecs drift, and the
  block numbers an agent edits by would differ from chat's.
- **(C) A Bun sidecar**: development-only unless Bun ships with the app.
- **Loopback HTTP with a token file** (the Helper's pattern): works, but opens
  a port; a socket in a user-only folder needs no token and no port.

## Consequences

- An agent's document work needs the app open, and waits at most 30 s for it.
- An edit is refused while the document is open in a pane, until live-pane
  routing (design slice 4) applies agent actions to the open editor instead.
- Older Rotli builds read `createdBy: "agent"` as no grant: they fail closed.
- Same-user processes can reach the socket; that is the same boundary as the
  vault files themselves.

## Follow-ups (not built)

Per-agent policy hangs off the recorded name: an allowlist (which agents may
write), rate limits, and an activity log of what each agent changed. Sheets
take the same bridge (`rotli_read_sheet` / `rotli_apply_sheet`).

## Evidence

`agent_bridge.rs` tests (answers by id, timeouts, the vault and write rules,
the document gate on a real store, the egress check, the socket round trip),
`workspace_documents.rs` tests, `src/ai/agentRequests.test.ts`. The socket and
webview round trip in the Mac app is the owner's native check.

## Revisit triggers

Agents that must work with Rotli closed; a second app window that edits
documents; sheets or boards moving to the same bridge.
