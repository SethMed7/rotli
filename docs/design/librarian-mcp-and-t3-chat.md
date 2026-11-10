# The Librarian as an MCP route, and Rotli chat on T3 Code — simplification plan

Status: proposal, 2026-11-07. **Nothing in this plan is deleted yet.** Every
removal waits for the owner's approval of the table below. The first slice of
the Librarian route is built behind an off-by-default setting (see "Built in
this branch"), in **development builds only** (2026-11-09; see "Before this
route leaves development builds"). The shared protocol is
[`../architecture/vault-thread-protocol.md`](../architecture/vault-thread-protocol.md).

The owner, 2026-11-07: "the librarian … make that a MCP route that … really
needs to be dumbed down … powered by skills that know how to manage a vault in
LLM wiki manners with privacy and guards that should be simplified a lot. Then
users can turn it on if they want the brain to stay organized … if they want a
friendly way to view things in a notes-like manner, that's where rotli steps
in … guide rotli chat via t3 code … This means btw rotli and tesven become way
smaller and way more stable."

And, the same day: "Rotli, essentially, is an app. But also back end, any
essential skills that ensures that when you're taking notes, your memory, your
brain, all of those things, can fill in your brain by default … even the chat
mode when they're on a chat, all of those different things would then be
organized, so that everything by the end of the day remains theirs, rather than
to a provider."

## What Rotli is after this change

**An app and a backend.** The app is the friendly view. The backend is the
vault contract plus the Librarian's skills: the "brain" layer any agent (T3
threads, Tesven's Roo, Claude Code, Codex) uses, so notes, memory, and chats
land in the person's vault by default instead of staying in a provider's
history. Concretely, three things, and nothing that runs a model for chat:

1. **The notes view.** Editor, sidebar, Main and named views, boards, sheets,
   Word documents, search, graph, themes. The friendly way to read and write a
   vault, Obsidian-compatible.
2. **The vault data contract.** One folder is one vault; files are truth;
   `.rotli/` is rebuildable projection; secure and locked classification;
   Rotli's write path (`CorpusStore`) with its revisions, frontmatter
   ownership, and journals. Unchanged:
   [`memex-data-contract.md`](../architecture/memex-data-contract.md).
3. **The Librarian MCP.** An opt-in route (`rotli mcp --librarian`) any agent
   host can switch on: T3 Code threads, Tesven's Roo, Claude Code, Codex. Nine
   tools, five skills, four guards. It replaces the Librarian bar's and the
   organizer's own model calls as the way a vault "stays organized".

Chat becomes **T3 Code threads with the vault as their project**, shown in
Rotli's look (see "Rotli chat on T3"). T3 owns sessions, the provider (the
owner's own Claude Code subscription, unmodified binary), persistence, tool
calls, and approvals. Rotli stops shipping provider lanes, prompt loops, tool
schemas, chat persistence, and web search of its own.

## What shrinks

Measured 2026-11-07 on `dev` (b126eafc), tracked `.ts/.tsx/.rs` (and runtime
scripts for Breve), tests included. The repository holds 1,730 such files and
270,978 lines.

| # | Subsystem | Where | Files | Lines | Proposal | Risk |
|---|---|---|---:|---:|---|---|
| 1 | Chat engine: prompt loop, providers, tools, artifacts, streaming, web evidence | `src/ai/` (keep `guard.ts`, `editGate.ts`) | 67 | 11,236 | **Remove** once T3 chat ships | Medium: chat is a front of the app; Rotli Web has no T3 and loses chat |
| 2 | Chat UI, chat windows, note chat, chat memory, chat services | `src/components/chat*`, `src/noteChat`, `src/chatMemory`, `src/services/chat*`, `webChats*` | 79 | 10,378 | **Replace** with a thread list and transcript view over T3 (much smaller, ~2–3k est.) | Medium: most of Rotli's E2E chat specs retire with it |
| 3 | Rust chat stores and windows | `chat.rs`, `chat_registry.rs`, `chat_window.rs`, `memex_chat_scan.rs` | 4 | 1,156 | **Remove** (keep reading old `chats/` notes as plain Markdown) | Low |
| 4 | Provider lanes: Claude/ACP/Antigravity sessions, model catalogs, usage | `provider*.rs`, `claude_protocol.rs`, `claude_session.rs`, `acp*.rs`, `antigravity.rs`, `child_run.rs`, `usage*.rs` | 13 | 5,352 | **Remove** | Low: T3 owns these, better |
| 5 | Web search and page fetch for chat | `web_search.rs`, `web_page.rs`, `src/ai/webEvidence.ts`, `searchProvider.ts` | 4 | 1,230 | **Remove** (the host's own web tools) | Low |
| 6 | AI settings: connections, model pickers, chat settings | part of `src/components/settings/`, `antigravitySetup.tsx`, `webChatSetupDialog.tsx` | ~20 of 42 | ~1,800 of 3,590 | **Remove** the model parts; keep Librarian rules and visibility | Low |
| 7 | Librarian bar's own model call (`/librarian` bar and corner chat) | `src/services/librarian*`, `src/ai/librarianLane*`, `src/editor/*librarian*`, `src/lib/librarian*` (rules files excluded; `librarian_rules.rs` and `librarian_map.rs` stay) | 26 | 3,950 | **Freeze**, then shrink to "Open the Librarian in a thread" | Medium: the bar's apply/undo journal is good UX worth keeping |
| 8 | Inline AI and Hand to AI | `src/services/inlineAi*`, `src/ai/inlineAi*`, `handToAi*` | 9 | 1,660 | **Freeze**; later hand the passage to a T3 thread | Low |
| 9 | Remote relay (dev builds only) | `remote_agent*.rs`, `src/services/remoteAgent*`, `remoteAgentsSection.tsx`, `services/rotli-mcp-relay/` | 9 | 1,807 | **Remove**: Tesven's remote and T3 cover reaching the Mac | Low: never shipped to stable |
| 10 | Loopback HTTP MCP adapter (dev builds only) | part of `workspace.rs`, `loopback_http.rs` | ~2 | ~300 | **Freeze**; remove with #9 if nothing uses it | Low |
| 11 | On-device organizer daemon and its local model | `organizer*.rs`, `localmodel.rs`, `compute.rs` | 10 | 7,791 | **Freeze**; retire once the Librarian route proves out | Medium: it is on by default today and does real filing |
| 12 | Breve runtime, scheduler, and dashboard | `breve*.rs`, `routines.rs`, `src/routines`, `src/components/breve`, `breve-runtime/` | 134 | 19,337 | **Freeze**; owner decides whether briefings move to T3 scheduled threads or Tesven | High: it delivers the owner's daily briefings and the Signal assistant |

Totals (lines, approximate):

- **Approve #1–#6 and #9** (everything T3 replaces outright): about **32,000
  lines (≈12% of the codebase)** removed, plus about 7,000 lines of chat UI
  replaced by about 2,500. Net ≈ **−36,000**.
- **Add #7, #8, #10, #11** after the Librarian route proves out: a further
  ≈ **−13,700**.
- **Add #12** if Breve leaves Rotli: a further ≈ **−19,000**.
- All of it: ≈ **−68,700 lines, about a quarter of Rotli**, and with it every
  model-provider dependency, the Keychain entries for provider keys, and most
  of the egress surface the threat model has to defend.

What stays untouched: the corpus and write path, the workspace CLI and
`rotli-workspace` MCP, secure/locked policy (`secret.rs`, `ai_edit_policy.rs`,
the egress ledger), Librarian rules (secure keywords, People groups), the
editor, boards, sheets, documents, Rotli Web and its Helper, themes.

### Why this is safer, not only smaller

- The egress threat model today defends every Rotli-built model lane. After
  the change, the only path from a vault to a model is the Librarian or
  workspace MCP, both behind the same Rust read gate. One seam to audit.
- Provider churn (new models, CLI flags, ACP versions) stops being Rotli's
  release blocker. T3 absorbs it.
- The Librarian's behaviour moves from code to skills. Changing how it files
  is a Markdown edit, not a release.

### Order of removal (after approval)

1. Ship Rotli chat on T3 behind a setting next to the current chat.
2. Switch the default; keep the old chat one release as a fallback.
3. Delete #1–#6 and #9 in one PR per row, each with its tests and E2E specs,
   and the egress allowlist entries that go with them.
4. Re-measure, then decide #7, #8, #10–#12.

## The Librarian route, dumbed down

Owning code: `src-tauri/src/workspace_librarian.rs`. Skills:
`src-tauri/librarian-skills/*/SKILL.md` (compiled in, served by
`librarian_guide`). Contract: [`agent-workspace.md`](../architecture/agent-workspace.md#the-librarian-route).

### Tools (nine)

| Tool | Does | Writes? |
|---|---|---|
| `librarian_guide {skill?}` | Returns a skill's Markdown; no skill → `keep-the-wiki` | no |
| `librarian_search {query}` | Full-text search, secure notes omitted | no |
| `librarian_read {id}` | One note as untrusted Markdown + revision | no |
| `librarian_capture {title, body, source?}` | Raw source in: a new note in intake, logged | creates |
| `librarian_file {id, folder, reason}` | **Proposes** a move | proposal only |
| `librarian_link {id, target, reason}` | **Proposes** one `[[wikilink]]` | proposal only |
| `librarian_index {body}` | Rewrites the "Librarian index" page (its own) | its own page |
| `librarian_log {entry}` | Appends a dated line to "Librarian log" (its own) | its own page |
| `librarian_review` | Lists pending proposals so it never repeats one | no |

There is deliberately **no apply tool**. A person applies or dismisses a
proposal: `rotli librarian apply|dismiss ID` now, a review list in Rotli next.
No route tool approves a proposal, however the host's approvals are set. That
is not the same as "an agent cannot approve": `rotli librarian apply` is an
ordinary command, so an agent with a shell, directly or through a
pseudo-terminal, can run it. The person's approval holds only while the host
denies vault threads the shell and raw file tools (protocol §3.2), which Rotli
can't enforce for a host that ignores it.

### Skills (five)

`keep-the-wiki` (the method: raw → wiki → index → log, and the loop),
`capture-a-source`, `file-and-link`, `index-and-log`, `privacy-guards`. They
use Claude Code's skill format, so they can also be copied into a vault's
`.claude/skills/`; any MCP host gets them through `librarian_guide`.

### Guards (four, all existing seams)

1. **Secure notes never leave the Mac.** Every read and search goes through
   the remote read gate (`read_for_ai`): secure flag, secure folders, keyword
   names, the secret detector. Proposals need a readable note, so a secure
   note can't even be proposed. Reasons, sources and log lines pass
   `secret::blocked_for_remote`.
2. **No hand-written frontmatter.** Bodies starting with frontmatter are
   refused (`validate_editor_markdown`).
3. **Writes only through Rotli's write path.** Creates use
   `create_for_remote_agent`; page rewrites use
   `write_for_remote_agent_if_revision` (revision-checked, journaled, locked
   and person-written refusals); applied moves use `move_for_remote_agent`.
   Keeping the agent's *own* file tools off the vault is host config; see the
   protocol, §3.
4. **Proposals, not rewrites.** The Librarian creates notes and rewrites only
   its two pages. Applying a link to a note the person wrote still needs their
   "Let AI edit the text" grant, so the old "the Librarian never rewrites"
   holds even after approval.

What it no longer has, on purpose: its own model choice, prompt, JSON action
grammar, `anchors`, People/rule statements, a chat panel. The host's model
does the thinking; Rotli only holds the line.

### Works on any Obsidian-style vault

The route needs only a registered Rotli root: a Rotli vault (`wiki/_inbox`
intake) or any connected Markdown folder (`Inbox` intake). Index and log are
ordinary notes titled "Librarian index" and "Librarian log". Proposals live in
the vault's `.rotli/librarian/proposals.jsonl`, a deletable sidecar like the
AI edit journal. Nothing depends on the memex's `STRUCTURE.md`.

### Built in this branch

- `rotli mcp --librarian`: the stdio route, server name `rotli-librarian`.
  Each process serves one vault, bound at start: `--vault PATH`, else the
  folder it was started in, which must be a vault registered in Rotli with
  the Librarian on. It never follows Rotli's default vault (the first build
  did, so a thread in one vault could reach another; fixed after the
  2026-11-08 review).
  It runs in **development builds only**, like the full `rotli mcp` server
  and `rotli agent …`. It was first built to run in every build, because
  Tesven's controller found the owner's stable Rotli.app refuses `rotli mcp`.
  After the 2026-11-09 review the owner kept it in development builds (see
  below), so the stable app refuses it too, and `"librarianMcp": true` does
  nothing there.
- `rotli --version` (also `version`, `-V`) answers `{"version": …}` headlessly
  instead of launching the app, which hung for a host probing the binary.
- The switch: `"librarianMcp": true` in the vault's `.rotli/settings.json`,
  default off. Rust only reads it; the frontend already keeps unknown keys.
  **Not built yet:** the Settings → Librarian toggle that writes it.
- `rotli librarian status|proposals|apply|dismiss`.
- Tests: `src-tauri/src/workspace_librarian_tests.rs` (off by default,
  tool set has no approve, capture, secure omission, file and link proposals
  and their apply, person-written refusal, index and log; and from the
  2026-11-08 review: vault binding, symlinked proposals refused, review
  hides proposals on notes that turned secure, own pages by title and
  stamp, concurrent captures, and one gated read).

### Next slices (after approval)

1. Settings → Librarian: "Let agents keep this vault" toggle, and a Proposals
   list with Apply / Not now, reusing Librarian Activity's look.
2. `rotli agent config` prints the Librarian setup for a vault (the protocol's
   files), and `agent self-test` covers the route.
3. Retire the bar's model call (#7): `/librarian` opens a T3 thread on the
   vault with the Librarian route.
4. Chat capture: the `capture-a-chat` skill, `librarian_capture`'s `origin`
   field (T3 thread id and last turn), the `chats.jsonl` ledger, Rotli's copy
   step over `t3ctl`, and the scheduled distil thread (after the T3 pairing
   and protocol §8 are approved).

### Before this route leaves development builds

An independent review on 2026-11-09 found eight problems in the route, each
reproduced against a copy of the source. The owner's rule: **the route stays
in development builds, behind the same gate as the rest of `rotli mcp`
(`feature_policy::cli_gate`), until every finding below is fixed and an
independent review has checked the fixes.** No automated reviewer ran on that
pull request.

Fixed in 1.10.0, because shipped features reached them too (a second
independent review found the first fixes incomplete; both passes are in
docs/architecture/egress-threat-model.md, rows 16b–16f):

- **#1 Search showed bytes the gate never judged.** Every AI row (search,
  listing, folders) is built only from the one approved read, in the app,
  the `rotli notes` CLI, Rotli Web, and the route.
- **#4 Hard-linked notes crossed the vault boundary.** Every read of a vault
  file's contents by Rust code built for macOS goes through the checked open,
  and `check:vault-reads` fails the build on any other read outside five
  marked categories. One residual: the webview's asset path is checked by
  path just before the view reads it, not on the descriptor it reads
  (egress threat model row 16c).
- **#5 A move went ahead after the note was locked.** Every note mutation
  takes its lock through `lock_note` with an `Authority`, checked inside the
  lock.

Still open, reachable only through the route:

1. **#2 The index and log keep what a note said before it turned secure.**
   `librarian_index` and `librarian_log` store titles and summaries the agent
   wrote. When a note later turns secure, those lines stay in two public
   pages, and search returns them. The gate doesn't change that for pages
   the route already wrote: a vault used with a development build keeps its
   Librarian index and log as ordinary Markdown notes, which a public build
   lists, searches, and lets AI lanes read like any public note
   (`a_page_the_route_wrote_stays_an_ordinary_searchable_note`); the gate
   turns the route off and cleans nothing. Delete those pages by hand if they
   mention notes that are secure now. Fix: the route writes only note ids into
   its pages and renders titles at read time through the gate, or rescans its
   pages and drops lines about notes it may no longer read. Test: record a
   note in both pages, mark it secure, and search the index and log for its
   title and summary.
2. **#3 Repeating a proposal returns one review hides.** Deduplication in
   `propose` matches kind, note, folder, and target title, but not `targetId`
   or current visibility, so a repeated `librarian_link` hands back an old
   proposal (reason and target) that `librarian_review` would hide. Fix:
   deduplicate on `targetId`, and return an existing proposal only when
   `visible_pending` would show it. Test: link to A, make A secure, alias
   public B with A's title, repeat the link.
3. **#6 Consent follows copied or linked settings.** `enabled` reads
   `.rotli/settings.json` through symlinks, and a vault folder copied by hand
   keeps the switch. Fix: read the switch through the no-follow, single-link
   sidecar path, and tie it to the vault's identity, or reset it when a new
   folder is registered. Test: a settings symlink to another vault's enabled
   settings, and a hand-made copy of an enabled vault, both stay off.
4. **#7 Apply trusts the proposals file.** `decide` applies a link whose
   target has since turned secure, and builds `[[target]]` from the stored
   title, so an edited line can insert any Markdown. Proposals keep no source
   revision. Fix: re-resolve `targetId` through the gate, refuse a target
   that is no longer an exact readable title, validate stored fields as
   strictly as the tool arguments, and record and check the note's revision.
   Test: a secure target, an injected target line, and a note edited since
   the proposal; each refuses and stays pending.
5. **#8 The advertised tool limits aren't enforced.** The schemas say
   `maxLength` and `additionalProperties: false`, but `handle_mcp_with`
   doesn't validate arguments, so a 100,001-character capture and unknown
   arguments are accepted. Fix: validate every call against its tool's
   schema (lengths, types, required, no extra keys) before it runs, for both
   servers. Test: one over-length and one undeclared argument per tool.
6. **Approval relies on the host.** See "Tools (nine)": an agent with a
   shell can run `rotli librarian apply`. Before stable, either make the
   person's apply something an agent process can't do alone (the Rotli
   review list in Settings), or say so wherever the route is offered.

## Your chats land in your vault

The setting is **"Keep my chats and notes in my vault"**. Tesven's onboarding
offers it, on by default once Notes is chosen; Rotli offers the same switch in
Settings → Librarian. When it is on, the day's chat threads are captured the
LLM-wiki way: the conversation itself as a raw source, then a summary,
decisions, links to the people and projects it touched, and a log line.

### How capture gets the threads

Most chats are T3 Code threads. Three ways to get them:

| Option | How | For | Against |
|---|---|---|---|
| A. Read T3's history through its API | Rotli (through the shared `t3ctl` package) reads each thread's turns and writes them into the vault | Complete; deterministic; needs no model to copy | Rotli needs a T3 pairing; summarising still needs a model |
| B. A skill the agent runs at the end of a chat | `capture-a-chat`, called when the conversation winds down | The agent has full context; no re-reading | Chats rarely "end"; depends on the model remembering; misses threads that stop mid-way, and threads in other places |
| C. An end-of-day sweep | Once a day, catch up on every thread that moved | Covers everything; one predictable run | A day's delay; needs something scheduled |

**Recommendation: C, built from A's copy and B's skill, in two steps that
keep the copy and the model apart.**

1. **Copy (Rotli, no model).** At end of day, and when a thread has been idle
   for a while, Rotli's app reads every thread that moved in a captured place
   through T3's API and appends the new turns to that thread's transcript note
   in the vault. This is plain data: user and assistant messages, tool names
   with a one-line result each, and times. No model sees it on the way in.
   Rotli writes through its own write path. A transcript that holds
   secret-shaped text, or whose thread was marked secure, is written as a
   **secure note**: kept on the Mac and never summarised.
2. **Distil (a T3 thread with the Librarian's skills).** Then a scheduled T3
   thread in the vault's project runs the `capture-a-chat` skill over the
   day's new transcripts. Using only the Librarian tools, it does three things:
   - writes one summary note per thread with its decisions and open
     questions;
   - proposes links to existing people and project pages;
   - refreshes the index and logs what it did.

   Secure transcripts are refused by `librarian_read`, so they are never sent
   to a model. Rotli holds only a read pairing, so it does not launch this
   thread. It is a T3 scheduled task the person creates once, or Tesven's
   controller launches it at the same hour (Tesven already holds `operate`).

Why not the others alone:
- B on its own misses most chats.
- A on its own would need Rotli to summarise, and that is exactly the
  model-calling code this plan removes.
- Keeping the copy free of models means the vault gets the record even when
  no model is available or allowed.

The `capture-a-chat` skill is also offered as B's fast path. A chat can call
it while its context is fresh ("save this to my vault"). The sweep then skips
threads already distilled up to their latest turn.

### Which threads

- **On by default:** threads in the vault's own project.
- **No project (Tesven's `roo-home`): on, with tool results stripped.** Roo's
  tools serve work data: pull requests, work mail, team chat, and the work
  seat's limits. So a roo-home transcript keeps the person's and
  Roo's words and reduces each tool call to its name. No result line is kept,
  because even one-line results quote PR titles and message subjects. Assistant
  text that quotes a sealed message (Signal and the like) still lands in the
  vault. Settings says so plainly: "Messages you discussed with Roo are kept in
  your vault."
- **Off by default:** threads in every other T3 project (code repositories).
  The person turns them on per project. Work repositories can hold an
  employer's code and secrets, which must not flow into a personal vault
  unasked.
- **Excluded in code:** any thread on a work (Team) seat, whatever its
  place, until the owner decides otherwise. The seat is identified by its
  sign-in home (a separate Claude config home), mapped from each T3
  instance's `config.homePath`, never by an instance id, which is only a
  label (protocol §5b).
- **Capture starts from now.** Turning it on seeds the ledger with every
  existing thread's latest turn, so nothing old is copied. T3 holds 1,405
  threads and about 64,600 messages since May; the vault is 2.0 GB, and a full
  backfill could double it. Backfill is a separate, explicit action that shows
  a size estimate first. It is not in v1.
- The ledger `.rotli/librarian/chats.jsonl` records, per thread, the last turn
  copied and the last turn distilled, so re-runs and resumed threads only
  append, never duplicate.

### Where the notes go

- **The memex:** `chats/<slug>.md`, its existing chat-system lane
  (STRUCTURE.md: Rotli writes `chats/`; messages as
  `**speaker** · YYYY-MM-DD HH:MM — text` under `## Messages`). Its `source`
  values are `signal`, `rotli`, `claude`, `manual`. A T3 thread is written as
  `rotli` with the T3 thread id in its own field, unless the owner adds a `t3`
  source to the memex contract (a version bump there, the owner's call).
  Summaries go to the wiki like any capture.
- **Any other vault:** `Chats/YYYY-MM/<slug>.md` for transcripts; summaries
  through intake.
- Rotli's layout decides the folder (as `librarian_map.rs` does for areas), so
  skills never hard-code paths.

### The rules still hold

- **Proposals, not silent rewrites.** The pieces of capture are handled
  differently:
  - Transcripts are Rotli's own append-only copies of T3 data.
  - Summaries are new notes.
  - Links and moves that touch a person's pages are proposals.
  - The index and log are the Librarian's own pages.
- **Secure notes never go to a model.** The copy step uses no model; secure
  transcripts are refused at `librarian_read`.
- **Writes only through Rotli.** The copy uses Rotli's write path; the
  distil thread has only the Librarian tools (protocol §3).

### What "it remains yours" covers, and what it doesn't

Covered by the end of the day:
- the text of every captured conversation, a summary, its decisions, its links,
  and a log, all as plain Markdown files in the person's own folder;
- readable in any editor, searchable, and portable to any other app;
- no dependence on T3, Tesven, Rotli, or any provider to read them later.

Not covered:
- **Providers keep their own copies.** Anthropic (or another provider)
  receives every message at chat time and keeps it under its own retention
  policy. Capturing a chat doesn't delete it there, and making a transcript
  secure afterwards can't take back what the model already saw.
- **Local tool histories stay where they are.**
  - Claude Code keeps session logs in its config home (`~/.claude/projects/`,
    or the same folder under a second instance's own config home).
  - T3 keeps every thread in `~/.t3/userdata/statev2.sqlite`.
  - Tesven caches what it has read.

  T3 keeps its copy indefinitely (no retention found; 7.8 GB today). Claude
  Code prunes its logs after 30 days by default. Rotli reads these and never
  deletes them, and Settings says "T3 Code still keeps its own copy". Pruning
  T3 threads after capture would be T3's action, confirmed by the person; it
  is not in this plan.
- **Not in v1:** images and file attachments (a link to them is kept, not a
  copy); full tool output (one line per call only); thinking text; chats
  outside T3 (a phone's Claude app, claude.ai, ChatGPT).
- **Off-by-default places**: code threads stay out until the person turns
  their project on.

## Rotli chat on T3

Corrected 2026-11-07 by Tesven's architecture review (§2.2). An earlier
draft
said T3 had no thread CLI and ran only as the desktop app. Both were wrong.

### What T3 offers (v0.1.7, read from `t3 --help`)

- **Headless:** `t3 serve` (a server with no browser), `t3 service
  install|restart|uninstall|status` (a background LaunchAgent for this user),
  `t3 up` (remote access), `t3 doctor`. The desktop app is an optional UI over
  the same server. Whether a service install shares `~/.t3/userdata` and port
  3773 with the desktop app without fighting it is still to be confirmed.
- **A thread CLI:** `t3 thread list` (a project's threads, newest first),
  `t3 thread start` (prints the new id), `t3 thread send` (queued as the next
  turn, never interrupts), and `t3 thread show --messages N --json`.
- **Scoped pairing:** `t3 auth pairing create --scope … --ttl … --label …
  --json`, plus `list` and `revoke`. Scopes include `orchestration:read` and
  `orchestration:operate`, and `diagnostics:read` (usage and costs,
  `RpcAuthorization.ts` line 110). Pairings are made for at most 30 days.
- **The RPC:** `ws://127.0.0.1:3773/ws?orchestrationProtocol=2`, with
  `launchThread`, `dispatchCommand`, `subscribeThread`, and
  `getThreadProjection`. An incompatible protocol answers HTTP 426, and
  `/.well-known/t3/environment` reports the protocol and capabilities without
  auth. The RPC changes fast: 330 contract commits in 90 days, and 191
  methods today against 43 in May.

### Options

| Option | How | For | Against |
|---|---|---|---|
| A. T3's thread CLI | `t3 thread list/start/send/show --json` | Nothing to pair or hold; no WebSocket client; a person's action runs as that person | It appears to act with the local owner's full authority, not a scope (to confirm); `show` gives the latest messages, not turn items; JSON output has no version gate |
| B. T3's RPC directly from Rotli | Rotli's Rust holds a pairing and speaks the RPC | Full turn items; live updates; versioned (426) | Rotli writes a second client of a fast-moving API |
| C. Tesven's controller (`t3ctl`) as a shared package | Both apps use one package for the RPC's types, calls, and projection→timeline mapping | One client to keep up with T3; one contract test | The package has to be split out of Tesven |

### One T3, shared with Tesven

Rotli and Tesven use the **same single T3 Code install** on the Mac. Each is a
separately paired client of it, not a separate install.

- **AI sign-ins live in T3.** Connecting Claude (or Codex, or another
  provider) once in T3 serves Rotli's chats and Tesven's Roo alike. Rotli keeps
  no provider sign-in of its own, which is part of why rows #4 and #6 above
  can go.
- **Both apps recommend installing T3 Code.** Whichever app is set up first
  offers it. The other finds the running server on port 3773 and only asks
  for its own pairing.
- **The pairings are separate.** Rotli's is `orchestration:read`, labelled
  "Rotli (read)". Tesven's is `orchestration:read`, `orchestration:operate`,
  and `diagnostics:read`; Tesven creates it itself, once, after the person
  confirms, and likewise adds its own `roo` instance to T3's settings
  (protocol §5a). Each expires and is revoked on
  its own; revoking one never breaks the other.
- **Same threads, two views.** A vault thread started from Tesven shows up in
  Rotli's Chat front, and the reverse, because it is the same T3 thread. Only
  how it is drawn differs.

### Recommendation: read through C with a read-only pairing; act through A

Rotli is mostly a reader. It lists, shows, and copies threads. So it should
hold only a read credential.

- **Reading** (thread list, transcript view, live updates, the capture copy)
  goes through the shared `t3ctl` package, with a pairing scoped to
  **`orchestration:read`** only. The token lives in the Keychain and the
  socket opens from Rust, so no secret reaches the webview. Before
  connecting, Rotli probes `/.well-known/t3/environment`:
  - a protocol it doesn't know reads "T3 Code updated; update Rotli", not a
    pairing error;
  - a 426 says the same.
- **Acting** happens only when the person presses something: "New chat in
  this vault", sending a message, stopping a turn. These run `t3 thread
  start|send` as the person, so Rotli never stores an `operate` token.
  - If the CLI turns out to need a pairing of its own, Rotli asks for a
    separate short-lived operate pairing for that action rather than widening
    the stored one.
  - Approvals are answered in T3 (or Tesven) in v1.
- **Share `t3ctl` as a package, not through Tesven's hub.** Rotli is public and
  must work on a Mac without Tesven. If the package isn't split out when chat
  work starts, Rotli writes the same read calls in an adapter
  (`src-tauri/src/t3_threads.rs`) behind the same port, and adopts the package
  later.
- **One contract test.** The live contract test both apps run covers
  `getThreadProjection`, so the copier breaks loudly, not silently, when T3's
  shapes drift. Rotli targets T3's stable channel only.
- **If T3 isn't running**, Rotli says so and points to `t3 service install`.
  If T3 isn't installed, Rotli recommends installing T3 Code, the same one
  install Tesven uses. Rotli never bundles or starts its own copy.

### Pairing renewal

- Pairings last at most 30 days. Rotli shows the expiry in Settings → Chat and
  warns 7 days before.
- Re-pairing is the person's action. Rotli shows (and copies) the exact
  command, and the person runs it:
  `t3 auth pairing create --scope orchestration:read --ttl 30d --label "Rotli (read)" --json`.
  The person may also use T3's pair link. Rotli never mints a credential.
- An expired or revoked pairing pauses capture and the thread list. Nothing is
  lost: the ledger resumes from the last copied turn once Rotli is paired again.

Rotli's side is thin:

- **List:** threads whose project `workspaceRoot` is this vault's real path
  (protocol §4). Shown in the sidebar's Chat front in Rotli's look: title,
  status, last activity, provider.
- **Open:** a read-only transcript view of T3's turns, with tool calls as cards.
- **New chat:** "New chat in this vault" starts a thread in the vault's project
  in `approval-required`, on the vault-thread instance when the person has
  added it (protocol §3.3), after making sure §3.2's files are current.
- **Note chat:** "Chat about this note" puts the note's id and title in the
  first message. The agent reads the note through the MCP, so secure notes are
  still refused by Rust, not by the prompt.

Rotli Web has no T3. It keeps notes only; chat shows "Chat runs in T3 Code on
your Mac".

**Build waits for approval of this plan.**

## Decisions for the owner

1. **Approve the removals**: #1–#6 and #9 now (after T3 chat ships), and which
   of #7, #8, #10, #11, #12 to freeze or remove.
2. **Breve (#12)**: keep in Rotli frozen, move briefings to T3 scheduled
   threads, or move to Tesven.
3. **The organizer (#11)**: keep the on-device daemon as a no-network option,
   or retire it in favour of the Librarian route.
4. **The Librarian route in stable builds**: decided 2026-11-09. It stays in
   development builds until the findings in "Before this route leaves
   development builds" are fixed and reviewed.
5. **Memex vault config**: apply option A (the vault's `.mcp.json` and
   `.claude/settings.json`, and `"librarianMcp": true` in its
   `.rotli/settings.json`) and/or option B (a `vault-claude`
   instance in `~/.t3/userdata/settings.json`). Recommended: both. Nothing
   has been written to either.
6. **Chat client**: approve reading through the shared `t3ctl` package (#11 below for the access model), and where the shared
   package lives.
7. **Protocol home**: keep it in Rotli's docs, or move it to a small shared
   spec repo both apps vendor.
8. **Chat capture**: approve the two-step sweep (Rotli copies with no model,
   then a scheduled T3 thread distils). Also the default places: the vault
   on; No project on with tool results stripped; code projects off. And the
   hour it runs.
9. **The memex's chat `source`**: write T3 threads as `rotli` with a thread-id
   field, or add a `t3` source to the memex contract.
10. **Team-seat threads** (identified by their sign-in home): excluded in
    code by default. Say
    whether they are ever captured.
11. **Rotli's T3 access**: approve a read-only pairing (`orchestration:read`)
    plus person-initiated `t3 thread start|send` for actions, and who launches
    the daily distil (a T3 scheduled task the person creates; Tesven keeps
    its launch ceiling at `auto-accept-edits`, so it can't).
12. **Option B for vault threads**: add a `vault-claude` T3 provider
    instance with `--allowedTools` for the Librarian's read tools (or the
    whole route) and the write and shell deny list
    (`~/.t3/userdata/settings.json`, protocol §3.3). Without it, an
    `approval-required` vault thread asks for every Librarian call. The
    alternative is `full-access`, which was validated as safe.
