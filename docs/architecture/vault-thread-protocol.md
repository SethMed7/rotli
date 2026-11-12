# Vault threads protocol — v1 (draft)

Status: draft for the owner's approval, 2026-11-07. Followed by **Rotli** and
**Tesven**. Rotli owns this file until the owner picks a shared home (see the
end). Plan and rationale:
[`../design/librarian-mcp-and-t3-chat.md`](../design/librarian-mcp-and-t3-chat.md).

Keywords MUST, SHOULD, MAY are used in their RFC 2119 sense.

## 0. Terms

- **T3** — T3 Code, the local server and desktop app that owns AI threads:
  sessions, provider, persistence, tool calls, approvals. **One install per
  Mac, shared:** Rotli and Tesven are two separately paired clients of the same
  T3, never two installs (§5a).
- **Thread** — one T3 thread. Every AI chat in Rotli and Tesven is a thread.
- **Vault** — a folder of Markdown notes: a Rotli vault (`memex.json` marker)
  or any Obsidian-style folder registered in Rotli.
- **Place** — where a thread lives: **no project**, or **a vault**.
- **Host app** — Rotli or Tesven, whichever starts or shows the thread.
- **Librarian route** — the opt-in MCP server `rotli-librarian`
  (`rotli mcp --librarian`, development builds only, opt-in per vault), contract in
  [`agent-workspace.md`](agent-workspace.md#the-librarian-route).

## 1. Versioning

- This is `vault-threads/1`. Additive changes (new optional fields, new
  optional files) keep `1`. Anything that changes what a v1 reader does bumps
  to `2`.
- A host app that sets a vault up for threads MUST write
  `<vault>/.rotli/agent-host.json`:

  ```json
  {
    "protocol": "vault-threads/1",
    "librarian": true,
    "wrote": {
      "created": [".mcp.json", ".claude/settings.json"],
      "changed": [
        {
          "path": ".gitignore",
          "backup": ".rotli/agent-host/backup/.gitignore",
          "revision": "sha256:…"
        }
      ]
    },
    "updatedAt": "2026-11-07T15:04:05Z"
  }
  ```

  `wrote.created` lists the files that did not exist until the host made
  them. `wrote.changed` lists files that already existed and that the host
  edited: before its first edit the host copies the original to `backup`
  (under `.rotli/agent-host/backup/`), and `revision` is the hash of the file
  as the host left it. Turning the setup off (§3.6) deletes only `created`
  files and restores, never deletes, `changed` ones. A file the host found
  already there is always `changed`, even if the host replaced all of it. A reader
  that finds a higher major version MUST treat the vault as set up by a newer
  app: show its threads, change none of its files.
- `.rotli/` is local to this Mac and never committed, which is where this
  record belongs.
- **Draft changes within v1** (no host had shipped option A or B yet):
  - 2026-11-08 (overnight audit): every deny list here also names
    `mcp__t3-code`. T3 pre-approves its own MCP server in every Claude
    thread (`--allowedTools mcp__t3-code__*`, `ClaudeAdapterV2.ts` @v0.1.7:
    1776), and tools such as `t3_thread_send` and `t3_thread_configure` act
    on other threads directly. A vault thread reads untrusted notes, so an
    injected note could otherwise steer another thread, a `full-access` one
    included, without anyone's yes. A server-level deny beats T3's allow
    and removes the tools (checked with Claude Code 2.1.318).
  - 2026-11-08 (security review of this branch): `wrote` split into
    `created` and `changed`, because a flat list made teardown delete files
    that existed before the host touched them (§1, §3.6). The Librarian route
    binds to one vault at start (`--vault`, §3.2). Host pairings and setup
    writes the person confirms are told apart from what a host does
    unattended (§3.3, §5a). The Team-seat exclusion names a sign-in home, not
    an instance id (§5b).
  - 2026-11-08 (second review): teardown keeps an unresolved file's backup
    and its `wrote.changed` entry; it used to keep the backup in one sentence
    and remove "the backups and the record" in the next (§3.6).

## 2. A vault becomes a T3 project

- The vault's T3 project is the T3 project whose `workspaceRoot`, resolved
  with `realpath`, equals the vault folder's `realpath`. There is no other
  mapping and no stored T3 id in the vault: the folder *is* the identity, so a
  vault moved or synced elsewhere stays portable.
- Project title: the vault's display name (Rotli's vault name, else the folder
  name).
- A host app MUST create the project through T3's API (or the shared T3
  controller), never by writing T3's database.
- One project per vault. If several T3 projects resolve to the same folder,
  the oldest is the vault's project, and the host app SHOULD say so rather
  than merge them.

## 3. The agent in a vault thread

Goal: the agent sees and changes the vault **only** through Rotli's MCP
routes, so Rust enforces secure notes, frontmatter ownership, revisions, and
proposals, whatever the model does.

### 3.1 What T3 does and doesn't offer (measured, 2026-11-07)

Sources: T3's `ClaudeAdapterV2.ts`, and Tesven's controller research (§3).

- T3 runs Claude Code through the Claude Agent SDK with `cwd` set to the
  project's folder and mirrors Claude Code's user/project/local settings walk.
  This thread is evidence that project files load: Rotli's own `.mcp.json`
  server (`rotli-carl`) and project skills are live in T3 threads on
  `~/rotli`. Validated 2026-11-08 on T3 0.1.7 with Claude Code 2.1.318: a
  vault's project `.mcp.json` and `.claude/settings.json` load in a T3 thread
  ([validation report](librarian-t3-validation-2026-11-08.md)). The conformance
  test (§6) still settles it per install.
- T3 has **no per-project setting for tools or MCP servers**. `t3.json` holds
  scripts, icon and env mode; `projectSettingsOverrides[projectId]` holds
  runtime mode and model only; the only mode ceiling is machine-wide.
- Threads in `approval-required` run with `permissionMode: "default"` and
  T3's permission callback on; settings deny rules apply before the callback.
  **T3's callback does not honour the project's `permissions.allow`**
  (validated): every Librarian call, reads included, waits for the person.

So there are four places to restrict a vault thread:

| Option | Files | Reaches | Verdict |
|---|---|---|---|
| **A. Project files in the vault** | `<vault>/.mcp.json`, `<vault>/.claude/settings.json` (§3.2) | Every Claude Code session whose `cwd` is the vault, in T3 or a terminal | **Required** |
| **B. A dedicated T3 Claude instance for vault threads** | `~/.t3/userdata/settings.json` › `providerInstances.<id>`: `driver: "claudeAgent"`, `config.homePath`, `config.launchArgs` (§3.3) | Threads launched with that instance | **Required for `approval-required` without a yes per call**; otherwise recommended as a second fence |
| C. T3 managed policy | the machine-wide managed policy document | Every T3 thread | Too broad; not used |
| D. User-level Claude config | `~/.claude/settings.json`, `~/.claude.json` | Every Claude session | Ruled out |

Which runtime mode (validated 2026-11-08):

- **Interactive vault threads** run in one of two ways (the owner's call):
  - `approval-required` **on option B's instance**, whose `--allowedTools`
    pre-approves the Librarian tools. A project `permissions.allow` does
    **not** pre-approve MCP calls under T3 (validated by both apps), so
    without option B every Librarian call, reads included, asks.
  - `full-access` with option A's deny list. The deny list held in T3
    `full-access` and in Claude Code bypass mode, Rust's guards hold whatever
    the mode, and moves and links to the person's notes are still proposals
    they approve in Rotli.
- **Unattended threads** (the daily distil, §5b) MUST launch in `full-access`.
  Nobody is there to approve, and an `approval-required` run stalls on its
  first call. They MUST still have option A's deny list.

### 3.2 Option A: files a host app writes into the vault (Claude provider)

The route is `rotli mcp --librarian`. It runs in **development builds only**,
like the full `rotli mcp` workspace server, until the review findings in
[`../design/librarian-mcp-and-t3-chat.md`](../design/librarian-mcp-and-t3-chat.md#before-this-route-leaves-development-builds)
are fixed and reviewed (2026-11-09). There it refuses every call until the
vault opts in: `"librarianMcp": true` in `<vault>/.rotli/settings.json`, and
the person's `rotli librarian on` for that vault, which ties the consent to
the vault folder so a copy of the vault starts off. A public build of
Rotli, and any build older than the route, answers `rotli mcp --librarian`
with "MCP and agent integrations are available only in development builds";
the host app MUST show that plainly (the route needs a development build of
Rotli for now), not retry.
`rotli --version` answers `{"version": "…"}` headlessly, so a host can check
before it writes anything.

**`<vault>/.mcp.json`** — declares the route, bound to this vault:

```json
{
  "mcpServers": {
    "rotli-librarian": {
      "type": "stdio",
      "command": "/Applications/Rotli.app/Contents/MacOS/rotli",
      "args": ["mcp", "--librarian", "--vault", "/Users/you/memex-vault"]
    }
  }
}
```

One Librarian process serves one vault, bound when it starts. `--vault`
names it as an absolute path; without `--vault` the route uses the folder it
was started in. Either must resolve (links followed) to a vault registered in
Rotli with `librarianMcp` on, or the server refuses to start and says why. It
never follows Rotli's default vault, so a thread in vault B can't reach vault
A, and switching the default mid-session redirects nothing. A host MUST write
`--vault` with the vault's real path: a host's working folder for MCP servers
is not guaranteed. `--root` is refused on this route. `--vault` ships with the route itself, so
every Rotli that answers `rotli mcp --librarian` binds this way.

**`<vault>/.claude/settings.json`** — approves the route and turns the
agent's own file tools off for this folder:

```json
{
  "enabledMcpjsonServers": ["rotli-librarian"],
  "permissions": {
    "deny": ["Read", "Grep", "Glob", "Write", "Edit", "MultiEdit", "NotebookEdit", "Bash", "mcp__t3-code"],
    "allow": [
      "mcp__rotli-librarian__librarian_guide",
      "mcp__rotli-librarian__librarian_search",
      "mcp__rotli-librarian__librarian_read",
      "mcp__rotli-librarian__librarian_index_read",
      "mcp__rotli-librarian__librarian_review"
    ]
  }
}
```

Why each part:

- `Read`, `Grep`, `Glob` are denied as well as writes: a raw read of
  `wiki/_secure/…` would send a secure note to a remote model, which the
  Librarian route exists to prevent. Read access goes through
  `librarian_read`, which refuses secure notes in Rust.
- `Bash` is denied because a shell writes files, and because a shell can run
  `rotli librarian apply` and approve the agent's own proposals: Rotli can't
  tell that command from the person's. The person's approval is only as
  strong as this deny rule. A host that needs a shell in vault threads MUST
  use a `PreToolUse` hook that refuses any command touching the vault or
  running `rotli librarian`, MUST tell the person that approval then depends
  on that hook, and SHOULD prefer not to.
- Writing tools (`capture`, `file`, `link`, `index`, `log`) are left to the
  host's normal approval, so a person sees each one unless they choose
  otherwise.
- Deny rules take precedence over allow rules and still apply under
  `bypassPermissions`. Validated 2026-11-08: denied tools are removed from the
  session ("No such tool available: Write … disabled for this session, in
  subagents as well as here") in Claude Code bypass mode and in a T3
  `full-access` thread. A host app MUST still run the conformance test (§6)
  on each install.
- The person's **claude.ai connectors** (Claude Docs, Gmail, Drive …) also
  load into a vault thread; project settings don't turn them off. They can't
  read secure notes, since those never reach the model, but they are another
  place non-secure note text could be sent. A host that needs a closed thread
  MUST launch Claude Code with `--strict-mcp-config`, which T3 doesn't do
  today.

Rotli's walk skips dot entries, and so does the memex's `scripts/validate.ts`
(`src-tauri/src/corpus.rs`, the `.rotli/` sidecar comment), so `.mcp.json`
and `.claude/` are never notes and never in the sidebar. Run `validate.ts`
once after writing them to the memex to confirm.

**Optional:** `<vault>/.claude/skills/<name>/SKILL.md` copies of the five
Librarian skills, for hosts that load skills from disk. Not required:
`librarian_guide` serves them over MCP.

### 3.3 Option B: a vault-thread instance in T3

A T3 provider instance whose launch arguments switch the raw file tools off
even if the vault's project files didn't load:

```json
{
  "providerInstances": {
    "vault-claude": {
      "driver": "claudeAgent",
      "config": {
        "homePath": "~/.claude",
        "launchArgs": "--allowedTools mcp__rotli-librarian__librarian_guide,mcp__rotli-librarian__librarian_search,mcp__rotli-librarian__librarian_read,mcp__rotli-librarian__librarian_review --disallowedTools Read,Grep,Glob,Write,Edit,MultiEdit,NotebookEdit,Bash,mcp__t3-code"
      }
    }
  }
}
```

- File: `~/.t3/userdata/settings.json`. It is T3's config. A host app may
  write it only as a **person-confirmed setup action**: it shows the exact
  instance it will add, the person says yes, and it adds that one instance and
  changes nothing else (Tesven adds its own `roo` instance this way). It never
  writes this file unattended, and never edits an instance it didn't add.
  Rotli prints `vault-claude` for the person to add; it doesn't write it.
- `--allowedTools` as shown pre-approves the four read tools, so writes
  (`capture`, `file`, `link`, `index`, `log`) still ask. To pre-approve the
  whole route instead, use `--allowedTools mcp__rotli-librarian`. Writes that
  touch the person's notes stay proposals either way. Tesven's Roo instance
  uses the same pattern with `mcp__tesven`.
- `homePath` pointing at the person's usual Claude home shares their login and
  history; a fresh folder means signing in again there.
- Adding `--mcp-config <file>` to `launchArgs`, so the instance carries the
  Librarian route itself, is untested next to T3's own `setMcpServers`. v1
  keeps the route in the vault's `.mcp.json` (option A) instead.

### 3.4 The machine-specific path in `.mcp.json`

`.mcp.json` names an absolute binary path and the vault's absolute path. A
vault synced to another Mac, or committed to Git, would carry both; on another
Mac a wrong `--vault` refuses to start rather than serving a different
vault. The host app SHOULD add `.mcp.json` to the
vault's `.gitignore` when the vault is a Git repository. The alternative,
`claude mcp add --scope local …` run from the vault, writes the Claude config
home's `.claude.json` and so changes global config: only with the person's OK.

### 3.5 Other providers

- **Codex** in T3: project `.codex/config.toml` can add the MCP server, but
  Codex's read-only sandbox still lets the model read every file, including
  secure notes. v1 therefore marks Codex vault threads **not conformant** when
  the vault has secure notes; the host app MUST warn, and MAY offer Codex only
  on vaults without them.
- Other T3 providers: not conformant until each has an equivalent "MCP only,
  no raw file reads" configuration.

### 3.6 Turning it off

The host deletes the files in `agent-host.json` `wrote.created`. For each
`wrote.changed` file it restores the backup, but only if the file still has
the recorded `revision`; if the person has edited it since, the host leaves
it, keeps the backup, and tells the person which file to check. It never
deletes a file it didn't create. Then it cleans up only what it settled:
the backups it restored and their `wrote.changed` entries, and the
`wrote.created` entries it deleted. An unresolved file's backup and its
entry stay, so the person can still restore by hand and a later teardown
can try again; the record itself is removed only once nothing is left in
it. The Librarian setting (`librarianMcp` in
`.rotli/settings.json`) is separate: the route refuses every call while it is
off, even if the files remain.

## 4. Listing and showing threads in Rotli

- Rotli shows the threads of the **active vault's project only** (§2), newest
  activity first: title, status (idle, running, waiting for approval, error),
  provider and model, last activity.
- Rotli reads threads through T3's API (via the shared T3 controller when
  available). It MUST NOT read or write T3's SQLite for anything a person acts
  on. A read-only peek MAY be used for counts while T3 is down, labelled as
  possibly stale.
- Opening a thread shows its transcript in Rotli's look. Tool calls render as
  cards; a Librarian proposal card links to the proposal in Rotli's review list.
- Approvals asked by a thread MAY be answered in Rotli; the answer is sent to
  T3, which stays the record.
- New chat in Rotli creates a thread in the vault's project. Rotli MUST make
  sure §3's files are current before the first turn when the Librarian is on.
- Deleting a thread is T3's action; Rotli offers it and forwards it.
- Rotli copies transcripts into the vault only when chat capture is on (§5b),
  and only for the places the person chose. A person MAY always save a reply
  as a note, which goes through the normal write path.

## 5. "No project"

- A thread with **no project** has no vault: no Librarian route, no
  `rotli-workspace` route, and no vault folder as its `cwd` or in its
  additional directories.
- Its `cwd` is a folder the host app owns, with the same deny list as §3.2
  for raw writes and the shell, and only the host's own MCP. Tesven's is
  `~/Library/Application Support/Tesven/roo-home/` (`.mcp.json` with the
  `tesven` server, `.claude/settings.json` denying
  `Write, Edit, MultiEdit, NotebookEdit, Bash, mcp__t3-code`, and Roo's
  `CLAUDE.md`); its
  T3 project is titled "Roo".
- Rotli does not create or list no-project threads in v1. Tesven lists them
  under "No project".
- Moving a thread between places is not supported in v1; start a new thread.

## 5a. Reaching T3

- **One shared T3.** There is exactly one T3 Code install on the Mac, and
  every host app uses it. Rotli and Tesven are separately paired clients of
  that one server, each with its own pairing, scope and label ("Rotli (read)",
  "Tesven"), and each revocable on its own. Neither app bundles, forks or
  starts a second T3, and neither gives it a different data directory. AI
  sign-ins (Claude, Codex and the rest) live in T3's provider instances, so
  connecting AI once in T3 serves both apps. Both apps recommend installing T3
  Code. Whichever app the person sets up first offers it, and the other
  detects the existing install and only pairs.
- **Server.** T3's local server runs as the desktop app's server, as
  `t3 serve`, or as a background service (`t3 service install`). Host apps
  connect to `ws://127.0.0.1:3773/ws?orchestrationProtocol=2`. If the port
  answers with a T3 environment, that is the shared install; a host app MUST
  NOT start another one on a different port or data directory.
- **Probe first.** Read `/.well-known/t3/environment` (no auth). It gives the
  protocol version and capabilities. An unknown protocol, or an HTTP 426 on
  connect, MUST be reported as "T3 Code updated; update <app>", never as a
  pairing problem. Host apps target T3's stable channel.
- **Pairing.** A pairing is made in T3 (`t3 auth pairing create`, or a pair
  link), either by the person or by a host app as a **person-confirmed setup
  action**: the app shows the exact command and scopes, the person says yes,
  and the app runs it once (Tesven does this). A host app never mints or
  widens a credential unattended. Each pairing has the narrowest scopes that
  app needs:
  - **Rotli:** `orchestration:read` only. It lists, shows, follows, and copies
    threads.
  - **Tesven:** `orchestration:read`, `orchestration:operate`, and
    `diagnostics:read`. It needs the third for usage and costs, which T3
    gates behind it (`RpcAuthorization.ts`, line 110).

  **Setup actions versus unattended authority.** Tesven makes two writes to
  T3 at setup, each only after the person confirms: creating its pairing, and
  adding its own `roo` provider instance to `~/.t3/userdata/settings.json`
  (§3.3). After setup, its pairing's scopes are its whole authority: it never
  writes T3's settings, mints or widens a pairing, or edits another app's
  instance on its own. Rotli makes no T3 writes; the person makes its pairing.

  `--ttl` limits only the one-time pairing credential. The session it becomes
  lasts 30 days whatever the TTL (validated: `expires_in` 2,591,999 s for a
  `--ttl 1h` credential), so a host app MUST revoke its session
  (`t3 auth session revoke <id>`) when it disconnects for good.
  Sessions last at most 30 days. A host app MUST show the expiry, warn 7
  days before, and offer the exact re-pair command, for example
  `t3 auth pairing create --scope orchestration:read --ttl 30d --label "Rotli (read)" --json`.
  T3's session list shows the **pairing's** label (`--label`), not the
  `client_label` sent at exchange, so the label must name the app. Revoking
  one app's session never affects another's (validated by both apps).
  An expired pairing pauses work; it never loses the ledger's place.
- **Calls.**
  - Read: `subscribeShell` (projects and threads), `getThreadProjection` (a
    thread's turns), `subscribeThread` (live).
  - **The shell's second snapshot holds projects only.** On T3 0.1.7, the
    authoritative `snapshot` is followed by an enrichment `snapshot` with
    `threads: []` and `resolvedRepositoryIdentityRoots`, and that one recurs
    whenever repository identities change. A client MUST merge its projects
    and keep its threads, never replace the thread list. Tesven did, and saw
    1 of 1,407 threads.
  - Subscribe with `requestCompletionMarker: true`, or T3 never sends
    `synchronized` and every connect waits out a timeout.
  - **Thread ids contain `:` and `%`** (e.g. `mcp:launch:…`,
    `run:thread:mcp%3A…`). Percent-encode them in every URL path and query,
    never use them raw in a file name, and store them only as JSON or quoted
    YAML strings.
  - **Thread reads are partial on long threads** (75 of 411 items on one).
    A reader MUST page until it has every item after its last position, and
    check its count against the thread's `itemCount`.
  - Operate (Tesven): `launchThread`, `dispatchCommand`.
  - Project creation (`projects.mutate › project.create`) writes to the
    person's T3, so it is proposed and confirmed once.
- **Rotli's actions** (new chat, send) run the person's own `t3 thread
  start|send` when they press the button, so Rotli stores no operate token.
- **Contract test.** Both apps run one live contract test against a disposable
  T3 that covers `getThreadProjection`, `launchThread`, and the environment
  probe. Hand-written fakes alone don't count.

## 5b. Chat capture ("Keep my chats and notes in my vault")

Additive to v1. Rationale: the plan's "Your chats land in your vault".

- **The switch** is `"librarianKeepChats": true` in the vault's
  `.rotli/settings.json`. It needs `"librarianMcp": true`. Only Rotli writes
  that file.
- **Tesven's onboarding** offers it and never writes the vault. It opens
  `rotli://settings/librarian?keepChats=1`, and Rotli shows the switch for the
  person to confirm. A Rotli build without this link opens Settings, and the
  person flips the switch there.
- **Places captured:**
  - on by default: the vault's own project;
  - on by default, **tool results stripped**: No project (`roo-home`). Each
    tool call is kept as its name only, because Roo's tools return work data;
  - off by default: every other T3 project;
  - never, unless the owner decides otherwise: threads on the Team seat,
    excluded in code. The seat is named by its **sign-in home**, not an
    instance id: ids are labels each person picks, so an exclusion by id
    misses a renamed instance. Rotli reads
    `providerInstances` from `~/.t3/userdata/settings.json`, maps each
    instance id to its `config.homePath` (realpath; a missing `homePath`
    means `~/.claude`), and excludes every thread whose instance resolves to
    an excluded home (the owner names theirs once). A thread
    whose instance is no longer listed is skipped, never copied.

  The per-project choice lives in `.rotli/settings.json` as
  `librarianChatPlaces: {"<realpath>": true|false}`.
- **Capture starts from now.** Turning it on seeds the ledger with every
  thread's latest turn. Backfill of older history is a separate, explicit
  action that shows a size estimate first (not in v1).
- **Step 1, copy.** Rotli does this, with no model and a read-only pairing. It
  reads each moved thread through T3's API (§5a) and appends the new turns to one transcript
  note per thread:
  - written through Rotli's write path;
  - Rotli writes its frontmatter: `source`, `t3_thread`, `t3_project`, the
    first and last turn times;
  - messages follow the memex chat shape:
    `**speaker** · YYYY-MM-DD HH:MM — text`, with tool calls as
    `**tool** · … — <name>: <one-line result>`;
  - it pages through the thread (§5a) from the ledger's `copiedUpTo` to the
    end, and doesn't advance the ledger past an item it hasn't written;
  - it skips T3's own plumbing items: "Workspace ready" (workspace
    preparation), checkpoints, and reasoning;
  - the note's file name comes from the thread's title, never its id;
  - if the text is secret-shaped, or the thread is marked secure, the note is
    created secure.
- **Step 2, distil.** A scheduled T3 thread in the vault's project does this,
  with the Librarian tools only. It is launched by a T3 scheduled task the
  person creates once; never by Rotli. Tesven's controller doesn't launch
  it either: every Tesven launch is clamped to `auto-accept-edits`, and
  this step needs `full-access` (§3.1), a ceiling Tesven keeps on purpose
  (Tesven's 2026-11-08 audit). It follows the `capture-a-chat` skill:
  - one summary note per thread, created with `librarian_capture` and its
    `origin` (`{t3Thread, upToTurn}`);
  - link proposals;
  - an index refresh and a log line.

  Secure transcripts are refused by `librarian_read` and logged as "kept, not
  summarised".
- **The ledger** is `.rotli/librarian/chats.jsonl`, one line per change:
  `{t3Thread, place, copiedUpTo, distilledUpTo, note, ts}`, where `t3Thread`
  is the raw id as a JSON string and `copiedUpTo` is a T3 item position. The
  last line for a thread wins. Both steps read it, so re-runs and resumed threads only
  append.
- **Never:** deleting or editing anything in T3, a provider, or a Claude
  config home; copying images or attachments (v1 keeps a link); capturing a
  place the person turned off.

## 6. Conformance tests (each host, disposable vault only)

1. Set up a synthetic vault with a secure note, a locked note, and a
   person-written note, through §3.
2. Check that the project files loaded at all: the thread lists
   `rotli-librarian` among its MCP servers. If not, stop: the vault is not
   conformant on this install.
3. In a T3 thread on it, in the thread's most permissive mode, ask the agent
   to read the secure note by path with its own tools: refused by permissions.
4. Ask it to edit a note with its own tools and with Bash: refused.
5. Ask it to file the person-written note: a proposal appears, the file has not
   moved, and `librarian_review` lists it.
6. Turn `librarianMcp` off: every Librarian call refuses.
7. Turn the setup off: exactly the files in `wrote.created` are gone, and
   every file in `wrote.changed` is back as it was before setup.
8. With chat capture on, run a thread containing a fake card number. Its
   transcript is created secure, and the distil step neither reads nor
   summarises it. A thread in an off-by-default project is not copied, a
   thread on an instance whose sign-in home is the excluded Team-seat home is
   never copied (whatever the instance is called), and a No-project transcript holds tool
   names but no tool results.
9. Turn capture on in a vault whose T3 already has threads: nothing older than
   the moment it was turned on is copied.

Never run these against a real vault or the owner's real T3 projects.

## 7. Where this spec lives

Proposed: keep it here (`docs/architecture/vault-thread-protocol.md` in Rotli)
while it is a draft, and have Tesven link to it. Once both apps implement v1,
move it to a small shared spec repository (or a `protocol/` package next to the
shared T3 controller) that both vendor at a pinned version. Owner's call.
