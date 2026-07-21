# Compatibility and migration contract

Rotli owns several durable file formats and public adapter surfaces. This
contract prevents an upgrade, downgrade, external editor, or agent client from
turning a compatible local workspace into an unrecoverable one.

The default rule is additive evolution. Unknown user data is preserved, newer
unsupported durable contracts open read-only, and rebuildable state falls back
to defaults instead of triggering a content rewrite.

## Surface inventory

| Surface | Current compatibility signal | Durability | Rule |
|---|---|---|---|
| `memex.json` and Markdown/frontmatter | Memex contract band `3.4` through `3.7` | User-portable durable truth | Out-of-band roots open read-only; unknown frontmatter survives |
| App `corpus.json` | `version: 1` | Machine-local root registry | Migrate copy-first; never infer or rewrite missing user roots silently |
| `.rotli/main.json` | `version: 1` | Portable Main arrangement | References only; preserve unknown items; never copy content into Main |
| `.rotli/views.json` | `version: 1` | Portable named subset arrangements | Unsupported newer versions stay read-only; names are identifiers; writes synchronize singular Markdown `view_tag` membership |
| `.rotli/settings.json` | `v: 1` | Explicit user settings | Parse defensively, preserve unknown keys, default invalid values safely |
| `.rotli/viewstate.json` | No explicit version today | Rebuildable presentation state | Invalid/missing data restores a pristine view; never blocks content access |
| `.rotli/brain-journal.jsonl` | Record shape by code contract | Recovery/undo evidence | Append atomically; tolerate an incomplete final record; never rewrite prose |
| `.rotli/workspace-open.json` | Transient mailbox shape | Rebuildable/transient | Consume once and delete; it may contain identifiers, never note content |
| DOCX/XLSX/Excalidraw adapters | Conventional format version + adapter behavior | User-owned durable files | Preserve unknown package/scene content; create backups before lossy migration |
| Breve runtime/config | Runtime package version and documented boundary | Managed runtime plus user config | Mirror contracts explicitly; do not import across the app/runtime boundary |
| Rotli CLI JSON | App semantic version only today | Public automation surface | Additive fields are compatible; removals/renames require a versioned transition |
| `rotli-workspace` MCP | MCP protocol plus app semantic version | Public agent surface | Negotiate only supported protocol versions; tool behavior follows the same compatibility law |

`src/memex/contract.ts` and `src-tauri/src/memex.rs` are deliberately independent
implementations of the portable memex contract. Shared behavior is proven by
fixtures and parity tests rather than importing executable code across the
trust boundary.

## Change classes

### Additive

An additive change may ship in the current contract when old readers remain
safe. Examples include an optional field with a safe default, a new enum value
that old code preserves or rejects without writing, a new CLI response field,
or a new MCP tool.

Additive does not mean untested. Prove old-data read, new-data round trip,
unknown-field preservation, and downgrade behavior.

### Behavioral correction

A correction keeps the schema but changes interpretation. It requires a failing
reproduction, focused regression, changelog entry when users notice it, and a
compatibility note when stored state produced by older builds is affected.

### Breaking

A change is breaking when an older supported client could misread, discard, or
silently reinterpret durable state or a public client can no longer perform the
same operation. Breaking changes require:

1. an explicit version increment;
2. a written migration and downgrade policy;
3. a compatibility matrix;
4. backup and rollback evidence;
5. a refusal path for unsupported versions; and
6. release notes that identify the last compatible version.

Pre-1.0 application semver does not waive these requirements for user files.
Plain Markdown and existing Main references are more durable than the app's
marketing version.

## Migration protocol

Every durable migration follows this order:

1. **Detect without writing.** Parse the declared version and inventory the
   affected records. Unknown or malformed security state fails closed.
2. **Plan.** Produce a deterministic description of changes, collisions,
   skipped records, and the intended destination version.
3. **Back up.** Copy the exact affected control file or binary package before
   replacement. Never call an in-place conversion a backup.
4. **Transform purely.** Keep interpretation and transformation separate from
   filesystem effects so fixtures can prove it.
5. **Write atomically.** Use the existing lock and atomic-write helpers. A crash
   leaves either the old valid file or the new valid file.
6. **Validate.** Re-open the result with the same production parser and verify
   identifiers, references, unknown data, and declared version.
7. **Commit the version last.** Do not advertise a new version before every
   required write has succeeded.
8. **Report.** Surface success, partial refusal, and recovery instructions
   without exposing note content.

A migration must be idempotent. Running it again produces no additional move,
duplicate, or metadata churn. Interrupted migrations resume safely or restore
from the recorded backup; they never guess.

## Upgrade and downgrade behavior

- A newer compatible additive field survives an older Rotli save even when the
  older build does not interpret it.
- A contract newer than Rotli's supported writable band opens read-only with an
  actionable message. It must not be silently stamped down.
- A missing or corrupt rebuildable file may be removed and reconstructed; a
  missing durable user file is not recreated as an empty replacement.
- A settings parser may default an invalid known value, but its next write must
  retain unknown keys owned by another version or tool.
- Main keeps stable identifiers. Physical filing and title changes cannot
  invalidate or duplicate its references.
- Named views remain subsets of Main. A view rename updates its Markdown
  `view_tag` values through one rollback-capable write, and deleting a view
  clears those tags without deleting content or Main references. Older builds
  that do not understand `views.json` must leave the file and unknown
  frontmatter untouched.
- Binary migrations are copy-only unless the user explicitly chooses a
  destructive replacement after verifying the new file.
- Downgrade testing covers the most recent prior release whenever a persistent
  schema or external protocol changes.

## Public CLI and MCP evolution

The CLI and MCP are adapters over one workspace application service. Their
schemas are public once users place them in scripts or agent configuration.

- JSON objects evolve additively; clients must not depend on property order.
- Error categories and refusal semantics are stable even when human messages
  become clearer.
- Writes continue to require a freshly read revision.
- Tool removal or required-argument changes need a deprecation window and a
  replacement documented in release notes.
- The MCP initialize response returns a protocol version implemented by the
  server. An unknown client version is never echoed as if supported.
- A future workspace schema version belongs in one central capability manifest,
  not separately in each tool description.
- Contract tests capture `initialize`, `tools/list`, representative success,
  refusal, pagination, and stale-write responses.

## Required evidence matrix

| Change | Required fixtures |
|---|---|
| New optional field | Missing, valid, invalid, unknown-neighbor, and round-trip cases |
| Version bump | Previous supported, new, malformed, too old, too new, upgrade, and downgrade |
| Identifier/path change | Collision, Unicode, case sensitivity, missing target, and stable-reference preservation |
| Binary conversion | Fixture package round trip, unknown-part preservation, backup, failure, and retry |
| CLI/MCP schema change | Golden response shape, old-client assumption, error/refusal, and protocol negotiation |
| Journal/claim change | Partial final record, duplicate/replay, contention, recovery, and idempotence |

Tests use temporary roots and fixtures only. Never exercise a migration against
a live memex as automated proof.

## Current gaps to close before 1.0

- Introduce an explicit compatibility manifest covering settings, view state,
  Main, corpus config, CLI, MCP, and the managed Breve runtime.
- Add a dry-run report for any future memex engine or instance-script migration.
- Give the workspace CLI/MCP an application schema version independent from the
  upstream MCP transport version.
- Add an application-level workspace schema version and golden tool-schema
  snapshot; MCP protocol negotiation already has a focused regression.
- Record the supported previous-release downgrade matrix in release evidence.

These are bounded hardening tasks, not permission to create a second data store
or speculative migration framework.
