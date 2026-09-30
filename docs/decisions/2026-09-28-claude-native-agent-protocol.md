# Claude chat speaks Claude Code's native agent protocol

- Status: accepted
- Date: 2026-09-28
- Deciders: Seth Medina

## Context

A Claude chat turn ran as one `claude -p --safe-mode --tools ""` process per
loop step. Rotli wrote its tool protocol into the prompt ("reply with ONE JSON
object `{"thought", "tool", "args"}`"), parsed the reply text, ran the tool,
and replayed the whole scratchpad — including each step's `thought` as a
"REASONING CHECKPOINT" — into the next step's prompt.

On 2026-09-28 a plain request ("Review this link, then give me a prompt for an
X post") came back as Claude Code's raw `API Error: … safeguards flagged this
message … [reasoning_extraction]`. The same request answered normally through
T3 Code, which drives Claude through the official Agent SDK's control protocol
with native tool calls. The exact trigger could not be reproduced offline: the
same prompt wording passed the filter at step 1 and step 2 without the live
vault index. Two gaps were certain either way: Rotli showed the raw error, and
its `web_fetch` handed the model a JavaScript app's empty shell as if it were
the page.

## Decision

On the desktop, a Claude chat turn uses Claude Code's **stream-json control
protocol** — the one the official Agent SDK speaks — as a single process per
turn (`src-tauri/src/claude_session.rs`, `claude_protocol.rs`;
`src/ai/nativeLoop.ts`):

- Rotli's chat tools are an **in-process MCP server** named `rotli`, declared
  in `initialize` (`sdkMcpServers`) and answered over the same stdio. The model
  calls them as native tool calls; there is no JSON action protocol and no
  replayed reasoning in the prompt.
- Claude Code's own tools and ambient configuration stay off: `--tools ""`,
  `--safe-mode`, `--strict-mcp-config`, `--no-session-persistence`, and a
  scratch working directory. `--permission-prompt-tool stdio` sends every call
  to Rust, which allows only `mcp__rotli__<name>` for a tool this turn offered
  and denies everything else (no `--allowedTools` shortcut).
- The webview still executes each tool through the same Host and `runTool`,
  after the same guards as the JSON loop (allowed set, duplicate strike, step
  budget, `egressBlock`'s secret and private-prose checks, secure taint).
- Because a tool result no longer rides back inside a prompt that Rust
  rescans, Rust scans **each call's arguments and each result** with
  `blocked_for_remote` before the model sees it; a hit is withheld.
- A safety refusal — `assistant.stop_reason: "refusal"`, the
  `model_refusal_no_fallback` system event, or an `is_error` result carrying
  Claude Code's "safeguards flagged" text — ends the turn with one plain
  message that offers rewording or another model.
- Model and effort go through the one-shot lane's allowlisted
  `build_args_tuned`, so both transports accept exactly the same values.

A `@claude` consult is a Claude turn and takes the same path. Unchanged: image
turns, hybrid presets, auto-titles, note composition, the organizer,
Codex/Cursor/Antigravity, and Rotli Web (through Rotli Helper) keep the
one-shot `cli_complete` lane.

Separately, `web_fetch` now prefixes a page that is only a script-drawn shell
(under 400 characters of text next to a `<script>`) with a note saying so, and
that a `#/…` route never reached the server.

## Consequences

- One process per turn instead of per step; tool calls are structured, and the
  prompt is smaller (no protocol, no scratchpad).
- The per-result Rust scan replaces the whole-prompt rescan for this lane;
  `check:security` holds `claude_session_run` and `tool_call` as declared
  egress sites.
- The protocol is Claude Code's, not a published wire standard. The live
  round-trip test (`cargo test --lib live_round_trip -- --ignored`) is the
  check to run when the installed CLI updates.
- The classifier runs on input, so a native turn can still be refused. What is
  guaranteed is the plain message instead of the raw API error.
- Deferred: token streaming (`--include-partial-messages`), images on the
  native lane, Codex's `app-server` protocol, and a native clarification
  question (the model asks in prose).

Reopen if Anthropic changes the control protocol incompatibly, or if the
native lane's refusal or failure rate exceeds the one-shot lane's.
