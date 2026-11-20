# Rotli and the agent ecosystem around Obsidian (evaluation)

Status: evaluation and proposal, 2026-11-19. No code changes. Rotli facts were
read on `dev` at `b7b90a28`; web sources were fetched the same day and are
listed at the end. Anything not confirmed from a primary source is marked
*unverified*.

**Which agent was meant.** The request named an agent that transcribed as
"Grockbot". The evidence points at **Grok Bot**, xAI's agent product: Obsidian
lists Grok Bot as an official plugin target, [`ROADMAP.md`](../../ROADMAP.md)
line 67 is "MCP / Grok Bot plugin", and `rotli agent config` already prints a
Grok Bot setup (`src-tauri/src/workspace_help.rs:96`). OpenClaw (the project
sometimes called Clawdbot or Moltbot; that naming history is *unverified*) is
covered too, because its Obsidian skill and its wiki plugin are the closest
thing to what Rotli does.

## 1. The Obsidian agent structure today

### The pieces

| Piece | What it is | What it tells an agent |
|---|---|---|
| **Official skill pack**, `obsidianmd/obsidian-skills` (was `kepano/obsidian-skills`; MIT, plugin 1.2.0, about 53k stars) | Seven Agent Skills: `obsidian-markdown`, `obsidian-bases`, `json-canvas`, `obsidian-cli`, `obsidian-headless`, `defuddle` (web page to Markdown), `knap` (templates from JSON or CSV) | File formats and CLI verbs. Its own README: "skills only, with no MCP server, hooks, or background processes". MCP is promised later |
| **Official CLI**, `obsidian` (Obsidian 1.12+) | Talks to the **running** desktop app over a local socket | `read`, `create`, `append`, `prepend`, `rename`, `move`, `delete` (to trash), `search`, `daily:read`, `daily:append`, `property:set`, `tasks`, `tags`, `backlinks`, `unresolved`, `open`, `eval`. Target by `file=` (resolves like a wikilink) or `path=`; `vault=` picks the vault; `format=json`. It exits 0 even on failure |
| **Obsidian Headless**, `ob` | Sync and Publish without the app | Nothing about notes: "to read or change notes without the app, edit the files directly" |
| **Community MCP** | Local REST API with MCP (a plugin with a built-in MCP server on loopback, bearer token); `mcp-obsidian` and `cyanheads/obsidian-mcp-server` (read, write, search, patch notes, tags and frontmatter) | The same verbs as tools. All need the app running or a path to the folder |
| **In-app agents** | Obsidian Copilot ("run agents in Obsidian: OpenCode, Codex, Claude Code"), Smart Connections (local embeddings for related notes) | The vault folder is the agent's working directory |
| **OpenClaw** | A bundled `obsidian` skill over the official CLI, and a `memory-wiki` plugin with `wiki-maintainer` and `obsidian-vault-maintainer` skills | "Direct file edits are still fine when safer/faster". `memory-wiki` builds an LLM-wiki vault: `AGENTS.md`, `WIKI.md`, `index.md`, `inbox.md`, `entities/`, `concepts/`, `syntheses/`, `sources/`, `reports/`, with generated text kept inside managed blocks and a `wiki_lint` step |
| **Grok** | Obsidian publishes "Obsidian for Grok Bot". xAI's CLI, Grok Build, has an official plugin marketplace whose plugins bundle `skills/`, `commands/`, `agents/`, hooks and `.mcp.json` under `.grok-plugin/` | Same skills, same vault-as-folder model. How a Grok Bot plugin is packaged, and whether Grok Bot can run a local command, is *unverified* |

### How the skill pack installs

One repository carries a manifest per agent beside one `plugins/obsidian/skills/<name>/SKILL.md` tree:

- **Claude Code:** `claude plugin marketplace add obsidianmd/obsidian-skills`, then `claude plugin install obsidian@obsidian-skills`. By hand: copy the skills into `.claude/skills/` **at the vault root**.
- **Codex and ChatGPT:** the plugin directory or `codex plugin marketplace add …`. By hand: `~/.agents/skills`.
- **Cursor, Grok Bot, Gemini CLI, OpenCode:** a marketplace listing, `gemini extensions install <repo>`, or a clone into `~/.opencode/skills/`.
- **Any agent:** `npx skills add <repo>`. A shared `plugin.json` follows the open agent-plugins schema.

### What an agent therefore expects from a vault

1. The vault is a folder, and the agent's working directory is that folder.
2. It may read and write any file. Both the official CLI skill and OpenClaw's skill tell it to write files directly for long content or bulk edits.
3. It writes YAML frontmatter itself. Step 1 of the official Markdown workflow is "Add frontmatter".
4. A schema file at the root (`AGENTS.md` or `CLAUDE.md`) tells it the vault's conventions.
5. App-aware verbs exist for the things files can't do alone: rename and move that update links, daily notes, properties, tasks.
6. Formats: Obsidian Markdown (wikilinks, embeds, callouts, block ids, properties, tags), `.base`, `.canvas`.
7. There is no privacy model. Nothing is secure or locked.

### What "structure by default" means

Karpathy's LLM-wiki note defines three layers and three operations:

- **Raw sources**, immutable. **The wiki**, Markdown pages the LLM writes and owns entirely. **The schema**, a `CLAUDE.md` or `AGENTS.md` that makes the agent "a disciplined wiki maintainer".
- **Ingest** (a source in, ten or more pages touched), **query** (answers can be filed back as pages), **lint** (contradictions, orphans, missing pages).
- **`index.md`**, a catalog the agent reads first, and **`log.md`**, an append-only record. Both are files in the vault.

Rotli has the same shape with a different owner, and this doc does not claim
it implements the pattern. In Rotli the person owns every word. The Librarian
changes location and metadata only: intake (`wiki/_inbox/`), areas (folders
under `wiki/`), a generated `_index.md` per area, `summary`, `tags` and `links`
in frontmatter, and an activity record with undo. It runs on-device, starts at
the **Organize** setting (`src-tauri/src/organizer.rs:94`), and a raw vault or
the Off setting stops it. That default is the advantage to protect: no
Obsidian agent keeps a vault filed without being asked.

## 2. Compatibility matrix

**Supported** = works in the public build. **Dev only** = behind
`feature_policy` (development builds). **Blocked** = Rotli refuses it on
purpose. `aw` = [`agent-workspace.md`](../architecture/agent-workspace.md),
`vc` = [`vault-copy-and-obsidian-compatibility.md`](vault-copy-and-obsidian-compatibility.md),
`vtp` = [`vault-thread-protocol.md`](../architecture/vault-thread-protocol.md).

| # | Capability | Rotli today | Status | Evidence |
|---|---|---|---|---|
| 1 | Plain Markdown, frontmatter kept byte-for-byte, wikilinks by title, file name or alias, tags | Reads and writes them; Obsidian reads the result | Supported | `vc`:520–534 |
| 2 | `![[file]]` embeds, note-relative images | Read and written | Supported | `CHANGELOG.md`:672–679 |
| 3 | Callouts, block ids (`^id`) | No handling found in `src/`; block references are on the roadmap | Missing | `ROADMAP.md`:227 |
| 4 | Bases (`.base`) | Not a known format. The nearest thing is `rotli notes query` | Missing | none in tree |
| 5 | JSON Canvas (`.canvas`) | Kept byte-for-byte; shown only in development builds | Dev only | `feature_policy.rs`:49–63 |
| 6 | CLI: list, search, query, read, create, move, rename, trash | `rotli notes …`, JSON out, non-zero exit on failure, runs without the app open | Supported | `feature_policy.rs`:115–118; `workspace_help.rs`:8–22; `aw`:27–28 |
| 7 | CLI: append, prepend | `notes patch` and `notes update` with a revision. No append verb | Partial | `workspace_help.rs`:15–16 |
| 8 | Editing a note the person wrote | Refused unless they turned on "Let AI edit the text" | Blocked | `aw`:77–80 |
| 9 | Writing frontmatter (`property:set`, or step 1 of the Markdown skill) | A body that starts with frontmatter is refused; Rotli and the Librarian own those keys | Blocked | `aw`:64–67 |
| 10 | Daily notes (`daily:append`) | A "Daily note" starter template only. No daily folder, date format or verb; a daily folder is an ordinary area | Missing | `src/services/templates.ts`:43–45; `librarian_map_tests.rs`:70–72 |
| 11 | Tasks, tags, backlinks as verbs | Counts ride on every read; `query tags:x` filters. No listing verbs | Partial | `aw`:59–63 |
| 12 | Rename and move that keep links working | `rotli rename`, `notes move` | Supported | `aw`:68–76 |
| 13 | MCP server | `rotli mcp` (`rotli-workspace`): notes, views, boards, Word documents | Dev only | `feature_policy.rs`:18–20, 39–42 |
| 14 | A wiki-keeping tool set with skills | The Librarian route: ten tools, five skills, opt-in per vault, proposals only | Dev only | `aw`:216–372 |
| 15 | Installable skill pack or plugin | None. The five skills are compiled into the binary and served by `librarian_guide`. The repo's `.claude/skills/` are for building Rotli | Missing | `src-tauri/librarian-skills/` |
| 16 | Per-agent setup | `rotli agent config` prints Claude Code, Codex, Cursor, Gemini and Grok Bot setups; Rotli never edits their config | Dev only | `workspace_help.rs`:62–109 |
| 17 | Cloud agents (Grok Bot, ChatGPT) | The remote relay, which the simplification plan proposes removing (row 9) | Dev only | [`librarian-mcp-and-t3-chat.md`](librarian-mcp-and-t3-chat.md):68 |
| 18 | Schema file at the vault root | None written for a person's vault. The protocol specifies `.mcp.json` and `.claude/settings.json`, written by a host app; Rotli doesn't write them yet | Missing | `vtp`:146–241; plan:217 |
| 19 | Agent writes a file directly | See below | Blocked, not prevented | `corpus_layout.rs`:252–313 |
| 20 | `index.md` and `log.md` in the vault | A generated `_index.md` per area. The route's index and log are sidecars in `.rotli/librarian/`, rendered through the read gate, not notes | Partial | `vc`:134; `aw`:274 |
| 21 | Lint (orphans, unresolved links, duplicates) | No agent operation | Missing | none |
| 22 | Web clip, templates (`defuddle`, `knap`) | They compose: the agent pipes the Markdown into `rotli notes create --stdin` | Supported | `workspace_help.rs`:14 |
| 23 | Keeps the vault filed by default | On-device Librarian, default Organize, not gated by build. A note made with `rotli notes create` lands in intake, which is what the Librarian files (conditions below). Never runs on a folder connected in place | Supported; the CLI-to-filed path was read, not run | `organizer.rs`:94, 271; `aw`:113; `librarian_map.rs`:75–80; `vc` decision H |
| 24 | Secure notes withheld from remote models; locked notes never AI-edited | Enforced in Rust on every Rotli route. A file tool pointed at the folder ignores it | Supported, on Rotli's routes only | `vc`:532; `vtp`:289–297 |

**Row 19 in detail.** In a Rotli vault:

- A file written at the root, or in a folder Rotli doesn't own, is **Hidden**: never listed, never searched, never filed (`corpus_layout.rs`:308–312). The person can't see what the agent made.
- A file written under `wiki/` is seen by the watcher (`corpus_watch.rs`:35–39) and is Librarian input; in `wiki/_inbox/` it is classified and filed (`librarian_map.rs`:56–80). Hand-written frontmatter survives as unknown keys.
- **The agent stamp can be forged.** Rotli trusts `created_by: agent` when it is written in Rust's own spelling (`frontmatter_keys.rs`, `owned_key`). A program that writes the file can type exactly that, and the note then counts as agent-made and editable by AI.
- Whether such a file is added to Main was not confirmed: the only seeding found runs when `main.json` is missing (`corpus.rs`:4263).
- Either way the write skips the create-time secret check, the revision check, and the AI edit journal.

**Row 23's conditions.** Read from code, not run end to end: the Librarian
is a worker inside the app (`src-tauri/src/lib.rs`:2515), so Rotli must be
open; the vault must be a Rotli vault or a copy with the Librarian on; it
needs the on-device model or a connected client; and it waits until a note
has sat untouched for five minutes (`organizer_knobs.rs`:16). Nothing in
`organizer.rs` treats an agent-stamped note differently. An end-to-end test
of "CLI create, then filed" belongs with G1.

**In one sentence:** in the public build an outside agent has exactly one
sanctioned door, the `rotli notes` JSON CLI. Everything built for agents (MCP,
`rotli agent`, the Librarian route, the relay, canvases) is development builds
only.

## 3. Gaps and the smallest work to close each

Ordered by value. Sizes: S = days, M = one to two weeks, L = more.

### G1. Ship a Rotli skill pack (S–M)

Yes, Rotli should ship one, and the first version can be **skills only over the
ungated CLI**, the same shape as Obsidian's. Rows 6 and 23 make that possible
in the public build: the agent creates a note through `rotli`, the note lands
in intake, and the on-device Librarian files it while Rotli is open. That last
step has not been run end to end; the pack's first test should be exactly it.

Contents, one `SKILL.md` each:

| Skill | Holds |
|---|---|
| `rotli-vault` (load first) | What a Rotli vault is. The one rule: change the vault only through `rotli`. No frontmatter. New notes go to intake. Ids, revisions, deep links. A refusal is an answer, not a problem to route around |
| `rotli-cli` | Every `rotli notes`, `views`, `main`, `boards` verb, with the Obsidian verb it replaces (`obsidian create` → `rotli notes create`, `obsidian move` → `rotli notes move`) |
| `rotli-markdown` | What Rotli Markdown supports and where it differs from Obsidian's: wikilinks, `![[file]]`, `mermaid` and `chart` fences; no callouts, block ids or Bases yet |
| `clip-to-rotli` | `defuddle` to Markdown, then `rotli notes create --stdin`, one source per note |
| `keep-the-wiki` and the four Librarian skills | Generated from `src-tauri/librarian-skills/`, so the text has one home. Used when the route is available |
| `host-notes` | The §5c rules for an app's own notes (section 5) |

Packaging: one public repository, `plugins/rotli/skills/…`, with the manifests
section 1 lists (`.claude-plugin`, `.agents/plugins`, `.cursor-plugin`,
`gemini-extension.json`, `.grok-plugin` for Grok Build, the shared
`plugin.json`), an OpenClaw header (`metadata.openclaw.requires.bins:
["rotli"]`), and `npx skills add`. When MCP leaves development builds the
plugin gains a `.mcp.json`. A CI check keeps the Librarian skills identical to
the compiled ones.

Limit: skills are advice. They don't stop an agent with file tools.

### G2. Catch what lands outside Rotli's write path (S–M)

Agents will write files anyway; both ecosystem CLI skills tell them to. Today
that output can vanish (row 19). Smallest fix, no model needed:

- Rotli notices Markdown files that appeared outside its write path in a place
  it hides, and shows one notice: "3 notes were added outside your wiki", with
  **Bring into intake** (a move through `CorpusStore`, then the normal filing).
- Confirm, with a test, that a file dropped into intake by another program
  reaches Main and is filed.

This is the backstop that keeps the structure when an agent ignores G1.

### G3. A schema file at the vault root (S)

The layer every agent reads without being told. When the person turns on "Let
agents work in this vault", Rotli writes a short generated `AGENTS.md` (and a
`CLAUDE.md` that imports it): this is a Rotli vault, use `rotli`, don't write
files, here are the areas and the intake folder. With it go the protocol's
`.mcp.json` and `.claude/settings.json`. All are recorded in `agent-host.json`
so turning it off removes exactly what was written (`vtp` §1, §3.6). In a
Rotli vault a root `.md` is already hidden from notes; a copy's layout needs
the two names added to its hidden list (`corpus_layout.rs`:350–353). This is
plan slice 2 (`rotli agent config` prints the setup) taken one step further.

### G4. MCP and the Librarian route out of development builds (M, already planned)

This is the unlock for hosts that prefer tools to shell commands (Cursor, Grok
Bot, ChatGPT) and for the "no raw file tools" fence. Left to do, from the
plan ("Before this route leaves development builds", "Next slices"): the
independent review of the fixes merged in #295; approval that doesn't rest on
the host's sandbox, which the plan records as "documented, not closed"; and
the Settings switch and Proposals list.

### G5–G8. Smaller gaps

| Gap | Smallest work | Size |
|---|---|---|
| G5. CLI verbs agents reach for | Additive, under the existing rules: `notes append` (sugar over `patch`, same refusals), `notes backlinks`, `notes tasks --open`, `tags` with counts, and `daily read\|append` once a vault knows its daily pattern (section 4) | S each |
| G6. A whole-vault index an agent can read | The index was a note until #295 moved it to a sidecar, so a note that turns secure drops out. Don't put it back in a file. Add `rotli librarian index` to render it through the gate, and name each area's `_index.md` as the file form in `rotli-vault` | S |
| G7. Lint | `rotli notes lint`: unresolved wikilinks, orphans, notes with no summary, same-title duplicates. Deterministic, read-only. A `lint-the-wiki` skill turns findings into proposals | S–M |
| G8. Formats (low value for agent work) | Callouts (render). Block references (roadmap). Canvas out of development builds. Bases: don't build; the pack says it is unsupported | S to L |

### How an outside agent works in a Rotli vault without eroding it

Three fences and one backstop. Only the second is Rotli's alone to enforce.

1. **Advice** (G1, G3): reaches every agent, enforces nothing.
2. **Rotli's write path** (rows 6–9, 14): intake for new notes, no
   frontmatter, no edits to a person's note, proposals on the route. Enforced
   in Rust.
3. **The host's sandbox** (`vtp` §3.2): raw file tools and the shell denied in
   vault threads. Only Claude Code has a validated recipe (`vtp` §3.5).
4. **The backstop** (row 23, G2): the Librarian is on unless the person turns
   it off, and stray files are brought into intake.

Said plainly: for an agent with no deny mechanism (Codex, OpenClaw, Grok Build
with a shell) fence 3 doesn't exist, and a secure note is a readable file to
it. Rotli can warn (the pack, Settings, the protocol's Codex warning) but not
prevent this. Only protecting secure notes at rest would, and that is outside
this evaluation.

## 4. Learning an existing vault

### What exists to build on

- Connecting a folder already inspects it read-only: counts and a label
  (`inspect_vault_path`, `src-tauri/src/lib.rs`:1073–1084).
- The Librarian only ever organizes a copy Rotli made (`vc`, the law and
  decision H). The copy keeps the person's tree and file names (decision A).
- On a copy the Librarian reads a small map (`LibrarianMap::Copy`,
  `librarian_map.rs`): the inbox, Rotli's own suffixed folders, Obsidian's
  declared templates and attachments folders (`obsidian_set_aside`, :201), and
  **areas = every top-level folder that holds a note** (:98–120).

That last rule is the gap. A daily-notes folder, an archive, a folder of index
notes, and a real topic area are all "areas" today. Learning the vault means
replacing that guess with a profile the person confirms.

### Signals (all deterministic, read-only, nothing leaves the Mac)

| Signal | Measured from | Tells us |
|---|---|---|
| Declared settings | `.obsidian/app.json` (attachments, new-note folder), `daily-notes.json` (folder, date format), `templates.json`, the enabled plugin list | Roles with certainty: declared, not inferred |
| Folder tree | Depth, notes per folder, numeric prefixes (`10 Projects`, `10-19`), known names (Projects, Areas, Resources, Archive, Inbox, MOCs) | The method (PARA, Johnny.Decimal, topic folders, flat) and the archive |
| File names | Date shapes (`2026-11-19`, `2026-W47`), long numeric id prefixes, casing, prefixes (`MOC - `, `@Name`) | Daily and periodic notes, Zettelkasten ids, naming style |
| Frontmatter | Key frequency, value types, keys with few distinct values (`type`, `status`) | The person's own schema, to preserve and to offer as filters |
| Tags | Frontmatter or inline, nesting (`a/b`), frequency, agreement between a tag and a folder | Whether tags or folders carry the organization |
| Links | Wikilink or Markdown style, links per note, hub notes (many links, little prose), orphan and unresolved share, share of links that stay inside a folder | Index notes, how cohesive each folder is, link style to keep |
| Intake | A folder named like an inbox, notes sitting at the root, notes with no links and no tags | Where unfiled notes live |
| Non-note folders | Share of non-Markdown files; template markers (`{{date}}`, `<% %>`) | Attachments and templates beyond what Obsidian declares |
| Unsupported content | `.base`, `.canvas`, Dataview and Templater blocks | Warnings: what Rotli won't show the same way |

### Confidence

Each inferred role carries its evidence and one of three levels. **Declared**:
read from Obsidian's own settings. **Strong**: two independent signals agree,
for example a folder named `Journal` where 95% of file names are dates.
**Weak**: one signal, or signals that disagree. Thresholds are named constants.
Scores come from counts alone, so the same vault always gives the same
profile, and fixture vaults can pin it in tests.

### Output: a layout profile and a proposed mapping

```json
{
  "method": { "guess": "para", "confidence": "strong" },
  "roles": {
    "inbox": { "folder": "Inbox", "confidence": "strong", "evidence": "38 notes, none linked" },
    "daily": { "folder": "Journal", "format": "YYYY-MM-DD", "confidence": "declared" },
    "indexNotes": { "pattern": "MOC - *", "confidence": "weak" }
  },
  "areas": ["1 Projects", "2 Areas", "3 Resources"],
  "leaveAlone": ["Journal", "4 Archive", "Templates"],
  "conventions": { "links": "wikilink", "tags": "inline, nested", "ownKeys": ["type", "status"] },
  "warnings": ["12 Dataview blocks will show as code"]
}
```

The mapping the person sees is what the Librarian will do with it: file new
notes from `Inbox` into the three areas and their subfolders, never move notes
into or out of `leaveAlone` folders, keep file names, add tags in the
person's style.

**Where it lives.** A confirmed profile is the person's decision, so it can't
live only in `.rotli/`, which is rebuildable. It goes in the vault marker next
to the role map, with a contract bump (3.9 to the next), exactly as the role
map did (`vc` slice 4a). The raw scan report can sit in `.rotli/`.

### Two ways to confirm, one place to commit

Both paths end on the same sheet, shown in the copy flow after Verify and
before the Librarian's first pass. Nothing is applied until the person
confirms there.

- **No AI configured: confirm or decline.** "Here is how your vault looks":
  five to seven lines, one per detected role with its evidence ("Daily notes:
  `Journal/`, 412 notes named by date") and a control (keep, pick another
  folder, not this). Confirm writes the profile. Decline keeps today's
  behaviour (top-level folders are areas). This path is the base stage and
  must be complete without any model.
- **AI configured: validating questions.** The same sheet, plus a short
  exchange about the **weak** items only ("`Notes/` holds 300 notes with no
  shared tags. Is it where new notes land, or a topic of its own?"). The
  person can answer in their own words; the model turns the answer into edits
  to the profile, which appear on the sheet for confirmation. The model is
  given the profile (counts, folder and tag names), never note bodies. Names
  can be sensitive and an original has no secure flags yet, so an on-device
  model is the default, and a remote model gets names only after the secure
  keyword and secret checks, with a preview of exactly what will be sent.

### Never lose notes, stay Obsidian-readable

- The scan is read-only, on the original or the copy. It writes nothing there.
- The profile is applied only to a copy Rotli made and verified. A folder connected in place gets the report and nothing else (decision H stands).
- The first Librarian pass on a copy stays at Suggest (`vc` §4).
- A profile only narrows what the Librarian may do: `leaveAlone` folders are never filed into or out of.
- Conventions are kept so Obsidian reads the copy the same way: the person's keys byte-for-byte, their link style, their tag style, their file names.
- One conflict to raise, not reopen: decision E writes `_index.md` in every organized folder. In a vault that already has index notes that duplicates them. Flagged in section 6.

### Staged plan

| Stage | What | Size |
|---|---|---|
| 0 | Six synthetic fixture vaults (PARA, Johnny.Decimal, Zettelkasten, daily-heavy, flat with tags, messy). The read-only compatibility audit the import doc names (`vc`:537) but which isn't in the tree | S |
| 1 | The scanner: a pure Rust function over one walk, the JSON report, snapshot tests on the fixtures | M |
| 2 | The confirm-or-decline sheet in the copy flow; the profile in the marker (contract bump, web twin, parity fixture); `LibrarianMap::Copy` reads roles, areas and `leaveAlone` from it | M |
| 3 | The Librarian follows conventions: tag style, filing depth, index notes; each Activity row names the profile rule it used | M |
| 4 | Validating questions, on-device first; remote behind the gate and a preview | M |
| 5 | The profile reaches outside agents: `rotli-vault`, the root `AGENTS.md` and `librarian_guide` describe the learned layout, so skills never hard-code paths | S |
| 6 | Drift: "two new top-level folders since your layout was confirmed" as a quiet notice | S |

Stages 0–2 are the useful minimum, about three to four weeks. The hard parts
are mixed vaults (two methods in one folder tree), not over-fitting small
vaults, and the contract bump across Mac and web.

## 5. Tesven and T3 Code: the end state

What follows about Tesven comes from the shared protocol, not from Tesven's
code.

### The picture

One T3 Code install. A vault is a T3 project because the project's folder is
the vault's folder (`vtp` §2), a thread there reaches the vault only through
Rotli (§3), chats are copied in and summarised (§5b), and the Librarian keeps
all of it filed while the person approves proposals in Rotli.

| Who | Door into the vault | What keeps it organized | Works today |
|---|---|---|---|
| A T3 thread in the vault's project, Claude | `rotli-librarian` MCP with the deny list | Captures go to intake; moves and links are proposals | Dev builds, validated 2026-11-08 |
| A T3 thread in any other project that wants to save a note | `rotli notes create` | Intake, then the on-device Librarian | Yes, public build |
| A Tesven bot's handoff note | `rotli notes create`, then its own folder | §5c: only its folder, agent stamp, revision check | CLI yes; the folder rule is not enforced (below) |
| Codex, Grok and others in T3 | The CLI plus the skill pack | Advice only | Not conformant on a vault with secure notes (`vtp` §3.5) |

### What's missing

1. **A home for host notes.** §5c says `<App>/…` without saying whether that
   is a folder on disk or a folder in Main. `rotli notes create --main
   main:FOLDER` gives a Main folder, which is virtual: the file still starts
   in intake and the Librarian files it by topic, so the bot's notes scatter
   on disk. A disk folder has two problems in a Rotli vault: a top-level
   `Tesven/` is hidden (`corpus_layout.rs`:308–312), and `wiki/Tesven/` is an
   area, so the Librarian can file other notes into it and enrich the handoff
   notes. Neither is enforced as "only its own folder". Smallest fix (S): one
   line in §5c choosing disk or Main per layout, and, if disk, a "host
   folders" role in the Librarian's map, set aside like Templates
   (`librarian_map.rs`:14–20), with create able to target it.
2. **Only Claude is fenced.** "Any agent from T3" needs either a "tools only,
   no raw reads" recipe per provider, or two honest tiers: *fenced* (Claude
   with the deny list) and *by advice* (everyone else, with a warning when the
   vault has secure notes).
3. **Rotli doesn't write the vault's host files.** The protocol's files are
   specified; printing or writing them is plan slice 2 (G3).
4. **T3 can't see or steer Rotli's own Librarian.** There is no verb for its
   activity, its setting, or "file intake now". A read-only `rotli librarian
   activity` and a `status` that includes the on-device Librarian would let a
   thread report what was filed (S).
5. **Not built yet, already planned:** Rotli's thread list and transcript view,
   its read pairing, chat capture, and the Settings switch and Proposals list.
6. **A tension in the plan.** "Structured by default" is the on-device
   Librarian. The plan proposes retiring it (row 11) for a route that is
   opt-in, proposals-only, and development builds only. See decision 2.

## 6. Decisions for Seth

1. **Ship the skill pack now?**
   - **Skills only over the public CLI, now (recommended).** Works with every agent today and matches Obsidian's shape. Trade-off: advice, not a fence.
   - Wait until MCP leaves development builds. One stronger release; nothing for outside agents until then.
2. **What keeps a vault structured by default?** This is the plan's open decision 3 (row 11), seen from the agent side.
   - **Keep the on-device Librarian as the default (recommended)**, with the route as the opt-in way for outside agents to propose. It is the only piece that files a note nobody asked it to, in the public build. Trade-off: about 7,800 lines and a local model stay.
   - Retire it for the route (plan row 11). Smaller app; structure then depends on an agent being present, opted in, and approved per proposal.
3. **Files an agent writes directly.**
   - **Forbid in the skills, and catch them (recommended):** G2's notice, and intake documented as the one folder where a dropped file is still filed. Trade-off: a dropped file skips the create-time secret check (the read gate still applies afterwards), and it can carry a forged agent stamp (row 19), so "an AI made this" stops being something only Rotli can say.
   - Forbid only. Simpler; stray files stay hidden from the person.
4. **How far learning a vault goes.**
   - **Learn their layout and keep it in the copy (recommended).** The Librarian's behaviours (intake, filing, summaries, links) apply inside the person's folders. Consistent with decisions A and H. Also decide whether decision E's `_index.md` is skipped where the vault already has index notes.
   - Also offer "convert to Rotli's layout". One layout to support; every file moves, and Obsidian settings that name paths break.
5. **Cloud agents such as Grok Bot.** This is part of the plan's open decision 1 (row 9).
   - **Hold the relay's removal until one question is answered (recommended):** can Grok Bot run a local command? If yes, ship the Grok Bot plugin as skills over the CLI and remove the relay. If no, the relay is the only way a cloud agent reaches a vault.
   - Remove the relay now. Less surface; the roadmap's Grok Bot item then has no path.

## Sources

- Obsidian skills (README, `plugins/obsidian/README.md`, `plugin.json`, the CLI, Headless, Markdown and Bases skills): <https://github.com/obsidianmd/obsidian-skills>. Docs they cite: <https://help.obsidian.md/cli>, <https://help.obsidian.md/headless>, <https://agentskills.io/specification>
- Karpathy, "LLM Wiki": <https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f>
- OpenClaw (`skills/obsidian/SKILL.md`, `docs/plugins/memory-wiki.md`, `extensions/memory-wiki/skills/`): <https://github.com/openclaw/openclaw>
- xAI: <https://github.com/xai-org/plugin-marketplace> (Grok Build plugins), <https://x.ai/bot/plugin/88871845> (Obsidian for Grok Bot; only the page title was readable)
- Community MCP and in-app agents: <https://github.com/coddingtonbear/obsidian-local-rest-api>, <https://github.com/MarkusPfundstein/mcp-obsidian>, <https://github.com/cyanheads/obsidian-mcp-server>, <https://github.com/logancyang/obsidian-copilot>, <https://github.com/brianpetro/obsidian-smart-connections>
